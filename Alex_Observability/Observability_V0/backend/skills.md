# Backend — FastAPI + BaseRobot proxy + Cloud

**Purpose:** Expose Opentrons robot data to the frontend without CORS. All routes take a robot IP; the server calls the robot HTTP API (port 31950) via `BaseRobot`. When `DATABASE_URL` is set: PostgreSQL, user auth, labs, agent telemetry ingest, and **lab-scoped robot poll targets** for the relay agent (edited from the cloud UI, stored on **`Lab.robot_poll_targets`**).

**Files:**
- **demo_api.py:** BaseRobot (optional `scheme`/`port` per request for HTTP vs HTTPS), IP-based proxy routes (`/api/robots`, `/api/robots/{ip}/*`), health `/health` and `/api/health`, cloud + agent routes:
  - **Agent (Bearer lab token):** `POST /api/agent/telemetry`, **`GET /api/agent/robot-poll-targets`** — returns `{ lab_id, robots: [{ip, scheme, port}, ...] }` from `Lab.robot_poll_targets` (empty until set in UI).
  - **Auth / labs:** `POST /api/auth/login`, `POST /api/auth/signup`, `GET/POST /api/labs`, `GET /api/labs/{id}`, **`GET/PUT /api/labs/{lab_id}/robot-poll-targets`** (JWT; owner only; PUT body `{ robots: [...] }` validated with same address rules as local robot store).
  - **Tokens / cloud reads:** `POST /api/labs/{id}/tokens`, `GET /api/labs/{id}/robots`, `GET /api/cloud/robots`, `GET /api/cloud/robots/{id}`.
  - Cloud read routes require JWT (`get_current_user`); agent routes use Bearer token → `verify_agent_token` (**agent_auth**).
- **db.py:** Async engine/session only when `DATABASE_URL` set; `get_engine()`, `get_async_session_factory()`, `get_db_session()` (FastAPI dep), `init_db()`, `check_db_connected()`, `is_db_configured()`.
- **models.py:** User, Lab (**`robot_poll_targets` JSONB** — list of dicts), LabAgentToken, Robot, TelemetrySnapshot, Session (SQLAlchemy 2, async).
- **agent_auth.py:** `hash_agent_token`, `verify_agent_token(session, bearer_token)` → Lab or 401.
- **auth.py:** `hash_password`, `verify_password`, `create_access_token`, `decode_access_token`, `get_user_by_id`, `get_user_by_email`.
- **alembic/:** Migrations; **`001`** initial schema, **`002`** adds **`labs.robot_poll_targets`**. Run `alembic upgrade head` from this directory (or `make db-migrate` from repo root).

**Helpers:** `_is_valid_robot_address`, **`_normalize_robot_poll_targets`** (validates PUT body for robot-poll-targets). **`validate_ip`** for single-IP routes.

**BaseRobot:** All get_* methods accept optional `scheme` and `port` (e.g. HTTPS for lab robots). Default `http`, port 31950.

**Adding a new robot endpoint:** Add a method to `BaseRobot` (and optional scheme/port args), then add a route with the same try/except + `robot_http_error` pattern.

**Run:** `uvicorn demo_api:app --reload` from this directory. Cloud: set `DATABASE_URL`, run migrations through **`002`**, then use seed script or API to create labs/tokens; owners set **robot poll targets** via PUT or the Fleet Manager UI.
