# Frontend — React app

**Purpose:** Dashboard UI: list robots (from backend), show per-robot status on cards, drill into a robot for health/modules/pipettes/logs and retry. In **cloud mode**, users also **configure robot addresses for the relay agent** (stored in the API DB, not on the agent machine).

**Structure:**
- **`api/`** — Fetch functions for backend; no direct robot URLs. See `api/skills.md`.
- **`hooks/`** — React Query hooks per resource (health, modules, pipettes, logs, list) and composed `useRobot(ip)`. See `hooks/skills.md`.
- **`components/`** — Reusable UI (`RobotCard`, **`CloudRobotPollTargets`**, etc.). See `components/skills.md`.
- **`pages/`** — Route-level views: `Dashboard`, `CloudDashboard`, `RobotDetail`, … See `pages/skills.md`.

**Entry:** `main.tsx` wraps app in `QueryClientProvider` and `BrowserRouter`. `App.tsx` defines routes: `/` (Setup), `/dashboard` (local `Dashboard` or **`CloudDashboard`** when `VITE_USE_CLOUD`), `/robot/:ip`, `/robot/cloud/:id`, `/login`.

**Config:** `VITE_API_URL` in `.env` — **must point at the FastAPI backend** (e.g. Render API URL) when using cloud mode + Fleet Manager; required for auth, `/api/cloud/*`, and **lab robot poll targets**. Vite proxy in `vite.config.ts` can send `/api` to backend in dev.
