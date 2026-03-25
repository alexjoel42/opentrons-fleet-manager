"""SQLAlchemy models for Cloud + Local Agent (labs, robots, telemetry, users, auth)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, PrimaryKeyConstraint, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Declarative base for all models."""

    pass


def uuid4_hex() -> str:
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uuid4_hex)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    labs: Mapped[list["Lab"]] = relationship("Lab", back_populates="owner", cascade="all, delete-orphan")


class Lab(Base):
    __tablename__ = "labs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uuid4_hex)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Addresses the relay agent polls (set from the cloud UI), not from the agent machine.
    robot_poll_targets: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)

    owner: Mapped[User | None] = relationship("User", back_populates="labs")
    agent_tokens: Mapped[list["LabAgentToken"]] = relationship(
        "LabAgentToken", back_populates="lab", cascade="all, delete-orphan"
    )
    robots: Mapped[list["Robot"]] = relationship("Robot", back_populates="lab", cascade="all, delete-orphan")


class LabAgentToken(Base):
    __tablename__ = "lab_agent_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uuid4_hex)
    lab_id: Mapped[str] = mapped_column(String(32), ForeignKey("labs.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lab: Mapped[Lab] = relationship("Lab", back_populates="agent_tokens")


class Robot(Base):
    __tablename__ = "robots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uuid4_hex)
    lab_id: Mapped[str] = mapped_column(String(32), ForeignKey("labs.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    robot_serial: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    ip_last_seen: Mapped[str | None] = mapped_column(String(45), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    lab: Mapped[Lab] = relationship("Lab", back_populates="robots")
    telemetry: Mapped["TelemetrySnapshot | None"] = relationship(
        "TelemetrySnapshot", back_populates="robot", uselist=False, cascade="all, delete-orphan"
    )
    run_notes: Mapped[list["RobotRunNote"]] = relationship(
        "RobotRunNote", back_populates="robot", cascade="all, delete-orphan"
    )


class RobotRunNote(Base):
    __tablename__ = "robot_run_notes"
    __table_args__ = (PrimaryKeyConstraint("robot_id", "run_id"),)

    robot_id: Mapped[str] = mapped_column(String(32), ForeignKey("robots.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str] = mapped_column(String(128), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    inline_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    inline_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    robot: Mapped[Robot] = relationship("Robot", back_populates="run_notes")


class TelemetrySnapshot(Base):
    __tablename__ = "telemetry_snapshots"

    robot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("robots.id", ondelete="CASCADE"), primary_key=True
    )
    health_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    last_run_summary_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    log_tail_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    robot: Mapped[Robot] = relationship("Robot", back_populates="telemetry")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uuid4_hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# Indexes for common queries (plan Section 5)
Index("ix_robots_lab_id", Robot.lab_id)
Index("ix_telemetry_snapshots_robot_id", TelemetrySnapshot.robot_id)
Index("ix_robots_last_seen_at", Robot.last_seen_at)
Index("ix_robot_run_notes_robot_id", RobotRunNote.robot_id)
