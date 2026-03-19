# Backend — FastAPI + BaseRobot proxy + Cloud

**Purpose:** Expose Opentrons robot data to the frontend without CORS. All routes take a robot IP; the server calls the robot HTTP API (port 31950) via `BaseRobot`. When `DATABASE_URL` is set: PostgreSQL, user auth, labs, and agent telemetry ingest.

**Files:**
- **demo_api.py:** BaseRobot (optional `scheme`/`port` per request for HTTP vs HTTPS), IP-based proxy routes (`/api/robots`, `/api/robots/{ip}/*`), health `/health` and `/api/health`, cloud routes: `POST /api/agent/telemetry`, `POST /api/auth/login`, `POST /api/auth/signup`, `GET /api/labs`, `POST /api/labs`, `GET /api/labs/{id}/robots`, `POST /api/labs/{id}/tokens`, `GET /api/cloud/robots`, `GET /api/cloud/robots/{id}`. Cloud read routes require JWT (`get_current_user`); agent ingest uses Bearer token → `verify_agent_token` (agent_auth).
- **db.py:** Async engine/session only when `DATABASE_URL` set; `get_engine()`, `get_async_session_factory()`, `get_db_session()` (FastAPI dep), `init_db()`, `check_db_connected()`, `is_db_configured()`.
- **models.py:** User, Lab, LabAgentToken, Robot, TelemetrySnapshot, Session (SQLAlchemy 2, async).
- **agent_auth.py:** `hash_agent_token`, `verify_agent_token(session, bearer_token)` → Lab or 401.
- **auth.py:** `hash_password`, `verify_password`, `create_access_token`, `decode_access_token`, `get_user_by_id`, `get_user_by_email`.
- **alembic/:** Migrations; run `alembic upgrade head` from this directory (or `make db-migrate` from repo root).

**BaseRobot:** All get_* methods accept optional `scheme` and `port` (e.g. HTTPS for 198.51.100.73). Default `http`, port 31950.

**Adding a new robot endpoint:** Add a method to `BaseRobot` (and optional scheme/port args), then add a route with the same try/except + `robot_http_error` pattern.

**Run:** `uvicorn demo_api:app --reload` from this directory. Cloud: set `DATABASE_URL`, run migrations, then use seed script or API to create labs/tokens.
