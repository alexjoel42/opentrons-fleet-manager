# Pages — Route-level views

**Purpose:** Top-level screens matched to routes. Handle loading/error/empty.

- **Setup** — **`/`**. Add/remove robot IPs (**`/api/robots`**).
- **Dashboard** — **`/dashboard`**. **`useRobotList()`**, **`FleetStatusSummaryTable`**, **`RobotCard`** grid.
- **RobotDetail** — **`/robot/:ip`**. Health, modules, pipettes, logs, runs, troubleshooting zip.
- **RunDetail** — **`/robot/:ip/runs/:runId`**. Run and protocol detail.

Add new routes in **`App.tsx`** and new files in this folder.
