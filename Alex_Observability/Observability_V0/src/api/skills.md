# API layer — Backend client

**Purpose:** Single place that calls the FastAPI backend. All URLs are `BASE + /api/...`; browser never hits robot IPs.

**robotApi.ts** (local / IP-based mode):
- **BASE:** `import.meta.env.VITE_API_URL ?? ''` (empty = same origin; use with Vite proxy or set to backend URL).
- **Exports:** `fetchRobotList()`, `addRobotIp`, `importRobotIpsBulk`, `removeRobotIp`, `fetchRobotHealth(ip)`, `fetchRobotModules(ip)`, `fetchRobotPipettes(ip)`, `fetchRobotLogs(ip)`, `fetchRobotSerialNumber(ip)`, `fetchRobotRuns(ip)`, `fetchTroubleshootingZip(ip, runId?)`.
- **Errors:** On non-OK response, parse JSON and read `detail.error` (FastAPI) or `error`; throw `new Error(message)` so React Query sees a single error type.

**cloudApi.ts** (when `VITE_USE_CLOUD=true`):
- **Auth:** `login(email, password)`, `signup(email, password)` → `{ access_token }`.
- **Labs / robots:** `fetchLabs(token)`, `fetchCloudRobots(token, labId?)`, `fetchCloudRobot(token, robotId)`; all require `Authorization: Bearer <token>`.
- **Relay agent poll targets (cloud source of truth for IPs):** Types **`RobotPollTarget`** `{ ip, scheme, port }`. **`fetchRobotPollTargets(token, labId)`** → `GET /api/labs/{lab_id}/robot-poll-targets`. **`saveRobotPollTargets(token, labId, robots)`** → `PUT` same path with `{ robots }`. Used by **`CloudRobotPollTargets`** so operators do not put IPs on the agent machine in production.
- **Staleness:** `STALE_THRESHOLD_SECONDS` (env `VITE_STALE_THRESHOLD_SECONDS` or 60), `isStale(lastSeenAt)`, `lastSeenLabel(lastSeenAt)` for "X s ago" / "X m ago".

**Adding a new endpoint:** Local: add `fetchRobotX(ip)` GETing `/api/robots/${encodeURIComponent(ip)}/x`, use `getErrorFromResponse` on failure. Cloud: add a fetcher that passes `authHeaders(token)`.
