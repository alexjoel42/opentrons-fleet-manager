# Components — Reusable UI

**Purpose:** Presentational or small container components used by pages.

**Current:**
- **RobotCard** — Accepts `ip`, optional `onRemove`. Uses `useRobotHealth(ip)`; shows IP, status (ok/loading/error), "View details". Renders a `Link` to `/robot/:ip`. Used on Dashboard (local mode).
- **AppLayout** — Header with logo, nav (Setup when not cloud, Dashboard, Sign out when cloud + token). Uses `useAuth()` for `isCloudMode`, `token`, `logout`.
- **CloudRobotPollTargets** — **`token` prop** (JWT). Lab dropdown (`fetchLabs`), loads/saves **`fetchRobotPollTargets` / `saveRobotPollTargets`** per lab. Rows: address, scheme (http/https), port, remove; **Add row**; **bulk import** textarea using **`parseRobotIpsFromText`** (merges addresses, default scheme https except localhost). **Save to cloud** persists **`labs.robot_poll_targets`** — this is what the **relay agent** reads via **`GET /api/agent/robot-poll-targets`**, not local agent config.
- **ImportRobotIps** — Bulk import for **local** dashboard (`importRobotIpsBulk` → local IP store). Distinct from cloud poll targets.

**Cloud dashboard** also renders its own fleet card list (links to `/robot/cloud/:id`) with last_seen_at and staleness styling; cloud cards are separate from `RobotCard` to keep cloud-specific props (stale, lastSeenLabel).

**Convention:** Components receive minimal props; they call hooks when they need data. For new cards or tiles, follow the same pattern: hook for data, show loading/error/success, link to detail when relevant.
