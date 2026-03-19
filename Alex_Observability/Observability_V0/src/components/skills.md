# Components — Reusable UI

**Purpose:** Presentational or small container components used by pages.

**Current:**
- **RobotCard** — Accepts `ip`, optional `onRemove`. Uses `useRobotHealth(ip)`; shows IP, status (ok/loading/error), "View details". Renders a `Link` to `/robot/:ip`. Used on Dashboard (local mode).
- **AppLayout** — Header with logo, nav (Setup when not cloud, Dashboard, Sign out when cloud + token). Uses `useAuth()` for `isCloudMode`, `token`, `logout`.

**Cloud dashboard** renders its own card list (links to `/robot/cloud/:id`) with last_seen_at and staleness styling; no shared RobotCard for cloud to keep cloud-specific props (stale, lastSeenLabel).

**Convention:** Components receive minimal props; they call hooks when they need data. For new cards or tiles, follow the same pattern: hook for data, show loading/error/success, link to detail when relevant.
