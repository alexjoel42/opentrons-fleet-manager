# Hooks — React Query per resource

**Purpose:** Fetch and cache robot data by IP. Keys like **`['robot', ip, resource]`** or **`['robots', 'list']`**. Retries and **`refetchInterval`** handle flaky robots; back off when in error.

**Per-IP hooks** (enabled when **`ip`** is set): **`useRobotHealth`**, **`useRobotModules`**, **`useRobotPipettes`**, **`useRobotLogs`**, etc.

**List / snapshot:** **`useRobotList()`**, **`useFleetSnapshot`**.

**Composed:** **`useRobot(ip)`** bundles health/modules/pipettes for the detail page.

**Adding a resource:** Add a fetcher in **`api/robotApi.ts`**, then a hook with **`queryKey: ['robot', ip, 'resource']`** and the same retry/refetch pattern.
