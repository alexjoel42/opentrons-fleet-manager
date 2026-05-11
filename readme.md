# Opentrons Fleet Manager

Application code lives under **`Alex_Observability/Observability_V0`**. Unless noted otherwise, run commands from that directory (the one with `package.json`, `Makefile`, and `backend/`).

## Local development

### 1. Go to the app directory

```bash
cd Alex_Observability/Observability_V0
```

### 2. One-time setup

```bash
make setup
```

### 3. Start the backend

```bash
make run-backend
```

### 4. Run the UI (second terminal, same directory)

```bash
make dev
```

(`make run` does the same thing.)

---

## Layout

The app is a **React + Vite + TypeScript** frontend and a **FastAPI** backend. The browser never calls robots directly; the API proxies to each robot by IP.

| Area | Path | Role |
|------|------|------|
| Frontend | `src/` | Pages, components, hooks, API clients |
| Backend | `backend/` | FastAPI (`demo_api.py`), local JSON stores for robot IPs and notes |
| Raspberry Pi deploy | `docs/RASPBERRY_PI.md` | systemd + nginx same-origin `/api` on the LAN |
| Project overview | `Observability_V0/skills.md` | Architecture notes |

Several folders include a **`skills.md`** for contributors (for example `src/skills.md`). Start with **`Observability_V0/skills.md`** for the big picture.

**Makefile shortcuts:**

- `make run-backend` — API on `http://localhost:8000`
- `make dev` — Vite dev server (proxies `/api` to the backend)

---

## Raspberry Pi (lab appliance)

To serve the built UI on port **80** and proxy **`/api`** to Uvicorn on localhost, follow **[Alex_Observability/Observability_V0/docs/RASPBERRY_PI.md](Alex_Observability/Observability_V0/docs/RASPBERRY_PI.md)**. Build the frontend with an empty `VITE_API_URL` so the browser uses same-origin `/api`.

---

## Release artifacts

Tag pushes **`v*`** run [`.github/workflows/release.yml`](.github/workflows/release.yml): build the frontend and attach **`observability-v0-frontend-<tag>.zip`** to the GitHub Release. Locally, `make build-release` zips `dist/` into `release-artifacts/`.
