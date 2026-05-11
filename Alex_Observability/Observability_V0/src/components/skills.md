# Components — Reusable UI

**Purpose:** Presentational or small container pieces used by pages.

- **RobotCard** — **`ip`**, optional **`onRemove`**. **`useRobotHealth(ip)`**; link to **`/robot/:ip`**.
- **AppLayout** — Header, logo, nav (Setup, Dashboard), **`Outlet`** for pages.
- **FleetStatusLegendBar**, **FleetStatusSummaryTable**, **ImportRobotIps** — fleet UX.

Prefer hooks for data; show loading/error/success states consistently.
