from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

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


def summarize(change, old, new, workflows):
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
