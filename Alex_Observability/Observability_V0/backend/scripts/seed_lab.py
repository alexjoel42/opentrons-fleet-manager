"""
Seed a lab and agent token for testing. Run from backend dir with DATABASE_URL set:
  python -m scripts.seed_lab "My Lab"
Prints the agent token (only shown once; store it securely).
"""
from __future__ import annotations

import asyncio
import os
import secrets
import sys

# Add parent so we can import from backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_auth import hash_agent_token
from db import get_async_session_factory, is_db_configured
from models import Lab, LabAgentToken


async def main() -> None:
    if not is_db_configured():
        print("Set DATABASE_URL to use this script.", file=sys.stderr)
        sys.exit(1)
    name = (sys.argv[1] or "Default Lab").strip()
    token_plain = secrets.token_urlsafe(32)
    token_hash = hash_agent_token(token_plain)

    factory = get_async_session_factory()
    async with factory() as session:
        lab = Lab(name=name)
        session.add(lab)
        await session.flush()
        session.add(LabAgentToken(lab_id=lab.id, token_hash=token_hash, label="seed"))
        await session.commit()
        print(f"Lab id: {lab.id}")
        print(f"Agent token (save this): {token_plain}")


if __name__ == "__main__":
    asyncio.run(main())
