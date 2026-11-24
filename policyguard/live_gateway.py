import asyncio
import logging
from datetime import timezone
from uuid import uuid4

from mcp.server.fastmcp import FastMCP
from sqlalchemy import select

from .db import Audit, Rule, now
from .engine import Decision, evaluate
from .gateway import Analysis, ToolDecision, invoke, locked_service, subprocess_session
from .live_connector import github_text
from .live_models import LiveResource, LiveSource, LiveTrace, LiveTransition, LiveWorkflow
from .live_policy import MONITORED_ANALYZER, active_drift, has_current_review

ORG = "live-org"
ANALYZER = "local_analyzer"
LOG = logging.getLogger(__name__)


def fresh(service, source, seconds):
    timestamp = service.last_checked
    if not source or source.fetch_status != "OK" or timestamp is None:
        return False
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return (now() - timestamp).total_seconds() <= seconds


def workflow_decision(db, resource, workflow, source, destination, stale_seconds, *, monitored_enabled=True):
    classification = resource.classification
    rule = db.get(Rule, workflow.rule_id)
    destination_drift = active_drift(db, destination)
    source_drift = active_drift(db, source)
    monitored = workflow.destination == MONITORED_ANALYZER
    if monitored and not monitored_enabled:
        return Decision("BLOCK", "DESTINATION_DISABLED"), "CONFIGURATION", None
    result = evaluate(classification, destination, rule)
    if result.decision != "ALLOW":
        if destination_drift and classification == "CONFIDENTIAL" and result.decision == "REVIEW_REQUIRED":
            return result, "POLICY_DRIFT", destination_drift.id
        return result, decision_origin(db, destination, result), None
    approved = destination.status == "APPROVED" and destination.approved_version == destination.current_version
    if not approved:
        transition = db.get(LiveTransition, destination_drift.id) if destination_drift else None
        public_drift = monitored and classification == "PUBLIC" and transition and transition.invalidated
        if not public_drift:
            cause = "ADMIN_REVIEW" if has_current_review(db, destination) else "DESTINATION_APPROVAL"
            return Decision("REVIEW_REQUIRED", "DESTINATION_PROFILE_UNAPPROVED"), cause, None
    if monitored and classification == "CONFIDENTIAL" and not fresh(
        destination, db.get(LiveSource, destination.id), stale_seconds,
    ):
        return Decision("REVIEW_REQUIRED", "DESTINATION_POLICY_UNAVAILABLE"), "MONITORING", None
    if not source or not source.enabled:
        return Decision("BLOCK", "SOURCE_DISABLED"), "CONFIGURATION", None
    if classification == "CONFIDENTIAL" and not fresh(source, db.get(LiveSource, source.id), stale_seconds):
        return Decision("REVIEW_REQUIRED", "SOURCE_POLICY_UNAVAILABLE"), "MONITORING", None
    result = evaluate(classification, source, rule)
    if source_drift and result.decision == "REVIEW_REQUIRED":
        return result, "POLICY_DRIFT", source_drift.id
    return result, decision_origin(db, source, result), None


def decision_origin(db, service, decision):
    if decision.decision == "REVIEW_REQUIRED" and has_current_review(db, service):
        return "ADMIN_REVIEW"
    if decision.reason == "POLICY_REVIEW_REQUIRED":
        return "APPROVAL"
    return "ORGANIZATION_RULE"


def live_gateway(settings, db_factory, lock, read_file=github_text):
    mcp = FastMCP("PolicyGuard Live", stateless_http=True, json_response=True, streamable_http_path="/")

    @mcp.tool()
    async def analyze_document(document_id: str, destination_service: str) -> ToolDecision:
        """Analyze a registered GitHub text resource through the approved local analyzer."""
        request_id = str(uuid4())
        classification = source_version = destination_version = analysis = resource = source = destination = workflow = None
        change_id, origin = None, "CONFIGURATION"
        delivery = "NOT_SENT"
        decision = Decision("BLOCK", "UNKNOWN_DOCUMENT")
        async with lock:
            with db_factory.begin() as db:
                resource = db.get(LiveResource, document_id) if 0 < len(document_id) <= 80 else None
                if resource:
                    classification = resource.classification
                    source = locked_service(db, resource.service_id)
                    source_version = source.current_version if source else None
                    if destination_service in {ANALYZER, MONITORED_ANALYZER}:
                        workflow = db.scalar(select(LiveWorkflow).where(
                            LiveWorkflow.resource_id == resource.id, LiveWorkflow.destination == destination_service,
                        ))
                    destination = locked_service(db, destination_service) if workflow else None
                    destination_version = destination.current_version if destination else None
                    decision = Decision("BLOCK", "UNKNOWN_DESTINATION")
                    if destination:
                        decision, origin, change_id = workflow_decision(
                            db, resource, workflow, source, destination, settings.stale_seconds,
                            monitored_enabled=bool(settings.analyzer_policy_url),
                        )
                    if decision.decision == "ALLOW":
                        try:
                            async with asyncio.timeout(25):
                                body = await read_file(settings, resource.repository, resource.path, resource.commit)
                                async with subprocess_session("analyzer", settings.database_url) as analyzer:
                                    delivery = "UNKNOWN"
                                    result = Analysis.model_validate(await invoke(analyzer, "analyze_content", {"content": body, "request_id": request_id}))
                                    if result.request_id != request_id:
                                        raise ValueError("Receipt ID mismatch")
                                    analysis, delivery = result, "RECEIVED"
                        except Exception as error:
                            LOG.warning("Live MCP request %s failed (%s)", request_id, type(error).__name__)
                            if delivery == "NOT_SENT":
                                decision = Decision("BLOCK", "CONNECTOR_UNAVAILABLE")
                                origin = "CONNECTOR"
                db.add(Audit(request_id=request_id, operation="analyze_document", destination=destination.id if destination else "unresolved",
                             classification=classification, decision=decision.decision, reason=decision.reason,
                             policy_version=destination_version, delivery=delivery))
                db.flush()
                db.add(LiveTrace(request_id=request_id, resource_id=resource.id if resource else None,
                                 source_service=source.id if source else None, source_version=source_version,
                                 destination_profile="local-word-count-v1" if destination else None,
                                 workflow_id=workflow.id if workflow else None, policy_change_id=change_id,
                                 decision_origin=origin))
        return ToolDecision(request_id=request_id, decision=decision.decision, reason=decision.reason, classification=classification,
                            policy_version=destination_version, delivery=delivery, analysis=analysis)

    return mcp
