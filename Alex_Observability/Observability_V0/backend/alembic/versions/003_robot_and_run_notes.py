"""Add robots.notes and robot_run_notes for cloud dashboard.

Revision ID: 003
Revises: 002
Create Date: 2026-03-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("robots", sa.Column("notes", sa.Text(), nullable=True))
    op.create_table(
        "robot_run_notes",
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(128), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("robot_id", "run_id"),
    )
    op.create_index("ix_robot_run_notes_robot_id", "robot_run_notes", ["robot_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_robot_run_notes_robot_id", table_name="robot_run_notes")
    op.drop_table("robot_run_notes")
    op.drop_column("robots", "notes")
