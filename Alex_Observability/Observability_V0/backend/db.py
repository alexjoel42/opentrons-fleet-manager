"""Database connection and session for Cloud backend (PostgreSQL)."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models import Base


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return ""
    if url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


_engine: object = None
_async_session_factory: object = None


def get_engine():
    """Return async engine. Only created when DATABASE_URL is set. Raises if used when not configured."""
    global _engine
    if _engine is None:
        url = _get_database_url()
        if not url:
            raise RuntimeError("DATABASE_URL is not set; database features are disabled.")
        _engine = create_async_engine(
            url,
            echo=os.environ.get("SQL_ECHO", "").lower() in ("1", "true"),
        )
    return _engine


def get_async_session_factory():
    global _async_session_factory
    if _async_session_factory is None:
        _async_session_factory = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )
    return _async_session_factory


async def init_db() -> None:
    """Create all tables. Use Alembic in production; this is for dev/testing."""
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_async_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: yield a DB session and commit/rollback on exit."""
    if not is_db_configured():
        raise RuntimeError("DATABASE_URL is not set")
    factory = get_async_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def is_db_configured() -> bool:
    """True if we should use Postgres (DATABASE_URL set and not empty)."""
    return bool(os.environ.get("DATABASE_URL", "").strip())


async def check_db_connected() -> bool:
    """Return True if DB is configured and we can run a simple query."""
    if not is_db_configured():
        return False
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
