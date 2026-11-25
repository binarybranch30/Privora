import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect, select, text

from .db import Audit, Change, Receipt, Review, Rule, Service, Version, database_url, now, sessions
from .demo import DemoDocumentId, reset
from .demo_impact import demo_policy_impact
from .impact import Impact
from .gateway import ToolDecision, call_gateway, gateway_server, locked_service
from .monitor import DEMO_SERVICE, DRIFT, configured_extractor, fetch_policy, observe
from .views import AuditView, ChangeView, ServiceView, VersionView
from dotenv import load_dotenv

load_dotenv()


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    demo_mode: bool


class Mutation(BaseModel):
    status: str


class Observation(BaseModel):
    version: int
    changed: bool
    status: str


class DemoRun(BaseModel):
    document_id: DemoDocumentId = "confidential_001"


class Approval(BaseModel):
    version: Annotated[int, Field(ge=1)]
    verified_no_training: bool
    evidence: Annotated[str, Field(min_length=10, max_length=2000)]


class Receipts(BaseModel):
    count: int
    request_ids: list[str]


def create_app(url=None, *, demo_mode=None, extractor=None):
    url = url or database_url()
    demo_mode = os.getenv("DEMO_MODE", "").lower() in {"true", "1"} if demo_mode is None else demo_mode
    db_factory = sessions(url)
    lock = asyncio.Lock()
    gateway = gateway_server(db_factory, url, lock)
    mcp_app = gateway.streamable_http_app()
    extractor = extractor or configured_extractor()

    @asynccontextmanager
    async def lifespan(_):
        from .live_models import LiveIdentity
        with db_factory() as db:
            if inspect(db.connection()).has_table("live_identity") and db.get(LiveIdentity, 1):
                raise RuntimeError("The Demo backend cannot use a Live database")
        try:
            async with gateway.session_manager.run():
                yield
        finally:
            db_factory.kw["bind"].dispose()

    app = FastAPI(title="Privora MCP", lifespan=lifespan)
    app.mount("/mcp", mcp_app)

    def admin(x_admin_token: Annotated[str | None, Header()] = None):
        token = os.getenv("PRIVORA_ADMIN_TOKEN", "")
        if not token or not x_admin_token or not secrets.compare_digest(token.encode(), x_admin_token.encode()):
            raise HTTPException(403, "Local administrator token required")

    @app.get("/api/health")
    def health() -> Health:
        with db_factory() as db:
            db.execute(text("SELECT 1"))
        return Health(demo_mode=demo_mode)

    @app.get("/api/services")
    async def services() -> list[ServiceView]:
        with db_factory() as db:
            return [ServiceView.model_validate(row) for row in db.scalars(select(Service).order_by(Service.id))]

    @app.get("/api/policies/versions")
    async def versions() -> list[VersionView]:
        with db_factory() as db:
            return [VersionView.model_validate(row) for row in db.scalars(select(Version).order_by(Version.id.desc()).limit(100))]

    @app.get("/api/policies/changes")
    async def changes() -> list[ChangeView]:
        with db_factory() as db:
            return [ChangeView.model_validate(row) for row in db.scalars(select(Change).order_by(Change.id.desc()).limit(100))]

    @app.get("/api/audit")
    async def audit() -> list[AuditView]:
        with db_factory() as db:
            return [AuditView.model_validate(row) for row in db.scalars(select(Audit).order_by(Audit.timestamp.desc()).limit(100))]

    @app.post("/api/admin/services/{service_id}/review", dependencies=[Depends(admin)])
    async def review(service_id: str, approval: Approval) -> ServiceView:
        async with lock:
            with db_factory.begin() as db:
                service = locked_service(db, service_id)
                if not service:
                    raise HTTPException(404, "Service not found")
                if service.current_version != approval.version:
                    raise HTTPException(409, "Review must match the current version")
                rule = db.get(Rule, "demo-org")
                if rule is None:
                    raise HTTPException(409, "Organization rule unavailable")
                evidence = approval.evidence.strip()
                if len(evidence) < 10:
                    raise HTTPException(422, "Add verification evidence")
                db.add(Review(service_id=service.id, version=approval.version,
                              verified_no_training=approval.verified_no_training, evidence=evidence))
                service.verified_no_training = approval.verified_no_training
                if rule.no_training and not approval.verified_no_training:
                    service.approved_version = None
                    service.status, service.reason = "RESTRICTED", "AI_TRAINING_CONFLICT"
                else:
                    service.approved_version = approval.version
                    service.status, service.reason = "APPROVED", "POLICY_APPROVED"
                return ServiceView.model_validate(service)

    @app.post("/api/admin/services/{service_id}/monitor", dependencies=[Depends(admin)])
    async def monitor(service_id: str) -> Observation:
        source = os.getenv("POLICY_SOURCE_URL")
        if demo_mode or service_id != DEMO_SERVICE or not source:
            raise HTTPException(404, "No configured policy source for this service")
        try:
            async with asyncio.timeout(20):
                content = await fetch_policy(source)
        except (httpx.HTTPError, ValueError, TimeoutError):
            raise HTTPException(502, "Policy source could not be fetched") from None
        async with lock:
            with db_factory.begin() as db:
                service = locked_service(db, service_id)
                if service is None:
                    raise HTTPException(404, "Service not found")
                service.source = source
                try:
                    version, change = await observe(db, service, content, extractor)
                except ValueError:
                    raise HTTPException(502, "Policy source returned no usable text") from None
                return Observation(version=version.number, changed=change is not None, status=service.status)

    if demo_mode:
        @app.post("/api/demo/reset")
        async def demo_reset() -> Mutation:
            async with lock:
                with db_factory.begin() as db:
                    reset(db)
            return Mutation(status="reset")

        @app.post("/api/demo/simulate-policy-change")
        async def simulate() -> Observation:
            async with lock:
                with db_factory.begin() as db:
                    service = locked_service(db, DEMO_SERVICE)
                    if not service or not service.source.startswith("fixture://"):
                        raise HTTPException(409, "Reset the synthetic demo first")
                    version, change = await observe(db, service, DRIFT, extractor)
                    return Observation(version=version.number, changed=change is not None, status=service.status)

        @app.post("/api/demo/analyze")
        async def analyze(run: DemoRun) -> ToolDecision:
            return await call_gateway("http://localhost:8000/mcp/", {
                "document_id": run.document_id, "destination_service": DEMO_SERVICE,
            }, httpx.ASGITransport(app=app))

        @app.get("/api/demo/policy-changes/{change_id}/impact")
        async def demo_impact(change_id: int) -> Impact:
            async with lock:
                with db_factory() as db:
                    result = demo_policy_impact(db, change_id)
                    if result is None:
                        raise HTTPException(404, "Observed Demo policy change not found")
                    return result

        @app.get("/api/demo/receipts")
        async def receipts() -> Receipts:
            with db_factory() as db:
                count = db.scalar(select(func.count()).select_from(Receipt))
                ids = db.scalars(select(Receipt.request_id).order_by(Receipt.received_at.desc()).limit(100))
                return Receipts(count=count, request_ids=list(ids))

    return app


app = create_app()
