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
   - `SQL_ECHO` – Set to `1` or `true` to log SQL (optional, for debugging).

4. **Run**: Use a production ASGI server (e.g. Uvicorn with workers) behind a reverse proxy (HTTPS). Example:
   ```bash
   uvicorn demo_api:app --host 0.0.0.0 --port 8000 --workers 2
   ```
   Or deploy as a Docker container / to Render, Railway, etc., with the same env vars.

5. **CORS**: In production, set `allow_origins` in the FastAPI CORS middleware to your frontend origin(s) only.

## Frontend (React / Vite)

1. **Build**:
   ```bash
   npm ci
   npm run build
   ```

2. **Environment** (at build time):
   - `VITE_API_URL` – Full URL of the deployed backend (e.g. `https://api.your-app.com`). No trailing slash.
   - `VITE_USE_CLOUD=true` – Enables login, cloud labs, and cloud robot list/detail with staleness.
   - `VITE_STALE_THRESHOLD_SECONDS=60` – Optional; seconds after which robot data is shown as stale (default 60).

3. **Host**: Serve the `dist/` output with any static host (Vercel, S3 + CloudFront, Netlify, etc.). Ensure API requests are sent to the backend URL (no proxy required if `VITE_API_URL` is set).

## Agent distribution

- **Option A**: Publish the `agent/` directory (e.g. in a GitHub release) with `run_agent.py` and `requirements.txt`. Users install with `pip install -r agent/requirements.txt` and run with their config.
- **Option B**: Package as a PyPI package (e.g. `opentrons-observability-agent`) with a CLI entry point.

## Quick start (end-to-end)

1. Deploy backend + DB and run migrations; deploy frontend with `VITE_USE_CLOUD=true` and `VITE_API_URL` set.
2. Open the app, sign up, create a lab, and generate an agent token (via API `POST /api/labs/{lab_id}/tokens` or future UI).
3. In the lab, copy `agent/agent_config.example.json` to `agent_config.json`, fill in `lab_id`, `agent_token`, and `backend_url`, and set `robots` (e.g. 198.51.100.73 and 203.0.113.198 with `scheme: "https"`, localhost with `scheme: "http"` — replace with your robots’ real IPs).
4. Run `python agent/run_agent.py --config=agent/agent_config.json`.
5. Refresh the dashboard; robots should appear with “Last updated X s ago”. If the agent stops, data will show as stale after the threshold (e.g. 60s).

## Backups and security

- **Database**: Enable automated backups on your Postgres instance.
- **Secrets**: Store `DATABASE_URL`, `JWT_SECRET`, and agent tokens in a secrets manager; never commit them.
- **HTTPS**: Use HTTPS for the backend and frontend in production.
