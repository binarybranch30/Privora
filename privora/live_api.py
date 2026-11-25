import asyncio
import hashlib
import logging
import secrets
import time
from contextlib import asynccontextmanager, suppress
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import func, select

from .views import AuditView, ChangeView, ServiceView, VersionView
from .db import Audit, Change, Receipt, Rule, Service, Version, now, sessions
from .gateway import locked_service, subprocess_session
from .live_config import LiveSettings
from .live_connector import github_text, validate_resource
from .live_fetch import FetchError, fetch_live_policy, fixture_url, permitted_url
from .live_gateway import ANALYZER, ORG, live_gateway, live_transfer, workflow_decision
from .live_models import ArchiveVersion, LiveIdentity, LiveResource, LiveReview, LiveSource, LiveTrace, LiveTransition, LiveWorkflow
from .live_policy import LOCAL_SCOPE, MONITORED_ANALYZER, MONITORED_SCOPE, SECOND_ANALYZER, active_drift, formatting_equivalent
from .impact import Impact
from .live_impact import policy_impact
from .live_queue import ProtectedQueue, QueueError, rehearsal_job_id
from .live_queue_client import submit, submit_lanes
from .monitor import ChatExtractor, MockExtractor, changed_passages, observe

LOG = logging.getLogger(__name__)
COOKIE = "privora_live_session"
PROFILE = "Local word-count analyzer. Content is processed in memory. No AI training, network transfer or body retention. Receipts contain only request IDs and times."
Id = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,79}$")]


class Login(BaseModel):
    secret: SecretStr


class Registration(BaseModel):
    id: Id
    name: Annotated[str, Field(min_length=1, max_length=150)]
    url: Annotated[str, Field(max_length=2048)]


class Resource(BaseModel):
    id: Id
    service_id: Id
    path: Annotated[str, Field(max_length=300)]
    commit: str
    classification: Literal["PUBLIC", "CONFIDENTIAL"]


class ReviewInput(BaseModel):
    version: Annotated[int, Field(ge=1)]
    applicability: Literal["VERIFIED", "UNKNOWN"]
    agreement: Annotated[str, Field(min_length=10, max_length=2000)]
    opt_out: Literal["VERIFIED", "NOT_REQUIRED", "UNKNOWN"]
    no_training: bool


class WorkflowInput(BaseModel):
    resource_id: Id
    destination: Literal["fictional_analyzer", "fictional_analyzer_b"]


class WorkflowCreated(BaseModel):
    id: int


def bootstrap(db):
    from .db import Document

    if any(db.scalar(select(func.count()).select_from(model)) for model in (Document, Service)) or db.get(Rule, "demo-org"):
        raise ValueError("Provision Live only in a fresh database")
    db.add_all([
        LiveIdentity(id=1), Rule(id=ORG, no_training=True, allow_public=True),
        Service(id=ANALYZER, name="Local controlled analyzer", source="local://word-count/v1", current_version=1),
    ])
    db.flush()
    db.add(Version(service_id=ANALYZER, number=1, source="local://word-count/v1",
                   content=PROFILE, digest=hashlib.sha256(PROFILE.encode()).hexdigest()))


def matches(provided, expected):
    return bool(provided and secrets.compare_digest(provided.encode(), expected.encode()))


