from datetime import datetime

from pydantic import BaseModel, ConfigDict

from .gateway import ToolDecision
from .monitor import Clause

class Row(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ServiceView(Row):
    id: str
    name: str
    source: str
    enabled: bool
    status: str
    current_version: int | None
    last_checked: datetime | None
    verified_no_training: bool
    reason: str


class VersionView(Row):
    id: int
    service_id: str
    number: int
    source: str
    digest: str
    observed_at: datetime
    content: str


class ChangeView(Row):
    id: int
    service_id: str
    previous_id: int | None
    version_id: int
    passages: list[dict[str, str]]
    clauses: list[Clause]
    analysis_status: str
    enforcement: str
    reason: str
    rule: str
    observed_at: datetime


class AuditView(ToolDecision):
    model_config = ConfigDict(from_attributes=True)

    timestamp: datetime
    destination: str
    operation: str
