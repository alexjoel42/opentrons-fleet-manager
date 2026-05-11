# API layer — Backend client

**Purpose:** Call the FastAPI backend only; the browser never hits robot IPs.

**robotApi.ts**

- **BASE:** In dev, **`''`** (same origin via Vite proxy). In production, **`VITE_API_URL`** or **`''`** for same-origin **`/api`**.
- **Robot list / proxy:** **`fetchRobotList`**, **`addRobotIp`**, **`removeRobotIp`**, health/modules/pipettes/logs/runs/protocol helpers, **`fetchFleetSnapshot`**, troubleshooting zip.
- **Errors:** Non-OK responses → parse **`detail`** / **`error`** and throw **`Error`** for React Query.

**Adding an endpoint:** Add **`fetchRobot…(ip)`** targeting **`/api/robots/${encodeURIComponent(ip)}/…`** and reuse **`getErrorFromResponse`**.
