import asyncio
import hmac
import logging
from typing import Annotated
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .db import Audit, Change, Receipt, Service, Version, now
from .gateway import locked_service
from .live_gateway import fresh, workflow_decision
from .live_models import LiveResource, LiveReview, LiveSource, LiveTrace, LiveWorkflow, ProtectionSession, TransferItem, TransferJob
from .live_policy import MONITORED_ANALYZER, SECOND_ANALYZER

LOG = logging.getLogger(__name__)
ITEM_INTERVAL_SECONDS = 1
POLICY_INTERVAL_SECONDS = 2
MAX_ITEMS = 50
MAX_SESSION_ITEMS = 200
ResourceId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,79}$")]


class QueueError(ValueError):
    pass


class QueueSubmission(BaseModel):
    job_id: UUID
    item_count: int


def rehearsal_job_id(settings, session_id, lane=None):
    # An MCP client cannot designate its own batch as an admin-launched rehearsal.
    key = f"privora:rehearsal:{session_id}" + (f":{lane}" if lane else "")
    digest = hmac.digest(settings.admin_secret.encode(), key.encode(), "sha256")
    return UUID(bytes=digest[:16], version=4)


def rehearsal_lanes(settings):
    return (
        ("a_confidential", MONITORED_ANALYZER, settings.demo_resource, "CONFIDENTIAL", 13),
        ("a_public", MONITORED_ANALYZER, settings.demo_public_resource, "PUBLIC", 7),
        ("b_confidential", SECOND_ANALYZER, settings.demo_resource, "CONFIDENTIAL", 13),
        ("b_public", SECOND_ANALYZER, settings.demo_public_resource, "PUBLIC", 7),
    )


def rehearsal_policy(db, settings, session, service, source, starting_version=None):
    if not service or not service.enabled or not fresh(service, source, settings.stale_seconds):
        return "PAUSED"
    if service.status == "APPROVED" and service.approved_version == service.current_version:
        return "APPROVED"
    configured = settings.analyzer_policy_url if service.id == MONITORED_ANALYZER else settings.analyzer_b_policy_url
    if service.status != "REVIEW_REQUIRED" or not settings.fixture_ca or source.configured_url != configured:
        return "PAUSED"
    baseline_version = starting_version or session.starting_version
    review = db.scalar(select(LiveReview).where(LiveReview.service_id == service.id)
                       .order_by(LiveReview.id.desc()).limit(1))
    if not (review and review.version == baseline_version and review.reviewed_at <= session.started_at and review.no_training
            and review.applicability == "VERIFIED" and review.opt_out in {"VERIFIED", "NOT_REQUIRED"}):
        return "PAUSED"
    baseline = db.scalar(select(Version).where(Version.service_id == service.id, Version.number == baseline_version))
    current = db.scalar(select(Version).where(Version.service_id == service.id, Version.number == service.current_version))
    if (baseline and current and baseline.source == current.source == source.configured_url
        and baseline.digest == current.digest and baseline.content == current.content):
        return "RESTORED"
    return "PAUSED"


def current_session(db):
    return db.scalar(select(ProtectionSession).order_by(ProtectionSession.started_at.desc()).limit(1))


def binding(db, resource_id, destination=MONITORED_ANALYZER):
    return db.scalar(select(LiveWorkflow).where(
        LiveWorkflow.resource_id == resource_id, LiveWorkflow.destination == destination,
    ))


