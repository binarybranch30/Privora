from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, now


class LiveIdentity(Base):
    __tablename__ = "live_identity"
    id: Mapped[int] = mapped_column(primary_key=True)


class LiveSource(Base):
    __tablename__ = "live_sources"
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"), primary_key=True)
    configured_url: Mapped[str] = mapped_column(Text)
    fetch_status: Mapped[str] = mapped_column(String(40), default="PENDING")
    last_attempt: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LiveReview(Base):
    __tablename__ = "live_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"))
    version: Mapped[int]
    applicability: Mapped[str] = mapped_column(String(24))
    agreement: Mapped[str] = mapped_column(Text)
    opt_out: Mapped[str] = mapped_column(String(24))
    no_training: Mapped[bool]
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ArchiveVersion(Base):
    __tablename__ = "archive_versions"
    __table_args__ = (UniqueConstraint("service_id", "release", "archived_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"), index=True)
    release: Mapped[str] = mapped_column(Text)
    policy_url: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    content: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64))


class LiveTrace(Base):
    __tablename__ = "live_transfer_evidence"
    request_id: Mapped[str] = mapped_column(ForeignKey("mcp_audit.request_id"), primary_key=True)
    resource_id: Mapped[str | None] = mapped_column(String(80))
    source_service: Mapped[str | None] = mapped_column(String(80))
    source_version: Mapped[int | None]
    destination_profile: Mapped[str | None] = mapped_column(String(64))
    workflow_id: Mapped[int | None] = mapped_column(ForeignKey("live_workflows.id"), index=True)
    policy_change_id: Mapped[int | None] = mapped_column(ForeignKey("policy_changes.id"))
    decision_origin: Mapped[str | None] = mapped_column(String(32))

class LiveResource(Base):
    __tablename__ = "live_resources"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"))
    repository: Mapped[str] = mapped_column(String(200))
    path: Mapped[str] = mapped_column(Text)
    commit: Mapped[str] = mapped_column(String(40))
    classification: Mapped[str] = mapped_column(String(24))


class LiveWorkflow(Base):
    __tablename__ = "live_workflows"
    __table_args__ = (UniqueConstraint("resource_id", "destination"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    resource_id: Mapped[str] = mapped_column(ForeignKey("live_resources.id"))
    destination: Mapped[str] = mapped_column(ForeignKey("services.id"), index=True)
    rule_id: Mapped[str] = mapped_column(ForeignKey("organization_rules.id"))
    operation: Mapped[str] = mapped_column(String(64), default="analyze_document")
    account_scope: Mapped[str] = mapped_column(String(80))


class LiveTransition(Base):
    __tablename__ = "live_policy_transitions"
    change_id: Mapped[int] = mapped_column(ForeignKey("policy_changes.id"), primary_key=True)
    previous_status: Mapped[str] = mapped_column(String(32))
    current_status: Mapped[str] = mapped_column(String(32))
    invalidated: Mapped[bool]

class ProtectionSession(Base):
    __tablename__ = "live_protection_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    destination: Mapped[str] = mapped_column(ForeignKey("services.id"))
    starting_version: Mapped[int]
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TransferJob(Base):
    __tablename__ = "live_transfer_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("live_protection_sessions.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    lane: Mapped[str | None] = mapped_column(String(32))
    destination: Mapped[str | None] = mapped_column(ForeignKey("services.id"))
    starting_version: Mapped[int | None]


class TransferItem(Base):
    __tablename__ = "live_transfer_items"
    __table_args__ = (UniqueConstraint("job_id", "position"),)
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("live_transfer_jobs.id"), index=True)
    position: Mapped[int]
    resource_id: Mapped[str] = mapped_column(ForeignKey("live_resources.id"))
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
