# Observability V0 — Project overview

**Purpose:** Dashboard for multiple Opentrons robots on the LAN: fleet list, per-robot health/modules/pipettes/runs/logs, and troubleshooting zip download. Data flows browser → FastAPI → robot HTTP API (:31950); robot IPs are stored in **`backend/robot_ips.json`** (or `ROBOT_IPS` env).

**Architecture**

- **Frontend:** React + Vite + TypeScript. Calls **`/api/*`** only; Vite proxies to FastAPI in dev; Raspberry Pi + nginx uses same-origin **`/api`** in production.
- **Backend:** FastAPI **`demo_api.py`**. **`BaseRobot`** wraps Opentrons REST calls. Local fleet routes under **`/api/robots`** and **`/api/robots/{ip}/...`**; notes in **`robot_notes.json`**.

**Deployment**

- **Local:** `make run-backend` + `make dev`.
- **Pi:** **[docs/RASPBERRY_PI.md](docs/RASPBERRY_PI.md)** — build with empty **`VITE_API_URL`**, nginx proxies **`/api`** to Uvicorn on localhost.

**CI:** **[`.github/workflows/release.yml`](../../.github/workflows/release.yml)** — on tag **`v*`**, build frontend and attach **`observability-v0-frontend-<tag>.zip`** to the GitHub Release.

**Docs:** **[docs/DEPLOY.md](docs/DEPLOY.md)**.

**Directories:** `backend/` (FastAPI), `src/` (React app).
