# Observability V0 — Project overview

**Purpose:** Dashboard to view multiple Opentrons robots (by IP) on the same network: fleet list, per-robot health/modules/pipettes, error surfacing, and drill-down when a robot is down or restarting. Optional **cloud mode**: PostgreSQL + user auth; a local relay agent in the lab POSTs telemetry so scientists can view robots from anywhere. **Production robot addresses** are configured in the **cloud web app** (Fleet Manager), not on the agent.

**Architecture:**
- **Frontend:** React + Vite + TypeScript. Single origin; all robot data comes from the FastAPI backend (no direct browser → robot calls; avoids CORS). When `VITE_USE_CLOUD=true`, login, cloud labs/robots with staleness UI, and **Robot addresses (relay agent)** per lab (saved to DB; agent reads via API).
- **Backend:** FastAPI in `backend/`. Proxies requests to each robot by IP using `BaseRobot`; returns structured errors for unreachable/timeout. When `DATABASE_URL` is set: PostgreSQL (models in `models.py`, `db.py`), user auth (JWT), labs/robots/telemetry, `labs.robot_poll_targets` (JSON list of `{ip, scheme, port}`), `POST /api/agent/telemetry`, and **`GET /api/agent/robot-poll-targets`** (agent Bearer token) so the relay agent does not need IPs in its config file in production.
- **Agent:** `agent/run_agent.py` (PyPI name **`observability-agent`**, console script **`observability-agent`**). Default: **pulls poll targets from the cloud** every ~30s (`GET /api/agent/robot-poll-targets`); polls each robot (HTTP/HTTPS per target); POSTs telemetry; retries with backoff. **`--local-robots`** / `AGENT_USE_LOCAL_ROBOTS` / `use_local_robots` in JSON for dev-only local IP lists.

**Deployment:**
- **Postgres (e.g. Render):** Instance name **`observability-db`**; set `DATABASE_URL` from that service’s Internal connection string. Run **`alembic upgrade head`** (includes migration **`002`** for `labs.robot_poll_targets`).
- **Backend API:** Example production base **`https://opentrons-fleet-manager.onrender.com`** (no trailing slash). Use for **`VITE_API_URL`**, agent **`backend_url`**, `/docs`, `/health`.
- **Frontend:** e.g. **`https://opentrons-fleet-manager.vercel.app`** — set **`VITE_API_URL`** to the real API origin (not the static host alone). `VITE_USE_CLOUD=true` for login + cloud dashboard.
- **CI / release:** Repo **`.github/workflows/release.yml`** — on tag **`v*`**: build frontend, inject version into `agent/pyproject.toml`, `uv build agent/`, GitHub Release assets (frontend zip + wheel/sdist), job **`publish-pypi`** (environment **`pypi`**, OIDC **`id-token: write`**) uploads **`observability-agent`** to PyPI via **`pypa/gh-action-pypi-publish`**. PyPI **trusted publisher** must match: project name **`observability-agent`**, workflow **`release.yml`**, repo owner/name, optional GitHub Environment **`pypi`**.

**Key choices:**
- React Query per resource (health, modules, pipettes, logs) with query keys `['robot', ip, resource]`. Retries + refetchInterval for restarts; errors surfaced in UI.
- Robot list: **local mode** from `GET /api/robots` (IP list in `robot_ips.json` / Setup); **cloud mode** from `GET /api/cloud/robots` (JWT, `last_seen_at`, staleness). **Agent poll list** is **not** the local `/api/robots` store — it is **`labs.robot_poll_targets`** edited in the cloud UI.
- Cloud read routes under `/api/cloud/*` to avoid clashing with IP-based `/api/robots/{ip}/*`.

**Run:**
- **Local:** Backend `make run-backend` (or `uvicorn demo_api:app --reload` from `backend/`). Frontend `make dev`. Set `ROBOT_IPS` or add IPs in Setup (local fleet only).
- **Cloud:** `DATABASE_URL`, migrate, signup + labs + agent token. Frontend: `VITE_USE_CLOUD=true`, `VITE_API_URL` → API. **Add robot addresses** in dashboard (**Robot addresses (relay agent)**). Agent: minimal `agent_config.json` (`lab_id`, `agent_token`, `backend_url` only) or `make run-agent` — no `robots` key unless `--local-robots`.

**Docs:** `docs/AGENT_SETUP.md` (install, cloud vs local robots, **PyPI publish** + trusted publisher table), `docs/DEPLOY.md`.

**Directories:** `backend/` (FastAPI, db, models, auth, agent_auth, alembic), `agent/` (`run_agent.py`, `pyproject.toml`, `agent_config.example.json`), `src/` (api, components including **`CloudRobotPollTargets`**, pages: Login, CloudDashboard, CloudRobotDetail), `.github/workflows/release.yml`.
