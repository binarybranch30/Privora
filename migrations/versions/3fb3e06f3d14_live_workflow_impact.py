"""Add Live workflow bindings and policy transition provenance."""

from alembic import op
import sqlalchemy as sa

revision = "3fb3e06f3d14"
down_revision = "19c36d6562c1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "live_workflows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("resource_id", sa.String(80), sa.ForeignKey("live_resources.id"), nullable=False),
        sa.Column("destination", sa.String(80), sa.ForeignKey("services.id"), nullable=False),
        sa.Column("rule_id", sa.String(80), sa.ForeignKey("organization_rules.id"), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("account_scope", sa.String(80), nullable=False),
        sa.UniqueConstraint("resource_id", "destination"),
    )
    op.create_index("ix_live_workflows_destination", "live_workflows", ["destination"])
    op.create_table(
        "live_policy_transitions",
        sa.Column("change_id", sa.Integer(), sa.ForeignKey("policy_changes.id"), primary_key=True),
        sa.Column("previous_status", sa.String(32), nullable=False),
        sa.Column("current_status", sa.String(32), nullable=False),
        sa.Column("invalidated", sa.Boolean(), nullable=False),
    )
    with op.batch_alter_table("live_transfer_evidence") as batch:
        batch.add_column(sa.Column("workflow_id", sa.Integer()))
        batch.add_column(sa.Column("policy_change_id", sa.Integer()))
        batch.add_column(sa.Column("decision_origin", sa.String(32)))
        batch.create_foreign_key("fk_live_trace_workflow", "live_workflows", ["workflow_id"], ["id"])
        batch.create_foreign_key("fk_live_trace_policy_change", "policy_changes", ["policy_change_id"], ["id"])
        batch.create_index("ix_live_transfer_evidence_workflow_id", ["workflow_id"])
    op.execute("""
        INSERT INTO live_workflows (resource_id, destination, rule_id, operation, account_scope)
        SELECT id, 'local_analyzer', 'live-org', 'analyze_document', 'local-controlled'
        FROM live_resources
        WHERE EXISTS (SELECT 1 FROM services WHERE id = 'local_analyzer')
          AND EXISTS (SELECT 1 FROM organization_rules WHERE id = 'live-org')
    """)


def downgrade():
    with op.batch_alter_table("live_transfer_evidence") as batch:
        batch.drop_index("ix_live_transfer_evidence_workflow_id")
        batch.drop_constraint("fk_live_trace_policy_change", type_="foreignkey")
        batch.drop_constraint("fk_live_trace_workflow", type_="foreignkey")
        batch.drop_column("decision_origin")
        batch.drop_column("policy_change_id")
        batch.drop_column("workflow_id")
    op.drop_table("live_policy_transitions")
    op.drop_index("ix_live_workflows_destination", table_name="live_workflows")
    op.drop_table("live_workflows")
