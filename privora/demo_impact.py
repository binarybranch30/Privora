from typing import get_args

from sqlalchemy import func, select

from .db import Audit, Change, Document, Receipt, Rule, Service, Version
from .demo import DEMO_ORG, DemoDocumentId
from .engine import evaluate
from .impact import HistoricalReview, PriorDelivery, WorkflowImpact, summarize
from .monitor import DEMO_SERVICE

OPERATION = "analyze_document"


def demo_history(db, classification, previous, cutoff, affected):
    if previous is None:
        return HistoricalReview(previously_allowed=0, count=0, request_ids=[])
    # Demo audits identify the route by destination, operation and classification.
    matches = select(Audit).where(
        Audit.destination == DEMO_SERVICE,
        Audit.operation == OPERATION,
        Audit.classification == classification,
        Audit.policy_version == previous.number,
        Audit.decision == "ALLOW",
        Audit.timestamp < cutoff,
    )
    allowed = db.scalar(select(func.count()).select_from(matches.subquery()))
    if not affected:
        return HistoricalReview(previously_allowed=allowed, count=0, request_ids=[])
    received = matches.join(Receipt, Receipt.request_id == Audit.request_id).where(Audit.delivery == "RECEIVED")
    rows = received.subquery()
    count, first, last = db.execute(select(
        func.count(), func.min(rows.c.timestamp), func.max(rows.c.timestamp),
    )).one()
    events = [PriorDelivery.model_validate(row, from_attributes=True) for row in db.scalars(
        received.order_by(Audit.timestamp.desc()).limit(25)
    )]
    return HistoricalReview(previously_allowed=allowed, count=count, first_received=first, last_received=last,
                            request_ids=[event.request_id for event in events], events=events)


def demo_policy_impact(db, change_id):
    change = db.get(Change, change_id)
    service = db.get(Service, DEMO_SERVICE)
    rule = db.get(Rule, DEMO_ORG)
    if not change or change.service_id != DEMO_SERVICE or not service or not service.source.startswith("fixture://") or not rule:
        return None
    previous = db.get(Version, change.previous_id) if change.previous_id else None
    observed = db.get(Version, change.version_id)
    documents = {row.id: row for row in db.scalars(select(Document).where(
        Document.id.in_(get_args(DemoDocumentId)), Document.organization_id == DEMO_ORG,
    ))}
    workflows = []
    for workflow_id, document_id in enumerate(get_args(DemoDocumentId), start=1):
        if document_id not in documents:
            continue
        document = documents[document_id]
        affected = bool(previous and change.enforcement == "REVIEW_REQUIRED" and document.classification == "CONFIDENTIAL")
        decision = evaluate(document.classification, service, rule)
        linked = affected and service.current_version == observed.number and decision.decision == "REVIEW_REQUIRED"
        workflows.append(WorkflowImpact(
            id=workflow_id, resource_id=document_id, source_service="demo_documents", operation=OPERATION,
            destination=DEMO_SERVICE, account_scope="synthetic-fixture", rule_id=rule.id, no_training=rule.no_training,
            allow_public=rule.allow_public, classification=document.classification, decision=decision.decision,
            reason=decision.reason, decision_origin="POLICY_DRIFT" if linked else "ORGANIZATION_RULE",
            decision_change_id=change.id if linked else None, affected=affected,
            next_action="Review the changed clause against the confidential-document rule." if affected
            else "The public route is evaluated under the public-transfer rule.",
            historical=demo_history(db, document.classification, previous, change.observed_at, affected),
        ))
    return summarize(change, previous, observed, workflows)
