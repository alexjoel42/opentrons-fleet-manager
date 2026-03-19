# Frontend — React app

**Purpose:** Dashboard UI: list robots (from backend), show per-robot status on cards, drill into a robot for health/modules/pipettes/logs and retry.

**Structure:**
- **`api/`** — Fetch functions for backend; no direct robot URLs. See `api/skills.md`.
- **`hooks/`** — React Query hooks per resource (health, modules, pipettes, logs, list) and composed `useRobot(ip)`. See `hooks/skills.md`.
- **`components/`** — Reusable UI (e.g. `RobotCard`). See `components/skills.md`.
- **`pages/`** — Route-level views: `Dashboard`, `RobotDetail`. See `pages/skills.md`.

**Entry:** `main.tsx` wraps app in `QueryClientProvider` and `BrowserRouter`. `App.tsx` defines routes: `/` (Dashboard), `/robot/:ip` (RobotDetail).

**Config:** `VITE_API_URL` in `.env` (optional if using Vite proxy). Vite proxy in `vite.config.ts` sends `/api` to backend.
