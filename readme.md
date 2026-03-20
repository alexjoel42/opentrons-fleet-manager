# Opentrons Fleet Manager

Application code for the observability stack lives under **`Alex_Observability/Observability_V0`**. The sections below assume your shell’s current directory is that folder unless noted otherwise.

## Local environment

### 1. Go to the project root

From the root of this repository:

```bash
cd Alex_Observability/Observability_V0
```

If you keep the app elsewhere, `cd` to the directory that contains `package.json`, `Makefile`, and `backend/`.

### 2. One-time setup

```bash
make setup
```

### 3. Start the backend

Use the same terminal, or open another and `cd` to the same directory:

```bash
make run-backend
```

### 4. Run the app in development mode

In a **second** terminal (also at the project root):

```bash
make dev
```

(`make run` does the same thing; `make run dev` is also valid and ends up running the Vite dev server.)

---

## Local project layout and “skills” docs

The app is a **React + Vite + TypeScript** frontend talking to a **FastAPI** backend. The browser never calls robots directly; the API proxies to each robot by IP (local mode) or, in cloud mode, aggregates telemetry from a **relay agent** in the lab.

| Area | Path | Role |
|------|------|------|
| Frontend | `src/` | Pages, components, hooks, API clients |
| Backend | `backend/` | FastAPI app (`demo_api.py`), auth, DB (`models.py`, `db.py`), Alembic migrations |
| Relay agent | `agent/` | `run_agent.py` / [PyPI package](https://pypi.org/project/observability-agent/) **`observability-agent`** — polls robots and POSTs telemetry to the API |
| Deploy & agent guides | `docs/DEPLOY.md`, `docs/AGENT_SETUP.md` | Full production and agent setup |
| Project overview | `skills.md` (repo root of `Observability_V0`) | Architecture, cloud vs local, deployment notes, first-time cloud flow |

**Skills files for contributors:** Several folders include a **`skills.md`** that describes how that part of the codebase fits together (for example `src/skills.md`, `src/api/skills.md`, `src/components/skills.md`). Start with the root **`Observability_V0/skills.md`** for the big picture, then open the nearest `skills.md` when you change a specific layer.

**Useful Makefile targets (same directory as `Makefile`):**

- `make run-backend` — API on `http://localhost:8000`
- `make dev` — Vite dev server
- `make db-migrate` — Alembic (`DATABASE_URL` required)
- `make run-agent` — relay agent (set `LAB_ID`, `AGENT_TOKEN`, `BACKEND_URL` as documented in `docs/AGENT_SETUP.md`)

---

## Render (API) and Vercel (frontend)

Production is usually split: **static UI on Vercel**, **API + Postgres elsewhere** (e.g. **Render** for the web service and managed PostgreSQL). The detailed checklist lives in **`Alex_Observability/Observability_V0/docs/DEPLOY.md`**; this is the short version.

### Backend (e.g. Render)

1. Creates a **PostgreSQL** instance and set **`DATABASE_URL`** on the API service (async URL like `postgresql+asyncpg://...` is supported; plain `postgresql://` is normalized as needed).
2. Run migrations from `backend/` (see `DEPLOY.md` for the exact `alembic upgrade head` command).
3. Set **`JWT_SECRET`**, **`DATABASE_URL`**, and **`CORS_ORIGINS`** to your real frontend origin(s), e.g. `https://your-app.vercel.app` (no path; comma-separate multiple origins for preview URLs).
4. Deploy the FastAPI app with a production ASGI server (Uvicorn with workers, or Render’s default start command for your repo).

Without **`CORS_ORIGINS`** matching the Vercel URL, the browser will block cross-origin API calls.

### Frontend (Vercel)

1. Import the project in Vercel using the directory that contains **`package.json`** and **`vercel.json`** (`Observability_V0`). `vercel.json` rewrites all routes to **`index.html`** for the SPA.
2. In Vercel → **Settings → Environment Variables**, set at build time:
   - **`VITE_API_URL`** — full backend base URL, **no trailing slash** (e.g. `https://your-service.onrender.com`). Must be the same API base the relay agent uses as **`BACKEND_URL`**.
   - **`VITE_USE_CLOUD=true`** — enables login, labs, and cloud dashboard behavior.
   - Optional: **`VITE_STALE_THRESHOLD_SECONDS`** (default `60`) for “stale robot” UI.

3. Redeploy after changing env vars so Vite bakes them into the bundle.

### Relay agent (lab machine)

The agent does not run on Vercel or Render; it runs on hardware that can reach your robots. Install the [PyPI package](https://pypi.org/project/observability-agent/) **`observability-agent`** (or run from `agent/run_agent.py`), set **`LAB_ID`**, **`AGENT_TOKEN`**, and **`BACKEND_URL`**, and configure robot addresses in the cloud UI. See **`docs/AGENT_SETUP.md`**.

---

For troubleshooting (CORS, 401/500, migrations), use **`docs/DEPLOY.md`** first.
