# Pages — Route-level views

**Purpose:** Top-level screens matched to routes. Handle loading/error/empty and render layout.

**Current:**
- **Setup** — Route `/`. Add/remove robot IPs for **local** fleet (`GET/POST /api/robots` store); link to dashboard. Does not configure the cloud relay agent poll list.
- **Dashboard** — Route `/dashboard`. When not cloud: uses `useRobotList()`; grid of `RobotCard` per IP. When cloud (`VITE_USE_CLOUD=true`): shows **`CloudDashboard`** (requires login): includes **`CloudRobotPollTargets`** (**Robot addresses (relay agent)**) — per-lab editor for IPs/hostnames, scheme, port, bulk import; saves to **`PUT /api/labs/{lab_id}/robot-poll-targets`**. Below that: labs summary + cloud robot cards (`GET /api/cloud/robots`), "Last updated X ago", staleness warning if `isStale(last_seen_at)`.
- **RobotDetail** — Route `/robot/:ip`. Uses `useRobot(ip)`, etc.; health, modules, pipettes, logs, runs, troubleshooting zip.
- **CloudRobotDetail** — Route `/robot/cloud/:id`. Uses `fetchCloudRobot(token, id)`; health, runs, logs; shows last_seen_at and staleness (same as cloud dashboard cards).
- **Login** — Route `/login`. Sign in / sign up; on success store token and redirect to `/dashboard`.

**Routing:** `App.tsx` uses `AuthProvider`; when cloud mode, `CloudGuard` redirects to `/login` if no token. `DashboardOrCloud` renders `CloudDashboard` when `VITE_USE_CLOUD`, else `Dashboard`.

**Convention:** One component per route; use hooks or cloudApi; keep layout and copy here. For a new route, add it in `App.tsx` and a new page in this folder.
