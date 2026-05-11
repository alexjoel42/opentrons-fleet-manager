# Backend — FastAPI + BaseRobot proxy

**Purpose:** Expose Opentrons robot data to the frontend without CORS. Routes under **`/api/robots`** and **`/api/robots/{ip}/...`** forward to each robot’s HTTP API (default port **31950**) via **`BaseRobot`**. Robot list and local notes live in **`robot_ips.json`** / **`robot_notes.json`**.

**Files**

- **demo_api.py:** **`BaseRobot`**, **`/health`**, **`/api/robots`**, **`/api/fleet/snapshot`**, proxy routes for health, modules, pipettes, logs, serial, runs, protocol, troubleshooting zip.

**Helpers:** **`_is_valid_robot_address`**, **`validate_ip`**, **`robot_http_error`**.

**BaseRobot:** Get methods accept optional **`scheme`** and **`port`**.

**Adding a robot endpoint:** Add a method on **`BaseRobot`**, then add a FastAPI route with the same try/except + **`robot_http_error`** pattern as existing proxies.

**Run:** From **`backend/`**: **`uvicorn demo_api:app --reload`** (or **`make run-backend`** from repo root).
