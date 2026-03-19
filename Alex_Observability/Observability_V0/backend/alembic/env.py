"""Alembic env for async migrations. Run from backend dir: alembic upgrade head."""

import asyncio
import os
import sys

# Ensure backend is on path when running alembic from repo root or backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from models import Base

config = context.config
if config.config_file_name is not None:
    file_config = config.get_section(config.config_file_name) or {}
else:
    file_config = {}

# Prefer DATABASE_URL env; convert to async driver for Alembic
database_url = os.environ.get("DATABASE_URL", "").strip()
if database_url:
    if database_url.startswith("postgresql://") and not "asyncpg" in database_url:
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    config.set_main_option("sqlalchemy.url", database_url)
elif not config.get_main_option("sqlalchemy.url"):
    config.set_main_option(
        "sqlalchemy.url",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/observability",
    )

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (generate SQL only)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    configuration = {"sqlalchemy.url": config.get_main_option("sqlalchemy.url")}
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
