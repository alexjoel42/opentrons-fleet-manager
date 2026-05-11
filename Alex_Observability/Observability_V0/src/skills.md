# Frontend — React app

**Purpose:** Dashboard UI: list robots from the backend, show per-robot status on cards, drill into health/modules/pipettes/logs/runs.

**Structure**

- **`api/`** — Fetch helpers for FastAPI; see **`api/skills.md`**.
- **`hooks/`** — React Query hooks; see **`hooks/skills.md`**.
- **`components/`** — Shared UI; see **`components/skills.md`**.
- **`pages/`** — Route views; see **`pages/skills.md`**.

**Entry:** **`main.tsx`** wraps the app in **`QueryClientProvider`** and **`BrowserRouter`**. **`App.tsx`** routes: **`/`** (Setup), **`/dashboard`**, **`/robot/:ip`**, **`/robot/:ip/runs/:runId`**.

**Config:** **`VITE_API_URL`** — empty in dev (Vite proxies **`/api`**); empty for Pi/nginx same-origin builds; set only if the UI is served from a different origin than the API.