class ProtectedQueue:
    def __init__(self, settings, db_factory, lock, transfer, refresh):
        self.settings = settings
        self.db_factory = db_factory
        self.lock = lock
        self.transfer = transfer
        self.refresh = refresh
        self.start_lock = asyncio.Lock()
        self.observation_ready = asyncio.Event()

    async def start_session(self, *, required_resource=None):
        async with self.start_lock:
            with self.db_factory() as db:
                session = current_session(db)
                if required_resource:
                    resource = db.get(LiveResource, required_resource)
                    if not resource or resource.classification != "CONFIDENTIAL":
                        raise QueueError("Register the demo fixture as a confidential synthetic file.")
                if not required_resource and session and session.stopped_at is None:
                    return session.id
            observation = await self.refresh(MONITORED_ANALYZER)
            if required_resource and observation["status"] != "OK":
                raise QueueError("Could not read the analyzer terms over HTTPS. Check the external policy server and certificate.")
            async with self.lock:
                with self.db_factory.begin() as db:
                    destination = locked_service(db, MONITORED_ANALYZER)
                    if (not destination or not destination.enabled or destination.status != "APPROVED"
                        or destination.approved_version != destination.current_version
                        or not fresh(destination, db.get(LiveSource, MONITORED_ANALYZER), self.settings.stale_seconds)):
                        raise QueueError("The fictional analyzer needs a fresh, approved policy before starting.")
                    resources = [db.get(LiveResource, id) for id in self.settings.queue_resources]
                    for resource in resources:
                        if (not resource or resource.repository != self.settings.github_repo or not binding(db, resource.id)):
                            raise QueueError("Register and bind each allowlisted synthetic fixture resource first.")
                    confidential = [
                        resource for resource in resources if resource.classification == "CONFIDENTIAL"
                        and (source := db.get(Service, resource.service_id)) is not None
                        and workflow_decision(db, resource, binding(db, resource.id), source, destination, self.settings.stale_seconds)[0].decision == "ALLOW"
                    ]
                    if not confidential or (required_resource and not any(item.id == required_resource for item in confidential)):
                        raise QueueError("At least one synthetic confidential route needs current source and destination approval.")
                    session = current_session(db)
                    if session and session.stopped_at is None:
                        return session.id
                    session = ProtectionSession(id=str(uuid4()), destination=destination.id, starting_version=destination.current_version)
                    db.add(session)
                    return session.id

    async def stop_session(self):
        async with self.start_lock, self.lock:
            with self.db_factory.begin() as db:
                session = current_session(db)
                if not session or session.stopped_at is not None:
                    return
                session.stopped_at = now()
                items = select(TransferItem).join(TransferJob).where(
                    TransferJob.session_id == session.id, TransferItem.status == "QUEUED",
                )
                for item in db.scalars(items):
                    item.status = "CANCELLED"
                    item.finished_at = now()

    async def submit_protected_job(
        self, session_id: UUID, job_id: UUID, document_ids: Annotated[list[ResourceId], Field(min_length=1, max_length=MAX_ITEMS)],
    ) -> QueueSubmission:
        """Queue registered synthetic fixture IDs for per-document Live enforcement. Reuse the job UUID on retry."""
        async with self.lock:
            with self.db_factory.begin() as db:
                existing = db.get(TransferJob, str(job_id))
                if existing:
                    stored = list(db.scalars(select(TransferItem.resource_id).where(
                        TransferItem.job_id == existing.id,
                    ).order_by(TransferItem.position)))
                    if existing.session_id != str(session_id) or stored != document_ids:
                        raise QueueError("The job ID is already associated with a different submission.")
                    return QueueSubmission(job_id=job_id, item_count=len(stored))
                session = db.get(ProtectionSession, str(session_id))
                if not session or session.stopped_at is not None:
                    raise QueueError("Start a protected monitoring session before submitting a job.")
                if any(id not in self.settings.queue_resources or not binding(db, id) for id in document_ids):
                    raise QueueError("Only allowlisted synthetic fixture resources bound to the controlled analyzer are accepted.")
                used = db.scalar(select(func.count()).select_from(TransferItem).join(TransferJob).where(TransferJob.session_id == session.id))
                if used + len(document_ids) > MAX_SESSION_ITEMS:
                    raise QueueError("The protected session has reached its item limit.")
                db.add(TransferJob(id=str(job_id), session_id=session.id))
                db.flush()
                for position, id in enumerate(document_ids, start=1):
                    db.add(TransferItem(request_id=str(uuid4()), job_id=str(job_id), position=position, resource_id=id))
                return QueueSubmission(job_id=job_id, item_count=len(document_ids))

    async def submit_rehearsal_lanes(self, session_id: UUID, launch_token: UUID) -> list[QueueSubmission]:
        """Atomically start the configured synthetic lanes for an authorized rehearsal."""
        if not self.settings.analyzer_b_policy_url or not hmac.compare_digest(
            str(launch_token), str(rehearsal_job_id(self.settings, session_id, "launch")),
        ):
            raise QueueError("Rehearsal launch authorization is invalid.")
        async with self.lock:
            with self.db_factory.begin() as db:
                session = db.get(ProtectionSession, str(session_id))
                if not session or session.stopped_at is not None:
                    raise QueueError("Start protected monitoring before launching the rehearsal.")
                jobs = list(db.scalars(select(TransferJob).where(TransferJob.session_id == session.id)))
                lanes = rehearsal_lanes(self.settings)
                if jobs:
                    expected = {str(rehearsal_job_id(self.settings, session.id, lane)) for lane, *_ in lanes}
                    if {job.id for job in jobs} == expected:
                        return [QueueSubmission(job_id=UUID(job.id), item_count=db.scalar(
                            select(func.count()).select_from(TransferItem).where(TransferItem.job_id == job.id),
                        )) for job in jobs]
                    raise QueueError("Stop the current session before starting a new rehearsal batch.")
                output = []
                for lane, destination, resource_id, classification, count in lanes:
                    service = db.get(Service, destination)
                    source = db.get(LiveSource, destination)
                    resource = db.get(LiveResource, resource_id)
                    workflow = binding(db, resource_id, destination)
                    if not (service and service.enabled and service.status == "APPROVED"
                            and service.approved_version == service.current_version
                            and fresh(service, source, self.settings.stale_seconds)):
                        raise QueueError(f"{destination} needs fresh, approved terms.")
                    if not (resource and resource_id in self.settings.queue_resources and workflow
                            and resource.repository == self.settings.github_repo and resource.classification == classification
                            and workflow_decision(db, resource, workflow, db.get(Service, resource.service_id),
                                                  service, self.settings.stale_seconds)[0].decision == "ALLOW"):
                        raise QueueError(f"The configured fixture or workflow for {lane} is not authorized.")
                    job_id = rehearsal_job_id(self.settings, session.id, lane)
                    db.add(TransferJob(id=str(job_id), session_id=session.id, lane=lane,
                                       destination=destination, starting_version=service.current_version))
                    db.flush()
                    for position in range(1, count + 1):
                        db.add(TransferItem(request_id=str(uuid4()), job_id=str(job_id),
                                            position=position, resource_id=resource_id))
                    output.append(QueueSubmission(job_id=job_id, item_count=count))
                return output

    def lane_policy(self, db, session, job):
        destination = job.destination or MONITORED_ANALYZER
        service = db.get(Service, destination)
        if job.lane in {"a_public", "b_public"}:
            resource = db.get(LiveResource, self.settings.demo_public_resource)
            workflow = binding(db, self.settings.demo_public_resource, destination)
            if not resource or resource.classification != "PUBLIC" or not workflow or not service:
                return "PAUSED"
            decision, _, _ = workflow_decision(db, resource, workflow, db.get(Service, resource.service_id),
                                               service, self.settings.stale_seconds)
            return "APPROVED" if decision.decision == "ALLOW" else "PAUSED"
        return rehearsal_policy(db, self.settings, session, service, db.get(LiveSource, destination), job.starting_version)

    def recover(self):
        with self.db_factory.begin() as db:
            for item in db.scalars(select(TransferItem).where(TransferItem.status == "RUNNING")):
                # Delivery and audit can commit before progress. Never resend a claimed item.
                item.status = "FINISHED" if db.get(Audit, item.request_id) or db.get(Receipt, item.request_id) else "INTERRUPTED"
                item.finished_at = now()

    async def worker(self):
        while True:
            await self.observation_ready.wait()
            try:
                await self.process_next()
            except Exception as error:
                LOG.warning("Protected queue processing failed (%s)", type(error).__name__)
            await asyncio.sleep(self.settings.demo_interval if self.settings.demo_resource else ITEM_INTERVAL_SECONDS)

    async def process_next(self):
        async with self.lock:
            with self.db_factory.begin() as db:
                session = current_session(db)
                if not session or session.stopped_at is not None:
                    return
                candidates = select(TransferItem).join(TransferJob).where(
                    TransferItem.status == "QUEUED", TransferJob.session_id == session.id,
                )
                demo_job = str(rehearsal_job_id(self.settings, session.id)) if self.settings.demo_resource else None
                jobs = list(db.scalars(select(TransferJob).where(TransferJob.session_id == session.id)))
                held = [job.id for job in jobs if (job.lane or job.id == demo_job) and self.lane_policy(db, session, job) == "PAUSED"]
                if held:
                    candidates = candidates.where(TransferJob.id.not_in(held))
                order = (TransferItem.position, TransferJob.id) if any(job.lane for job in jobs) else (
                    TransferJob.created_at, TransferJob.id, TransferItem.position,
                )
                item = db.scalar(candidates.order_by(*order).limit(1))
                if not item:
                    return
                session_id = session.id
                job = next(job for job in jobs if job.id == item.job_id)
                destination_id = job.destination or MONITORED_ANALYZER
                rehearsal = (job.lane in {"a_confidential", "b_confidential"} or item.job_id == demo_job
                             ) and item.resource_id == self.settings.demo_resource
                starting_version = job.starting_version
                item.status = "RUNNING"
                item.started_at = now()

        def admitted(db):
            session = db.get(ProtectionSession, session_id)
            return bool(self.observation_ready.is_set() and session and session.stopped_at is None
                        and item.resource_id in self.settings.queue_resources)

        def restored(db, resource, destination):
            session = db.get(ProtectionSession, session_id)
            return bool(resource.classification == "CONFIDENTIAL" and resource.repository == self.settings.github_repo
                        and rehearsal_policy(db, self.settings, session, destination,
                                             db.get(LiveSource, destination.id), starting_version) == "RESTORED")

        try:
            options = {"rehearsal_restore": restored} if rehearsal else {}
            result = await self.transfer(item.resource_id, destination_id, request_id=item.request_id, admission=admitted, **options)
            state = "FINISHED" if result is not None else "CANCELLED"
        except Exception:
            state = "INTERRUPTED"
            raise
        finally:
            # Cancellation during shutdown leaves a claim for startup reconciliation.
            if "state" in locals():
                with self.db_factory.begin() as db:
                    row = db.get(TransferItem, item.request_id)
                    row.status = state
                    row.finished_at = now()

    async def watch(self):
        while True:
            try:
                with self.db_factory() as db:
                    session = current_session(db)
                if session and session.stopped_at is None:
                    await self.refresh(MONITORED_ANALYZER)
                    if self.settings.analyzer_b_policy_url:
                        await self.refresh(SECOND_ANALYZER)
                self.observation_ready.set()
            except Exception as error:
                self.observation_ready.clear()
                LOG.warning("Protected fixture observation failed (%s)", type(error).__name__)
            await asyncio.sleep(POLICY_INTERVAL_SECONDS)

    def view(self):
        with self.db_factory() as db:
            session = current_session(db)
            if not session:
                return {"enabled": True, "three_lanes": bool(self.settings.analyzer_b_policy_url), "session": None, "jobs": []}
            service = db.get(Service, session.destination)
            source = db.get(LiveSource, session.destination)
            evidence = db.execute(select(Change, Version).join(Version, Version.id == Change.version_id)
                .where(Change.service_id == session.destination, Change.previous_id.is_not(None),
                       Change.observed_at >= session.started_at).order_by(Change.observed_at.desc()).limit(1)).first()
            jobs = []
            for job in db.scalars(select(TransferJob).where(TransferJob.session_id == session.id).order_by(TransferJob.created_at)):
                rows = db.execute(select(TransferItem, Audit, Receipt, LiveTrace)
                    .outerjoin(Audit, Audit.request_id == TransferItem.request_id)
                    .outerjoin(Receipt, Receipt.request_id == TransferItem.request_id)
                    .outerjoin(LiveTrace, LiveTrace.request_id == TransferItem.request_id)
                    .where(TransferItem.job_id == job.id).order_by(TransferItem.position)).all()
                items = [{
                    "request_id": item.request_id, "position": item.position, "resource_id": item.resource_id,
                    "status": item.status, "started_at": item.started_at, "finished_at": item.finished_at,
                    "classification": audit.classification if audit else None,
                    "decision": audit.decision if audit else None, "reason": audit.reason if audit else None,
                    "delivery": "RECEIVED" if receipt else audit.delivery if audit else "UNKNOWN" if item.status == "INTERRUPTED" else None,
                    "policy_version": audit.policy_version if audit else None,
                    "policy_change_id": trace.policy_change_id if trace else None,
                    "receipt_at": receipt.received_at if receipt else None,
                    "receiver": receipt.receiver if receipt else None,
                    "received_bytes": receipt.byte_count if receipt else None,
                } for item, audit, receipt, trace in rows]
                jobs.append({
                    "id": job.id, "created_at": job.created_at, "items": items,
                    "lane": job.lane, "destination": job.destination,
                    "enforcement": self.lane_policy(db, session, job) if job.lane and not session.stopped_at else None,
                    "confirmed_files": sum(item["receipt_at"] is not None for item in items),
                    "confirmed_bytes": sum(item["received_bytes"] or 0 for item in items),
                })
            rehearsal_exists = bool(self.settings.demo_resource and any(
                job["id"] == str(rehearsal_job_id(self.settings, session.id)) for job in jobs
            ))
            policy = rehearsal_policy(db, self.settings, session, service, source) if rehearsal_exists and not session.stopped_at else None
            incident = self.incident(db, session, jobs) if any(job["lane"] for job in jobs) else None
            return {"enabled": True, "three_lanes": bool(self.settings.analyzer_b_policy_url), "rehearsal_policy": policy, "incident": incident, "session": {
                "id": session.id, "destination": service.name, "starting_version": session.starting_version,
                "current_version": service.current_version, "approval": service.status,
                "observation_status": source.fetch_status, "last_attempt": source.last_attempt,
                "started_at": session.started_at, "stopped_at": session.stopped_at,
            }, "jobs": jobs, "policy_change": {
                "id": evidence[0].id, "observed_at": evidence[0].observed_at, "version": evidence[1].number,
                "rule": evidence[0].rule, "reason": evidence[0].reason, "passages": evidence[0].passages,
            } if evidence else None}


    def incident(self, db, session, jobs):
        from .live_models import LiveTransition

        result = db.execute(select(Change, Version).join(Version, Version.id == Change.version_id)
            .join(LiveTransition, LiveTransition.change_id == Change.id)
            .where(Change.service_id == session.destination, Change.observed_at >= session.started_at,
                   LiveTransition.invalidated.is_(True), LiveTransition.previous_status == "APPROVED",
                   Change.reason == "AI_TRAINING_CONFLICT")
            .order_by(Change.observed_at.desc()).limit(1)).first()
        if not result:
            return None
        change, current = result
        previous = db.get(Version, change.previous_id)
        lanes = {job["lane"]: job for job in jobs}
        affected = lanes["a_confidential"]

        def confirmations(lane, receiver):
            if lane not in lanes:
                return 0
            return sum(item["receiver"] == receiver and item["receipt_at"] is not None
                       and item["receipt_at"] >= change.observed_at for item in lanes[lane]["items"])

        return {
            "id": change.id, "service": session.destination, "observed_at": change.observed_at,
            "previous_version": previous.number if previous else None, "current_version": current.number,
            "rule": change.rule, "passages": change.passages,
            "held": sum(item["status"] == "QUEUED" for item in affected["items"]) if affected["enforcement"] == "PAUSED" else 0,
            "denied": sum(item["policy_change_id"] == change.id and item["delivery"] == "NOT_SENT"
                          and item["decision"] in {"BLOCK", "REVIEW_REQUIRED"} for item in affected["items"]),
            "public_confirmed": confirmations("a_public", MONITORED_ANALYZER),
            "analyzer_b_confirmed": confirmations("b_confidential", SECOND_ANALYZER),
            "analyzer_b_public_confirmed": confirmations("b_public", SECOND_ANALYZER),
        }
