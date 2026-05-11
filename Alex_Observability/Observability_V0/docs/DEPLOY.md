# Deployment

This project targets **local development** and **on-prem Raspberry Pi** (see [RASPBERRY_PI.md](RASPBERRY_PI.md)).

- **Local:** `make run-backend` and `make dev`; Vite proxies `/api` to the FastAPI app.
- **Pi:** Build with `VITE_API_URL=` (empty) for same-origin `/api` behind nginx, run Uvicorn on `127.0.0.1:8000`, and follow the systemd + nginx steps in [RASPBERRY_PI.md](RASPBERRY_PI.md).

There is no hosted cloud stack in this tree (no Postgres, login, or relay agent).
