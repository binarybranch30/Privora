"""Add protected Live queue and receiver byte counts."""

import sqlalchemy as sa
from alembic import op

revision = "f85bb36793ae"
down_revision = "3fb3e06f3d14"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analyzer_receipts", sa.Column("byte_count", sa.Integer(), nullable=True))
    op.create_table(
        "live_protection_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("destination", sa.String(80), sa.ForeignKey("services.id"), nullable=False),
        sa.Column("starting_version", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "live_transfer_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_id", sa.String(36), sa.ForeignKey("live_protection_sessions.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_live_transfer_jobs_session_id", "live_transfer_jobs", ["session_id"])
    op.create_table(
        "live_transfer_items",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("live_transfer_jobs.id"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("resource_id", sa.String(80), sa.ForeignKey("live_resources.id"), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("job_id", "position"),
    )
    op.create_index("ix_live_transfer_items_job_id", "live_transfer_items", ["job_id"])
    op.create_index("ix_live_transfer_items_status", "live_transfer_items", ["status"])


def downgrade():
    op.drop_table("live_transfer_items")
    op.drop_table("live_transfer_jobs")
    op.drop_table("live_protection_sessions")
    op.drop_column("analyzer_receipts", "byte_count")
