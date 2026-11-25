from sqlalchemy import and_, func, or_, select

from .db import Audit, Change, Rule, Service, Version
from .live_gateway import workflow_decision
from .live_models import LiveResource, LiveTrace, LiveTransition, LiveWorkflow
from .impact import HistoricalReview, PriorDelivery, WorkflowImpact, summarize


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


def policy_impact(db, change_id, stale_seconds, *, monitored_enabled=True, monitored_destinations=None):
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
            db, resource, workflow, source, destination, stale_seconds,
            monitored_enabled=(workflow.destination in monitored_destinations if monitored_destinations is not None else monitored_enabled),
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
    return summarize(change, old, new, workflows)
