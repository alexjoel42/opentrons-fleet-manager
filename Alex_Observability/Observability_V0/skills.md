# Observability V0 — Project overview

**Purpose:** Dashboard to view multiple Opentrons robots (by IP) on the same network: fleet list, per-robot health/modules/pipettes, error surfacing, and drill-down when a robot is down or restarting. Optional **cloud mode**: PostgreSQL + user auth; a local relay agent in the lab POSTs telemetry so scientists can view robots from anywhere.

**Architecture:**
- **Frontend:** React + Vite + TypeScript. Single origin; all robot data comes from the FastAPI backend (no direct browser → robot calls; avoids CORS). When `VITE_USE_CLOUD=true`, login and cloud labs/robots with staleness UI.
- **Backend:** FastAPI in `backend/`. Proxies requests to each robot by IP using `BaseRobot`; returns structured errors for unreachable/timeout. When `DATABASE_URL` is set: PostgreSQL (models in `models.py`, `db.py`), user auth (JWT), labs/robots/telemetry, and `POST /api/agent/telemetry` for the relay agent.
- **Agent:** `agent/run_agent.py` runs in the lab; polls robots (HTTP or HTTPS per IP, e.g. 198.51.100.73 / 203.0.113.198 over HTTPS); POSTs to backend every 5s; retries with backoff.

**Key choices:**
- React Query per resource (health, modules, pipettes, logs) with query keys `['robot', ip, resource]`. Retries + refetchInterval for restarts; errors surfaced in UI.
- Robot list: local mode from `GET /api/robots` (IP list); cloud mode from `GET /api/cloud/robots` (JWT, last_seen_at, staleness).
- Cloud read routes under `/api/cloud/*` to avoid clashing with IP-based `/api/robots/{ip}/*`.

**Run:**
- **Local:** Backend `make run-backend` (or `uvicorn demo_api:app --reload` from `backend/`). Frontend `make dev`. Set `ROBOT_IPS` or add IPs in Setup.
- **Cloud:** Set `DATABASE_URL`, then `make db-migrate`, `make seed-lab` (or signup + create lab via API). Frontend: `VITE_USE_CLOUD=true`, `VITE_API_URL` to backend. Agent: `make run-agent` or `python agent/run_agent.py --config=agent/agent_config.json`.

**Directories:** `backend/` (FastAPI, db, models, auth, agent_auth), `agent/` (run_agent.py, config example), `src/` (api/, lib/authContext, pages: Login, CloudDashboard, CloudRobotDetail), `docs/` (AGENT_SETUP.md, DEPLOY.md).
