# Observability V0

A **robot observability dashboard** for Opentrons fleets: add robots by IP, view health, modules, pipettes, runs, and logs, and download a troubleshooting zip (error summary + run log + robot log files).

---

## Architecture

```
  React (Vite, TS)  --/api/* (proxy)-->  FastAPI (Python, :8000)  --HTTP :31950-->  Opentrons robot(s)

  Backend reads/writes robot_ips.json (or ROBOT_IPS env) for the local IP list.
```

- **Frontend**: React + TypeScript + Vite + React Router. UI calls `/api/*`; in dev, Vite proxies to FastAPI so the browser never talks to robot IPs directly.
- **Backend**: FastAPI in `backend/demo_api.py`. Robot IPs live in `backend/robot_ips.json` (or seed from `ROBOT_IPS`). The app proxies health, modules, pipettes, logs, serial number, runs, protocol, and troubleshooting zip to each robot (default port **31950**).

**Main flows**

1. **Setup**: Add robot IPs or bulk-import; backend persists them.
2. **Dashboard**: Fleet snapshot and cards per robot.
3. **Robot detail**: Health, modules, pipettes, runs, logs, troubleshooting zip download.

---

## How to run

**Prerequisites:** Node.js and Python 3.10+ (see `backend/` typing).

From **Observability_V0**:

### One-time setup

```bash
make setup
```

### Backend (terminal 1)

```bash
make run-backend
```

FastAPI listens at **http://localhost:8000**.

### Frontend (terminal 2)

```bash
make dev
```

App URL: **http://localhost:5174** (see `vite.config.ts`).

### Environment

Copy `.env.example` to `.env`. For local dev with the Vite proxy, leave **`VITE_API_URL`** empty. Optionally set **`ROBOT_IPS`** on the backend to pre-seed IPs.

| Command            | Description                         |
|--------------------|-------------------------------------|
| `make setup`       | Install JS + Python deps            |
| `make dev`         | Vite dev server                     |
| `make run-backend` | FastAPI on port 8000                |
| `make typecheck`   | TypeScript (+ optional mypy)        |
| `make lint`        | ESLint + Ruff                       |
| `make build-release` | `npm run build`, zip `dist/` → `release-artifacts/` |
| `make help`        | List Make targets                   |

---

## Raspberry Pi

Run the stack on a Pi with systemd (API on boot), nginx (static `dist/` + `/api` proxy), and **`http://<hostname>.local`**: **[docs/RASPBERRY_PI.md](docs/RASPBERRY_PI.md)**.

---

## Deployment overview

See **[docs/DEPLOY.md](docs/DEPLOY.md)** (local + Pi only).

---

## Future ideas

- Tighten CORS and auth for multi-user deployments.
- Replace JSON files with a database if you need audit logs or shared state across hosts.
- WebSockets or SSE for push updates instead of polling.
- More tests around the robot proxy and UI flows.
