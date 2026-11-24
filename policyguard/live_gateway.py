import asyncio
import logging
from datetime import timezone
from uuid import uuid4

from mcp.server.fastmcp import FastMCP

from .db import Audit, Rule, now
from .engine import Decision, evaluate
from .gateway import Analysis, ToolDecision, invoke, locked_service, subprocess_session
from .live_connector import github_text
from .live_models import LiveResource, LiveSource, LiveTrace

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


def live_gateway(settings, db_factory, lock, read_file=github_text):
    mcp = FastMCP("PolicyGuard Live", stateless_http=True, json_response=True, streamable_http_path="/")

    @mcp.tool()
    async def analyze_document(document_id: str, destination_service: str) -> ToolDecision:
        """Analyze a registered GitHub text resource through the approved local analyzer."""
        request_id = str(uuid4())
        classification = source_version = destination_version = analysis = resource = source = destination = None
        delivery = "NOT_SENT"
        decision = Decision("BLOCK", "UNKNOWN_DOCUMENT")
        async with lock:
            with db_factory.begin() as db:
                resource = db.get(LiveResource, document_id) if 0 < len(document_id) <= 80 else None
                if resource:
                    classification = resource.classification
                    source = locked_service(db, resource.service_id)
                    source_version = source.current_version if source else None
                    destination = locked_service(db, ANALYZER) if destination_service == ANALYZER else None
                    destination_version = destination.current_version if destination else None
                    rule = db.get(Rule, ORG)
                    decision = evaluate(classification, destination, rule)
                    if decision.decision == "ALLOW":
                        if destination.status != "APPROVED" or destination.approved_version != destination.current_version:
                            decision = Decision("REVIEW_REQUIRED", "DESTINATION_PROFILE_UNAPPROVED")
                        elif not source or not source.enabled:
                            decision = Decision("BLOCK", "SOURCE_DISABLED")
                        elif classification == "CONFIDENTIAL" and not fresh(source, db.get(LiveSource, source.id), settings.stale_seconds):
                            decision = Decision("REVIEW_REQUIRED", "SOURCE_POLICY_UNAVAILABLE")
                        else:
                            decision = evaluate(classification, source, rule)
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
                db.add(Audit(request_id=request_id, operation="analyze_document", destination=ANALYZER if destination else "unresolved",
                             classification=classification, decision=decision.decision, reason=decision.reason,
                             policy_version=destination_version, delivery=delivery))
                db.flush()
                db.add(LiveTrace(request_id=request_id, resource_id=resource.id if resource else None,
                                 source_service=source.id if source else None, source_version=source_version,
                                 destination_profile="local-word-count-v1" if destination else None))
        return ToolDecision(request_id=request_id, decision=decision.decision, reason=decision.reason, classification=classification,
                            policy_version=destination_version, delivery=delivery, analysis=analysis)

    return mcp