def create_live_app(settings, *, fetch=fetch_live_policy, read_file=github_text, schedule=True):
    monitored = {key: url for key, url in (
        (MONITORED_ANALYZER, settings.analyzer_policy_url),
        (SECOND_ANALYZER, settings.analyzer_b_policy_url),
    ) if url}
    db_factory = sessions(settings.database_url)
    lock = asyncio.Lock()
    refresh_lock = asyncio.Lock()
    demo_lock = asyncio.Lock()
    background_tasks = []
    browser_sessions = {}
    fallback = MockExtractor()

    class LiveExtractor:
        async def extract(self, passages):
            if settings.chat_url:
                try:
                    from .monitor import CLAUSES
                    async with asyncio.timeout(15):
                        model = ChatExtractor(settings.chat_url, settings.chat_model, settings.chat_key)
                        proposed = CLAUSES.validate_python(await model.extract(passages))
                    if proposed and all({"old": item.old_clause, "new": item.new_clause} in passages for item in proposed):
                        return proposed
                except Exception:
                    LOG.warning("Live policy model unavailable, using local extraction")
            return await fallback.extract(passages)

    async def refresh(service_id):
        async with refresh_lock:
            with db_factory() as db:
                source = db.get(LiveSource, service_id)
                if source is None:
                    raise HTTPException(404, "Policy source not found")
                url = source.configured_url
            attempt = now()
            error = None
            try:
                if settings.fixture_ca and url == monitored.get(service_id):
                    final_url, content = await fetch(url, settings.policy_hosts, fixture_ca=settings.fixture_ca)
                else:
                    final_url, content = await fetch(url, settings.policy_hosts)
            except FetchError as problem:
                error = str(problem)
            except (httpx.HTTPError, OSError, ValueError, TimeoutError):
                error = "FETCH_FAILED"
            async with lock:
                with db_factory.begin() as db:
                    service = locked_service(db, service_id)
                    source = db.get(LiveSource, service_id)
                    source.last_attempt = attempt
                    if error:
                        source.fetch_status = error
                        return {"status": error, "changed": False}
                    status_before = service.status
                    previous_drift = active_drift(db, service)
                    earlier_transition = db.get(LiveTransition, previous_drift.id) if previous_drift else None
                    was_approved = (
                        service.status == "APPROVED" and service.current_version is not None
                        and service.approved_version == service.current_version
                    )
                    service.source = final_url
                    version, change = await observe(
                        db, service, content, fallback if service_id in monitored else LiveExtractor(),
                        organization_id=ORG,
                        cosmetic_equivalent=formatting_equivalent if service_id in monitored else None,
                    )
                    if change:
                        db.add(LiveTransition(
                            change_id=change.id, previous_status=status_before, current_status=service.status,
                            invalidated=service.status == "REVIEW_REQUIRED" and bool(
                                was_approved or (earlier_transition and earlier_transition.invalidated)
                            ),
                        ))
                    source.fetch_status = "OK"
                    return {"status": "OK", "version": version.number, "changed": change is not None}

    async def worker():
        while True:
            await asyncio.sleep(settings.check_seconds)
            try:
                with db_factory() as db:
                    ids = list(db.scalars(select(LiveSource.service_id)))
                for service_id in ids:
                    await refresh(service_id)
            except Exception as error:
                LOG.warning("Live policy scheduling pass failed (%s)", type(error).__name__)

    transfer = live_transfer(settings, db_factory, lock, read_file)
    queue = ProtectedQueue(settings, db_factory, lock, transfer, refresh) if (
        schedule and settings.queue_resources and settings.fixture_ca and settings.analyzer_policy_url
    ) else None
    mcp = live_gateway(settings, db_factory, lock, read_file, transfer=transfer,
                       submit_job=queue.submit_protected_job if queue else None,
                       submit_lanes=queue.submit_rehearsal_lanes if queue and settings.analyzer_b_policy_url else None)
    mcp_app = mcp.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_):
        with db_factory.begin() as db:
            if db.get(LiveIdentity, 1) is None or db.get(Rule, "demo-org"):
                raise RuntimeError("Expected a provisioned Live database")
            for service_id, configured in monitored.items():
                validate = fixture_url if settings.fixture_ca else lambda url: permitted_url(url, settings.policy_hosts)
                url = str(validate(configured))
                if not db.get(Service, service_id):
                    name = "Analyzer A" if service_id == MONITORED_ANALYZER else "Analyzer B"
                    db.add(Service(id=service_id, name=name, source=url))
                    db.flush()
                    db.add(LiveSource(service_id=service_id, configured_url=url))
                elif db.get(LiveSource, service_id).configured_url != url:
                    raise RuntimeError("The registered analyzer policy URL does not match Live configuration")
        if queue:
            queue.recover()
        async with mcp.session_manager.run():
            tasks = [asyncio.create_task(worker())] if schedule else []
            if queue:
                tasks.extend([asyncio.create_task(queue.watch()), asyncio.create_task(queue.worker())])
            try:
                background_tasks[:] = tasks
                yield
            finally:
                for task in tasks:
                    task.cancel()
                for task in tasks:
                    with suppress(asyncio.CancelledError):
                        await task
                db_factory.kw["bind"].dispose()

    app = FastAPI(title="Privora Live", lifespan=lifespan)
    app.mount("/mcp", mcp_app)

    @app.middleware("http")
    async def authenticate_mcp(request, call_next):
        if request.url.path.rstrip("/") == "/mcp":
            from starlette.responses import JSONResponse
            if not matches(request.headers.get("authorization"), "Bearer " + settings.mcp_secret):
                return JSONResponse({"detail": "Live MCP credential required"}, status_code=401,
                                    headers={"WWW-Authenticate": "Bearer"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    def admin(request: Request):
        key = request.cookies.get(COOKIE)
        if not key or browser_sessions.get(key, 0) <= time.monotonic():
            raise HTTPException(401, "Sign in to Live Mode")

    def mutation(request: Request, _: Annotated[None, Depends(admin)]):
        if request.headers.get("x-privora-live") != "1":
            raise HTTPException(403, "Live mutation header required")

    @app.post("/api/session")
    async def login(body: Login, request: Request, response: Response):
        if request.headers.get("x-privora-live") != "1" or not matches(body.secret.get_secret_value(), settings.admin_secret):
            raise HTTPException(401, "Invalid Live credentials")
        expired = [key for key, expiry in browser_sessions.items() if expiry <= time.monotonic()]
        for key in expired:
            browser_sessions.pop(key)
        if len(browser_sessions) >= 32:
            raise HTTPException(429, "Too many Live sessions")
        token = secrets.token_urlsafe(32)
        browser_sessions[token] = time.monotonic() + 3600
        response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/api/live", max_age=3600)
        return {"authenticated": True}

    @app.delete("/api/session", dependencies=[Depends(mutation)])
    async def logout(request: Request, response: Response):
        browser_sessions.pop(request.cookies.get(COOKIE), None)
        response.delete_cookie(COOKIE, path="/api/live")
        return {"authenticated": False}

    @app.get("/api/dashboard", dependencies=[Depends(admin)])
    async def dashboard():
        with db_factory() as db:
            services = []
            for row in db.scalars(select(Service).order_by(Service.id)):
                data = ServiceView.model_validate(row).model_dump()
                source = db.get(LiveSource, row.id)
                data.update(fetch_status=source.fetch_status if source else "LOCAL_PROFILE",
                            last_attempt=source.last_attempt if source else None,
                            configured_url=source.configured_url if source else None)
                services.append(data)
            versions = [VersionView.model_validate(row) for row in db.scalars(select(Version).order_by(Version.id.desc()).limit(100))]
            changes = [ChangeView.model_validate(row) for row in db.scalars(select(Change).order_by(Change.id.desc()).limit(100))]
            audit = []
            for row, trace, receipt in db.execute(select(Audit, LiveTrace, Receipt).join(LiveTrace)
                    .outerjoin(Receipt, Receipt.request_id == Audit.request_id).order_by(Audit.timestamp.desc()).limit(100)):
                audit.append(AuditView.model_validate(row).model_dump() | {
                    "source_service": trace.source_service, "source_version": trace.source_version,
                    "resource_id": trace.resource_id, "destination_profile": trace.destination_profile,
                    "workflow_id": trace.workflow_id, "policy_change_id": trace.policy_change_id,
                    "decision_origin": trace.decision_origin,
                    "receiver": receipt.receiver if receipt else None,
                    "receipt_at": receipt.received_at if receipt else None,
                })
            historical = list(db.scalars(select(ArchiveVersion).order_by(ArchiveVersion.archived_at.desc()).limit(100)))
            archive = []
            previous = {}
            for item in reversed(historical):
                key = (item.service_id, item.release)
                before = previous.get(key)
                archive.append({
                    "service_id": item.service_id, "release": item.release, "policy_url": item.policy_url,
                    "archived_at": item.archived_at, "imported_at": item.imported_at, "content": item.content,
                    "passages": changed_passages(before.content, item.content) if before else [],
                })
                previous[key] = item
            archive.reverse()
            resources = [{"id": row.id, "service_id": row.service_id, "classification": row.classification}
                         for row in db.scalars(select(LiveResource).order_by(LiveResource.id))]
            workflows = []
            evaluated_at = now()
            for binding, resource in db.execute(
                select(LiveWorkflow, LiveResource).join(LiveResource).order_by(LiveWorkflow.id)
            ):
                source = db.get(Service, resource.service_id)
                destination = db.get(Service, binding.destination)
                decision, origin, change_id = workflow_decision(
                    db, resource, binding, source, destination, settings.stale_seconds,
                    monitored_enabled=binding.destination in monitored,
                )
                rule = db.get(Rule, binding.rule_id)
                workflows.append({
                    "id": binding.id, "resource_id": resource.id, "source_service": resource.service_id,
                    "destination": binding.destination, "operation": binding.operation,
                    "classification": resource.classification, "rule_id": binding.rule_id,
                    "account_scope": binding.account_scope, "no_training": rule.no_training,
                    "allow_public": rule.allow_public, "decision": decision.decision,
                    "reason": decision.reason, "decision_origin": origin, "decision_change_id": change_id,
                    "evaluated_at": evaluated_at, "source_version": source.current_version if source else None,
                    "policy_version": destination.current_version,
                })
            return {"services": services, "versions": versions, "changes": changes, "audit": audit, "archive": archive,
                    "resources": resources, "workflows": workflows,
                    "connector_configured": bool(settings.github_command and settings.github_token and settings.github_repo)}

    @app.get("/api/protection", dependencies=[Depends(admin)])
    async def protection():
        return {**queue.view(), "demo_enabled": bool(settings.demo_resource),
                "three_lanes": bool(settings.analyzer_b_policy_url)} if queue else {"enabled": False, "session": None, "jobs": []}

    @app.post("/api/protection/demo", dependencies=[Depends(mutation)])
    async def start_demo():
        if not queue or not settings.demo_resource:
            raise HTTPException(404, "The one-click rehearsal is disabled.")
        if len(background_tasks) != 3 or any(task.done() for task in background_tasks):
            raise HTTPException(503, "The policy monitor or transfer worker is unavailable. Restart the rehearsal Live service.")
        if not all((settings.github_command, settings.github_token, settings.github_repo)):
            raise HTTPException(503, "Configure the GitHub MCP connection for the synthetic fixture.")
        async with demo_lock:
            snapshot = queue.view()
            session = snapshot["session"]
            if session and session["stopped_at"] is None and snapshot["jobs"]:
                if settings.analyzer_b_policy_url and {job["lane"] for job in snapshot["jobs"]} != {
                    "a_confidential", "a_public", "b_confidential", "b_public",
                }:
                    raise HTTPException(409, "Stop the current session before starting a new rehearsal batch.")
                return {**snapshot, "demo_enabled": True}
            try:
                async with asyncio.timeout(15):
                    for destination in monitored:
                        async with subprocess_session("analyzer", settings.database_url, receiver=destination) as client:
                            tools = await client.list_tools()
                            if not any(tool.name == "analyze_content" for tool in tools.tools):
                                raise RuntimeError("Receiver tool missing")
            except Exception:
                raise HTTPException(503, "The controlled analyzer could not be reached. Check the rehearsal receiver.") from None
            try:
                session_id = await queue.start_session(required_resource=settings.demo_resource)
            except QueueError as error:
                raise HTTPException(409, str(error)) from None
            if settings.analyzer_b_policy_url:
                observed = await refresh(SECOND_ANALYZER)
                with db_factory() as db:
                    second = db.get(Service, SECOND_ANALYZER)
                    if (observed["status"] != "OK" or not second or not second.enabled or second.status != "APPROVED"
                            or second.approved_version != second.current_version):
                        raise HTTPException(409, "Analyzer B needs reachable, independently approved terms. Check Settings.")
            # Deterministic per session so retrying after a lost response cannot duplicate the batch.
            job_id = rehearsal_job_id(settings, session_id)
            try:
                async with asyncio.timeout(15):
                    if settings.analyzer_b_policy_url:
                        await submit_lanes(settings, session_id, rehearsal_job_id(settings, session_id, "launch"))
                    else:
                        await submit(settings, session_id, job_id,
                                     [settings.demo_resource] * settings.demo_count, settings.demo_port)
            except Exception:
                LOG.warning("Rehearsal MCP submission did not return successfully")
                raise HTTPException(503, "Could not confirm the batch through the protected gateway. Use Start Live Demo to retry safely.") from None
            return {**queue.view(), "demo_enabled": True}

    @app.post("/api/protection/session", dependencies=[Depends(mutation)])
    async def start_protection():
        if not queue:
            raise HTTPException(404, "The synthetic protected queue is disabled.")
        try:
            await queue.start_session()
        except QueueError as error:
            raise HTTPException(409, str(error)) from None
        return queue.view()

    @app.delete("/api/protection/session", dependencies=[Depends(mutation)])
    async def stop_protection():
        if not queue:
            raise HTTPException(404, "The synthetic protected queue is disabled.")
        await queue.stop_session()
        return queue.view()

    @app.post("/api/services", status_code=201, dependencies=[Depends(mutation)])
    async def add_service(body: Registration):
        try:
            url = str(permitted_url(body.url, settings.policy_hosts))
        except (ValueError, httpx.InvalidURL):
            raise HTTPException(422, "Policy URL must use an allowlisted HTTPS host") from None
        async with lock:
            with db_factory.begin() as db:
                if db.get(Service, body.id):
                    raise HTTPException(409, "Service already registered")
                db.add(Service(id=body.id, name=body.name, source=url))
                db.flush()
                db.add(LiveSource(service_id=body.id, configured_url=url))
        return {"id": body.id}

    @app.get("/api/policy-changes/{change_id}/impact", dependencies=[Depends(admin)])
    async def impact(change_id: int) -> Impact:
        with db_factory() as db:
            result = policy_impact(db, change_id, settings.stale_seconds,
                                   monitored_destinations=monitored)
            if result is None:
                raise HTTPException(404, "Observed policy change not found")
            return result

    @app.post("/api/workflows", status_code=201, dependencies=[Depends(mutation)])
    async def register_workflow(body: WorkflowInput) -> WorkflowCreated:
        async with lock:
            with db_factory.begin() as db:
                if body.destination not in monitored or not db.get(Service, body.destination):
                    raise HTTPException(409, "Configure the monitored analyzer first")
                if not db.get(LiveResource, body.resource_id):
                    raise HTTPException(404, "Registered resource not found")
                current = db.scalar(select(LiveWorkflow).where(
                    LiveWorkflow.resource_id == body.resource_id, LiveWorkflow.destination == body.destination,
                ))
                if current:
                    raise HTTPException(409, "Workflow already registered")
                workflow = LiveWorkflow(resource_id=body.resource_id, destination=body.destination,
                                        rule_id=ORG, account_scope=MONITORED_SCOPE)
                db.add(workflow)
                db.flush()
                return WorkflowCreated(id=workflow.id)

    @app.post("/api/services/{service_id}/refresh", dependencies=[Depends(mutation)])
    async def refresh_service(service_id: str):
        return await refresh(service_id)

    @app.post("/api/services/{service_id}/review", dependencies=[Depends(mutation)])
    async def review(service_id: str, body: ReviewInput):
        async with lock:
            with db_factory.begin() as db:
                service = locked_service(db, service_id)
                if not service or service.current_version != body.version:
                    raise HTTPException(409, "Review must reference the current policy version")
                source = db.get(LiveSource, service_id)
                if source and source.fetch_status != "OK":
                    raise HTTPException(409, "Refresh the policy successfully before reviewing it")
                if len(body.agreement.strip()) < 10:
                    raise HTTPException(422, "Provide verification evidence")
                verified = body.applicability == "VERIFIED" and body.opt_out != "UNKNOWN" and body.no_training
                db.add(LiveReview(service_id=service_id, version=body.version, applicability=body.applicability,
                                  agreement=body.agreement.strip(), opt_out=body.opt_out, no_training=body.no_training))
                service.status = "APPROVED" if verified else "REVIEW_REQUIRED"
                service.approved_version = body.version if verified else None
                service.verified_no_training = verified
                if verified:
                    service.reason = "POLICY_APPROVED"
                elif body.applicability == "UNKNOWN" or body.opt_out == "UNKNOWN":
                    service.reason = "CONTRACT_APPLICABILITY_UNKNOWN"
                else:
                    service.reason = "AI_TRAINING_CONFLICT"
                return {"status": service.status}

    @app.post("/api/resources", status_code=201, dependencies=[Depends(mutation)])
    async def register_resource(body: Resource):
        if not settings.github_repo or not settings.github_command or not settings.github_token:
            raise HTTPException(409, "Configure the Live GitHub connector first")
        try:
            validate_resource(body.path, body.commit)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        async with lock:
            with db_factory.begin() as db:
                source = db.get(LiveSource, body.service_id)
                if not source or source.configured_url != settings.github_policy_url:
                    raise HTTPException(422, "Register the GitHub policy source first")
                if db.get(LiveResource, body.id):
                    raise HTTPException(409, "Resource ID already registered")
                conflicting = db.scalar(select(LiveResource.id).where(
                    LiveResource.repository == settings.github_repo, LiveResource.path == body.path,
                    LiveResource.commit == body.commit, LiveResource.classification != body.classification,
                ).limit(1))
                if conflicting:
                    raise HTTPException(409, "This repository file already has a different trusted classification")
                db.add(LiveResource(id=body.id, service_id=body.service_id, repository=settings.github_repo,
                                    path=body.path, commit=body.commit, classification=body.classification))
                db.flush()
                db.add(LiveWorkflow(resource_id=body.id, destination=ANALYZER, rule_id=ORG, account_scope=LOCAL_SCOPE))
        return {"id": body.id}

    return app


def app_factory():
    return create_live_app(LiveSettings.load())
