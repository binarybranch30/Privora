import os
from datetime import datetime, timezone

from dotenv import dotenv_values
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker



def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Service(Base):
    __tablename__ = "services"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    source: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="UNKNOWN")
    current_version: Mapped[int | None]
    approved_version: Mapped[int | None]
    verified_no_training: Mapped[bool] = mapped_column(Boolean, default=False)
    last_checked: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(String(64), default="POLICY_REVIEW_REQUIRED")


class Version(Base):
    __tablename__ = "policy_versions"
    __table_args__ = (UniqueConstraint("service_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"), index=True)
    number: Mapped[int]
    source: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Change(Base):
    __tablename__ = "policy_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"), index=True)
    previous_id: Mapped[int | None] = mapped_column(ForeignKey("policy_versions.id"))
    version_id: Mapped[int] = mapped_column(ForeignKey("policy_versions.id"), unique=True)
    passages: Mapped[list] = mapped_column(JSON)
    clauses: Mapped[list] = mapped_column(JSON)
    analysis_status: Mapped[str] = mapped_column(String(32))
    enforcement: Mapped[str] = mapped_column(String(32))
    rule: Mapped[str] = mapped_column(String(200))
    reason: Mapped[str] = mapped_column(String(64))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Rule(Base):
    __tablename__ = "organization_rules"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    no_training: Mapped[bool] = mapped_column(Boolean)
    allow_public: Mapped[bool] = mapped_column(Boolean)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organization_rules.id"))
    classification: Mapped[str] = mapped_column(String(32))
    body: Mapped[str] = mapped_column(Text, deferred=True)


class Audit(Base):
    __tablename__ = "mcp_audit"
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    operation: Mapped[str] = mapped_column(String(64))
    destination: Mapped[str] = mapped_column(String(80))
    classification: Mapped[str | None] = mapped_column(String(32))
    decision: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(64))
    policy_version: Mapped[int | None]
    delivery: Mapped[str] = mapped_column(String(32))


class Receipt(Base):
    __tablename__ = "analyzer_receipts"
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Review(Base):
    __tablename__ = "policy_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[str] = mapped_column(ForeignKey("services.id"))
    version: Mapped[int]
    verified_no_training: Mapped[bool] = mapped_column(Boolean)
    evidence: Mapped[str] = mapped_column(Text)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def database_url():
    return os.getenv("DATABASE_URL") or dotenv_values(".env").get("DATABASE_URL") or "sqlite:///./policyguard.db"


def sessions(url=None):
    return sessionmaker(create_engine(url or database_url()), expire_on_commit=False)
