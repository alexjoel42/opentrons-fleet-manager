# Deployment (Cloud + Local Agent)

Deploy the FastAPI backend and React frontend to the cloud; run the relay agent in each lab.

## Backend (FastAPI + PostgreSQL)

1. **Database**: Create a PostgreSQL instance (e.g. AWS RDS, Supabase, Render Postgres). Set `DATABASE_URL` to the connection string (use `postgresql+asyncpg://...` for async driver, or the app will convert `postgresql://`).

2. **Migrations**: Run Alembic from the backend directory:
   ```bash
   cd backend
   export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
   alembic upgrade head
   ```

3. **Environment**:
   - `DATABASE_URL` – PostgreSQL connection string (required for cloud features).
   - `JWT_SECRET` – Secret for signing JWTs (set a strong value in production).
   - `CORS_ORIGINS` – Comma-separated frontend origins (e.g. `https://your-app.vercel.app`). Trailing slashes are normalized away at startup so `https://app.vercel.app/` still matches the browser’s `Origin`. If unset, the API allows `*` (fine for dev; set this in production).
   - `SQL_ECHO` – Set to `1` or `true` to log SQL (optional, for debugging).

4. **Run**: Use a production ASGI server (e.g. Uvicorn with workers) behind a reverse proxy (HTTPS). Example:
   ```bash
   uvicorn demo_api:app --host 0.0.0.0 --port 8000 --workers 2
   ```
   Or deploy as a Docker container / to Render, Railway, etc., with the same env vars.

5. **CORS**: Set `CORS_ORIGINS` to your real frontend URL(s). Dependencies pin `bcrypt<4.1` so `passlib` password hashing works on signup (bcrypt 4.1+ breaks passlib 1.7.4); redeploy after pulling so signup/login work reliably.

### Render (API) + Vercel (frontend)

If the UI is on Vercel and the API on Render (or any split origin), the **browser** calls the API cross-origin. You **must** set `CORS_ORIGINS` on the backend to the exact Vercel origin (scheme + host, no path):

- **Render deploys:** In the Render dashboard, ensure the web service is connected to your repo with **auto-deploy** enabled for the branch you push to, or run **Manual Deploy** after changing code or env vars. Otherwise the live URL can stay on an old build until something triggers a redeploy.

- Example: `CORS_ORIGINS=https://opentrons-fleet-manager.vercel.app`
- For preview deployments, add comma-separated origins: `https://opentrons-fleet-manager.vercel.app,https://your-app-git-main-org.vercel.app`

Without this, the browser shows **CORS** errors and the app cannot load labs or tokens.

**401 on `/api/auth/login`:** Wrong credentials, user missing, or bcrypt/passlib mismatch — see the CORS bullet above; use pinned `bcrypt` per `backend/requirements.txt`.

**500 on `/api/labs` (or other API routes):** Usually database-related — confirm `DATABASE_URL` on Render, run `alembic upgrade head` against that database, and check Render service logs.

## Frontend (React / Vite)

1. **Build**:
   ```bash
   npm ci
   npm run build
   ```

2. **Environment** (at build time):
   - `VITE_API_URL` – Full URL of the deployed backend (e.g. `https://your-service.onrender.com`). No trailing slash. **Same host** the relay agent must call (the agent uses `BACKEND_URL` on the lab machine, not this file — see [AGENT_SETUP.md](AGENT_SETUP.md)).
   - `VITE_USE_CLOUD=true` – Enables login, cloud labs, and cloud robot list/detail with staleness.
   - `VITE_STALE_THRESHOLD_SECONDS=60` – Optional; seconds after which robot data is shown as stale (default 60).

3. **Host**: Serve the `dist/` output with any static host (Vercel, S3 + CloudFront, Netlify, etc.). Ensure API requests are sent to the backend URL (no proxy required if `VITE_API_URL` is set).

## Agent distribution

- **Option A**: Publish the `agent/` directory (e.g. in a GitHub release) with `run_agent.py` and `requirements.txt`. Users install with `pip install -r agent/requirements.txt` and run with their config.
- **Option B**: Install from PyPI (`pip install observability-agent`) and run the **`observability-agent`** CLI — same flags as `python agent/run_agent.py` from a git checkout (see [AGENT_SETUP.md](AGENT_SETUP.md)).

## Quick start (end-to-end)

1. Deploy backend + DB and run migrations; deploy frontend with `VITE_USE_CLOUD=true` and `VITE_API_URL` set.
2. Open the app, sign up, create a lab, and generate an agent token (via API `POST /api/labs/{lab_id}/tokens` or future UI).
3. In the web app (cloud dashboard), open **Robot addresses (relay agent)** for your lab and add each robot’s IP/hostname, scheme (http/https), and port. This is stored in the database (`labs.robot_poll_targets`); the agent loads it from `GET /api/agent/robot-poll-targets`, not from a local list.
4. On the lab machine, set **`LAB_ID`**, **`AGENT_TOKEN`**, and **`BACKEND_URL`** (same base URL as `VITE_API_URL`) and run the agent — **no JSON file required**:
   - **From repo:** `python agent/run_agent.py`
   - **From PyPI:** `observability-agent`
   Optional: `ROBOT_POLL_INTERVAL_SECONDS` (default **60** seconds per cycle to limit Render load). Advanced users can still use `--config=agent_config.json`; see [AGENT_SETUP.md](AGENT_SETUP.md).
5. Refresh the dashboard; robots should appear with “Last updated X s ago”. If the agent stops, data will show as stale after the threshold (e.g. 60s).

## Backups and security

- **Database**: Enable automated backups on your Postgres instance.
- **Secrets**: Store `DATABASE_URL`, `JWT_SECRET`, and agent tokens in a secrets manager; never commit them.
- **HTTPS**: Use HTTPS for the backend and frontend in production.
