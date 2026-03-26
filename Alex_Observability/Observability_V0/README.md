# Observability V0

A minimal **robot observability dashboard** for Opentrons fleets. It lets you add robots by IP, view health, modules, pipettes, runs, and logs, and download a troubleshooting zip (error summary + run log + robot log files).

---

## High-Level Architecture

```
  React (Vite, TS)  --/api/* (proxy)-->  FastAPI (Python, :8000)  --HTTP :31950-->  Opentrons robot(s)

  Backend reads/writes robot_ips.json (or ROBOT_IPS env) for the local IP list.
```

- **Frontend**: React 19 + TypeScript + Vite + React Router. UI calls `/api/*`; in dev, Vite proxies those requests to the FastAPI backend so the browser never talks to robot IPs directly (avoids CORS and keeps robot addresses server-side).
- **Backend**: FastAPI app in `backend/demo_api.py`. It stores robot IPs in `backend/robot_ips.json` (or seeds from `ROBOT_IPS` env on first load), then proxies health, modules, pipettes, logs, serial number, runs, and troubleshooting zip to the Opentrons HTTP API on each robot (default port **31950**).
- **Robot API**: Opentrons robots expose a REST API; this app uses endpoints such as `/health`, `/modules`, `/pipettes`, `/logs`, `/runs`, and `/logs/{id}`.

**Main flows:**

1. **Setup**: User adds robot IPs (or imports many at once from ABR-style `IPs.json` with `ip_address_list`, or a comma-separated list) on the Setup page; backend persists them and returns the list.
2. **Dashboard**: Lists robots; each card can show health and link to a detail page.
3. **Robot detail**: Health, modules, pipettes, run history, logs, and a “download troubleshooting zip” that bundles an error summary, run payload + commands, and robot log files.

---

## How to Run

**Prerequisites:** Node.js (for frontend), Python 3 (for backend).

From the **Observability_V0** directory:

### 1. One-time setup

```bash
make setup
```

This installs npm dependencies and creates a Python venv (`.venv`) with backend dependencies. Activate the venv when you need to run the backend:

```bash
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
```

### 2. Start the backend (required for robot data)

In one terminal:

```bash
make run-backend
```

This starts the FastAPI server at **http://localhost:8000**. The frontend will send all `/api` requests here (via Vite proxy in dev).

### 3. Start the frontend

In another terminal:

```bash
make dev
```

(or `npm run dev`). The app is at **http://localhost:5174** (port in `vite.config.ts`).

### 4. Optional environment

- **Frontend**: Copy `.env.example` to `.env`. For local dev with the Vite proxy, `VITE_API_URL` can be empty or point to `http://localhost:8000` (see `src/api/robotApi.ts`).
- **Backend**: Optionally set `ROBOT_IPS=192.0.2.10,192.0.2.11` to pre-seed robot IPs when `robot_ips.json` is missing.

**Quick reference:**

| Command            | Description                                  |
|--------------------|----------------------------------------------|
| `make setup`       | Install JS + Python deps                     |
| `make dev`         | Start Vite dev server                        |
| `make run-backend` | Start FastAPI on port 8000                   |
| `make db-migrate`  | Run Alembic migrations (set `DATABASE_URL`) |
| `make seed-lab`    | Create a lab and print agent token (optional `LAB_NAME="My Lab"`) |
| `make run-agent`   | Start relay agent (set `LAB_ID`, `AGENT_TOKEN`, `BACKEND_URL` or use `--config`) |
| `make typecheck`   | TypeScript + Python type checks              |
| `make lint`        | ESLint + Ruff                                |
| `make help`        | List all Make targets                        |

**Release (validate automation locally):** From this directory, `make build-release` builds the frontend and Python agent (using [uv](https://github.com/astral-sh/uv) if installed, else pip + build), zips the frontend `dist/`, and writes artifacts to `release-artifacts/`. Use `make test-release` to run that and then install the wheel and run `observability-agent --help`. To test only the agent (no frontend build), use `make build-release-agent` and `make test-release-agent`. Override version with `make build-release RELEASE_VERSION=1.0.0`.

---

## Cloud + Local Agent (optional)

You can run the app in **cloud mode**: the backend uses PostgreSQL and user auth; a **local relay agent** in the lab polls robots and POSTs telemetry to the cloud. Scientists can then view robot status from anywhere (no VPN).

- **Backend**: Set `DATABASE_URL` (PostgreSQL). Run migrations: `make db-migrate` (or `cd backend && alembic upgrade head`). Create a user and lab via signup and the API, or run `make seed-lab` (optionally `make seed-lab LAB_NAME="My Lab"`) to seed a lab and print an agent token.
- **Frontend**: Set `VITE_USE_CLOUD=true` and `VITE_API_URL` to your cloud backend URL. Users sign in and see labs/robots; "Last updated X ago" and a staleness warning when data is older than 60s (configurable via `VITE_STALE_THRESHOLD_SECONDS`).
- **Agent**: On a machine in the lab that can reach the robots, export `LAB_ID`, `AGENT_TOKEN`, and `BACKEND_URL`, then `make run-agent` or `python agent/run_agent.py` (no JSON file required). **Robot IPs are configured in the cloud app** (dashboard → *Robot addresses (relay agent)*); the agent loads them via `GET /api/agent/robot-poll-targets`. Default poll interval is **60 seconds** (`ROBOT_POLL_INTERVAL_SECONDS`). The web UI uses the same cadence by default (`VITE_POLL_INTERVAL_MS`, default 60000) to limit API traffic. Optional `--config=agent/agent_config.json` for file-based config. Use `--local-robots` only for dev. See [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md) and [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Deploy to Vercel (frontend)

You can host the **frontend** on [Vercel](https://vercel.com):

1. Push the repo (or the `Alex_Observability/Observability_V0` folder) and import the project in Vercel. Use the project root where `package.json` and `vercel.json` live.
2. In Vercel → Project → Settings → Environment Variables, set **`VITE_API_URL`** to your backend URL (e.g. `https://your-backend.fly.dev` or `https://your-api.railway.app`). No trailing slash. This is required because the app calls `/api/*` relative to that base.
3. Deploy. The app will be a static SPA; all routes (e.g. `/dashboard`, `/robot/192.0.2.10`) are handled by client-side routing.

**Backend:** The FastAPI backend cannot run on Vercel for the “robot by IP” use case: it must reach robot IPs (e.g. `192.0.2.17`) on your network, so it has to run on a machine that can reach those IPs (your laptop, a server on the same LAN, or a host with VPN access). For **cloud mode** (labs, agent relay), you can run the backend elsewhere (e.g. Railway, Render, Fly.io) and point `VITE_API_URL` to it; the frontend on Vercel will then work with that cloud backend.

---

## Future Steps

- **Security & auth**: Add authentication and restrict CORS to the real frontend origin; avoid storing sensitive data in `robot_ips.json` in production.
- **Persistence**: Replace the JSON file with a proper database for robot list, audit log, and optional user/preferences.
- **Real-time updates**: Use WebSockets or SSE from the backend to push health/log/run updates instead of polling.
- **Run details**: Dedicated page for a single run (protocol, commands, errors) with deep links from the run list.
- **Fleet-level views**: Aggregated health, fleet-wide run history, and simple metrics (success rate, uptime).
- **Tests**: Unit tests for backend proxy and robot client; e2e tests for critical UI flows (add robot, view detail, download zip).
- **Production**: Build frontend (`npm run build`), serve it via FastAPI or a static host, and run the backend with a production ASGI server (e.g. Uvicorn with workers) behind a reverse proxy.
