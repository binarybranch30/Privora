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

class LiveResource(Base):
    __tablename__ = "live_resources"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"))
    repository: Mapped[str] = mapped_column(String(200))
    path: Mapped[str] = mapped_column(Text)
    commit: Mapped[str] = mapped_column(String(40))
    classification: Mapped[str] = mapped_column(String(24))
