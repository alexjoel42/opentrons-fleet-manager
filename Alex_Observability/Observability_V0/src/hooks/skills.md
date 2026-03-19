# Hooks — React Query per resource

**Purpose:** Fetch and cache robot data by IP and resource. Query keys `['robot', ip, resource]` (or `['robots', 'list']` for the list). Retries and refetchInterval handle restarts; refetch off when in error to avoid hammering.

**Per-resource hooks (all take `ip: string | null`; enabled only when `ip` is truthy):**
- `useRobotHealth(ip)` — health; refetch every 30s unless error.
- `useRobotModules(ip)` — modules; refetch every 60s unless error.
- `useRobotPipettes(ip)` — pipettes; same.
- `useRobotLogs(ip)` — logs; fewer retries, no refetchInterval.
- `useRobotList()` — list of IPs from backend (no ip arg).

**Composed:** `useRobot(ip)` returns `{ health, modules, pipettes, isLoading, isError, error, refetch }` for the detail page.

**Cloud mode:** Cloud dashboard uses `useQuery` with **`cloudApi`** (`fetchLabs`, `fetchCloudRobots`, …) and keys **`['cloud', 'labs', token]`**, **`['cloud', 'robots', token]`**. **`CloudRobotPollTargets`** uses **`['cloud', 'robot-poll-targets', token, labId]`** for **`fetchRobotPollTargets`**; **`saveRobotPollTargets`** invalidates **`['cloud', 'robot-poll-targets', …]`** and **`['cloud', 'robots', token]`**. Token from **`useAuth().token`**.

**Cloud robot detail:** `useQuery` with `fetchCloudRobot`, key **`['cloud', 'robot', id, token]`** (pattern as implemented).

**Options (shared):** `retry: 3`, `retryDelay` exponential backoff. `refetchInterval` returns `false` when query is in error.

**Adding a new resource:** Add a fetcher in `api/robotApi.ts`, then a hook here with `queryKey: ['robot', ip, 'resourceName']` and the same retry/refetch pattern.
