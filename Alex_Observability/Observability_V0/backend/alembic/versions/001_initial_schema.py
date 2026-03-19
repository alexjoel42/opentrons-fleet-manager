"""Initial schema: users, labs, lab_agent_tokens, robots, telemetry_snapshots, sessions.

Revision ID: 001
Revises:
Create Date: 2025-03-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "labs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("owner_id", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "lab_agent_tokens",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("lab_id", sa.String(32), sa.ForeignKey("labs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lab_agent_tokens_token_hash", "lab_agent_tokens", ["token_hash"], unique=False)

    op.create_table(
        "robots",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("lab_id", sa.String(32), sa.ForeignKey("labs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("robot_serial", sa.String(255), nullable=True),
        sa.Column("ip_last_seen", sa.String(45), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_robots_lab_id", "robots", ["lab_id"], unique=False)
    op.create_index("ix_robots_robot_serial", "robots", ["robot_serial"], unique=False)
    op.create_index("ix_robots_last_seen_at", "robots", ["last_seen_at"], unique=False)

    op.create_table(
        "telemetry_snapshots",
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("health_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("last_run_summary_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("log_tail_text", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_token", "sessions", ["token"], unique=True)


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("telemetry_snapshots")
    op.drop_table("robots")
    op.drop_table("lab_agent_tokens")
    op.drop_table("labs")
    op.drop_table("users")
