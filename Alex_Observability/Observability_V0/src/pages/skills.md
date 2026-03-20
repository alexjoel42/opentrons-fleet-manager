# Pages — Route-level views

**Purpose:** Top-level screens matched to routes. Handle loading/error/empty and render layout.

**Current:**
- **Setup** — Route `/`. Add/remove robot IPs for **local** fleet (`GET/POST /api/robots` store); link to dashboard. Does not configure the cloud relay agent poll list.
- **Dashboard** — Route `/dashboard`. When not cloud: uses `useRobotList()`; grid of `RobotCard` per IP. When cloud (`VITE_USE_CLOUD=true`): shows **`CloudDashboard`** (requires login). **`CloudSetupAccordion`** sections (**Relay agent credentials** with **`CloudAgentCredentials` `embedded`**, **Robot addresses** with **`CloudRobotPollTargets` `embedded`** when at least one lab exists) default **open**; headers toggle collapse. Then **`FleetStatusSummaryTable`** + “Fleet at a glance” + filter pills (same parity as local fleet), then cloud robot cards (`GET /api/cloud/robots`) with "Last updated X ago" and staleness warnings.
- **RobotDetail** — Route `/robot/:ip`. Uses `useRobot(ip)`, etc.; health, modules, pipettes, logs, runs, troubleshooting zip.
- **CloudRobotDetail** — Route `/robot/cloud/:id`. Uses `fetchCloudRobot(token, id)`; health, runs, logs; shows last_seen_at and staleness (same as cloud dashboard cards).
- **Login** — Route `/login`. Sign in / sign up; on success store token and redirect to `/dashboard`.

**Routing:** `App.tsx` uses `AuthProvider`; when cloud mode, `CloudGuard` redirects to `/login` if no token. `DashboardOrCloud` renders `CloudDashboard` when `VITE_USE_CLOUD`, else `Dashboard`.

**Convention:** One component per route; use hooks or cloudApi; keep layout and copy here. For a new route, add it in `App.tsx` and a new page in this folder.
