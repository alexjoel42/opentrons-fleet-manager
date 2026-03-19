"""Agent token hashing and verification for POST /api/agent/telemetry."""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select

from models import Lab, LabAgentToken

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def hash_agent_token(token: str) -> str:
    """Return SHA-256 hex digest of the token (for storage and lookup)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def verify_agent_token(session: AsyncSession, bearer_token: str) -> Lab:
    """Look up lab by token hash. Raises HTTPException 401 if invalid."""
    if not bearer_token or not bearer_token.strip():
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token_hash = hash_agent_token(bearer_token.strip())
    result = await session.execute(
        select(LabAgentToken).where(LabAgentToken.token_hash == token_hash).limit(1)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    lab = await session.get(Lab, row.lab_id)
    if not lab:
        raise HTTPException(status_code=401, detail="Lab not found")
    return lab
