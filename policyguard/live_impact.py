from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select

from .db import Audit, Change, Rule, Service, Version
from .live_gateway import workflow_decision
from .live_models import LiveResource, LiveTrace, LiveTransition, LiveWorkflow
from .views import ChangeView


class PriorDelivery(BaseModel):
    request_id: str
    timestamp: datetime
    classification: str | None
    decision: str
    delivery: str


class HistoricalReview(BaseModel):
    label: Literal["HISTORICAL_REVIEW_CANDIDATES"] = "HISTORICAL_REVIEW_CANDIDATES"
    previously_allowed: int
    count: int
    first_received: datetime | None = None
    last_received: datetime | None = None
    request_ids: list[str]
    events: list[PriorDelivery] = Field(default_factory=list)


class WorkflowImpact(BaseModel):
    id: int
    resource_id: str
    source_service: str
    operation: str
    destination: str
    account_scope: str
    rule_id: str
    no_training: bool
    allow_public: bool
    classification: str
    decision: str
    reason: str
    decision_origin: str
    decision_change_id: int | None
    affected: bool
    next_action: str
    historical: HistoricalReview


class PolicyReference(BaseModel):
    id: int
    version: int
    url: str
    observed_at: datetime


class Impact(BaseModel):
    policy_change_id: int
    affected_service: str
    affected_workflows: int
    restricted_workflows: int
    unaffected_workflows: int
    historical_review_candidates: int
    impacted_classifications: list[str]
    previous: PolicyReference | None
    observed: PolicyReference
    evidence: ChangeView
    workflows: list[WorkflowImpact]


def reference(row):
    return PolicyReference(id=row.id, version=row.number, url=row.source, observed_at=row.observed_at)


def history(db, workflow, resource, service_id, previous, cutoff, affected):
    if not previous:
        return HistoricalReview(previously_allowed=0, count=0, request_ids=[])
    legacy = and_(LiveTrace.workflow_id.is_(None), LiveTrace.resource_id == resource.id,
                  Audit.destination == workflow.destination)
    match = [
        or_(LiveTrace.workflow_id == workflow.id, legacy),
        Audit.decision == "ALLOW",
        Audit.timestamp < cutoff,
        Audit.policy_version == previous.number if workflow.destination == service_id
        else LiveTrace.source_version == previous.number,
    ]
    base = select(Audit).join(LiveTrace).where(*match)
    allowed = db.scalar(select(func.count()).select_from(base.subquery()))
    if not affected:
        return HistoricalReview(previously_allowed=allowed, count=0, request_ids=[])
    received = base.where(Audit.delivery == "RECEIVED", Audit.classification == "CONFIDENTIAL").subquery()
    count, first, last = db.execute(select(
        func.count(), func.min(received.c.timestamp), func.max(received.c.timestamp),
    )).one()
    rows = db.execute(select(
        received.c.request_id, received.c.timestamp, received.c.classification, received.c.decision, received.c.delivery,
    ).order_by(received.c.timestamp.desc()).limit(25)).mappings()
    events = [PriorDelivery.model_validate(row) for row in rows]
    return HistoricalReview(previously_allowed=allowed, count=count, first_received=first,
                            last_received=last, request_ids=[row.request_id for row in events], events=events)


def policy_impact(db, change_id, stale_seconds, *, monitored_enabled=True):
    change = db.get(Change, change_id)
    if not change:
        return None
    old = db.get(Version, change.previous_id) if change.previous_id else None
    new = db.get(Version, change.version_id)
    transition = db.get(LiveTransition, change_id)
    relevant = bool(old and transition and transition.current_status == "REVIEW_REQUIRED")
    paths = db.execute(
        select(LiveWorkflow, LiveResource).join(LiveResource)
        .where(or_(LiveWorkflow.destination == change.service_id, LiveResource.service_id == change.service_id))
        .order_by(LiveWorkflow.id)
    )
    workflows = []
    for workflow, resource in paths:
        source = db.get(Service, resource.service_id)
        destination = db.get(Service, workflow.destination)
        rule = db.get(Rule, workflow.rule_id)
        decision, origin, linked = workflow_decision(
            db, resource, workflow, source, destination, stale_seconds, monitored_enabled=monitored_enabled,
        )
        affected = relevant and resource.classification == "CONFIDENTIAL"
        workflows.append(WorkflowImpact(
            id=workflow.id, resource_id=resource.id, source_service=resource.service_id,
            operation=workflow.operation, destination=workflow.destination, account_scope=workflow.account_scope,
            rule_id=workflow.rule_id, no_training=rule.no_training, allow_public=rule.allow_public,
            classification=resource.classification, decision=decision.decision, reason=decision.reason,
            decision_origin=origin, decision_change_id=linked, affected=affected,
            next_action="Verify the current terms and account scope before approving a confidential transfer."
            if affected and decision.decision != "ALLOW" else "Inspect the observed policy and audit evidence.",
            historical=history(db, workflow, resource, change.service_id, old, change.observed_at, affected),
        ))
    return Impact(
        policy_change_id=change.id, affected_service=change.service_id,
        affected_workflows=sum(row.affected for row in workflows),
        restricted_workflows=sum(row.affected and row.decision != "ALLOW" for row in workflows),
        unaffected_workflows=sum(not row.affected for row in workflows),
        historical_review_candidates=sum(row.historical.count for row in workflows),
        impacted_classifications=sorted({row.classification for row in workflows if row.affected}),
        previous=reference(old) if old else None, observed=reference(new),
        evidence=ChangeView.model_validate(change), workflows=workflows,
    )
