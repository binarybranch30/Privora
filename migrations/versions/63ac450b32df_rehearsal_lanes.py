"""Add receiver identity and destination-scoped rehearsal lanes."""

import sqlalchemy as sa
from alembic import op

revision = "63ac450b32df"
down_revision = "f85bb36793ae"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analyzer_receipts", sa.Column("receiver", sa.String(80), nullable=True))
    with op.batch_alter_table("live_transfer_jobs") as batch:
        batch.add_column(sa.Column("lane", sa.String(32), nullable=True))
        batch.add_column(sa.Column("destination", sa.String(80), nullable=True))
        batch.add_column(sa.Column("starting_version", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_transfer_job_destination", "services", ["destination"], ["id"])


def downgrade():
    with op.batch_alter_table("live_transfer_jobs") as batch:
        batch.drop_constraint("fk_transfer_job_destination", type_="foreignkey")
        batch.drop_column("starting_version")
        batch.drop_column("destination")
        batch.drop_column("lane")
    op.drop_column("analyzer_receipts", "receiver")
