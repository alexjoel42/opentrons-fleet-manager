# Local relay agent setup

The relay agent runs in your lab, polls Opentrons robot(s) on the local network, and POSTs telemetry to the cloud backend. No inbound firewall rules are required; the agent only makes outbound HTTPS requests.

## Prerequisites

- Python 3.9+
- Network access to the robot(s) on port 31950 (HTTP or HTTPS, depending on your setup)
- A lab and agent token from the cloud app: sign up, open the cloud dashboard, use **Relay agent credentials** (create a lab if needed, then **Generate new agent token**), or call `POST /api/labs/{lab_id}/tokens` with your user JWT. Token generation is limited to **4 per lab per UTC day**; older tokens you already created still work until you rotate them.

### Login response vs what the relay agent needs

`POST /api/auth/login` (and signup) returns only **`access_token`**. That value is your **user** JWT (it identifies you, not a lab). It is **not** the same as `LAB_ID` or `AGENT_TOKEN`.

| What | What it is |
|------|------------|
| **`access_token`** | User session. Use `Authorization: Bearer <access_token>` for `/api/labs`, creating labs, generating agent tokens, etc. |
| **`lab_id`** | ID of a **lab** resource. You get it from **`GET /api/labs`** after sign-in, or from **`POST /api/labs`** when you create one. It is never returned by the login endpoint. |
| **`AGENT_TOKEN`** | Long-lived **relay** token for the agent only. Create it with **`POST /api/labs/{lab_id}/tokens`** while authenticated with your user JWT (or use **Generate new agent token** in the dashboard). The relay agent must **not** use `access_token` as `AGENT_TOKEN`. |

**API-only flow (after you have `access_token`):**

```bash
# List labs (copy an "id" — that is LAB_ID)
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" "$BACKEND_URL/api/labs"

# Or create a lab
curl -sS -X POST -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"My lab"}' "$BACKEND_URL/api/labs"

# Create a relay agent token (use the lab id from above)
curl -sS -X POST -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{}' "$BACKEND_URL/api/labs/$LAB_ID/tokens"
```

In the web app, open the cloud dashboard → **Relay agent credentials**: it shows **Lab ID**, **Backend URL**, and lets you **Generate new agent token** — those three match `LAB_ID`, `BACKEND_URL`, and `AGENT_TOKEN` for the agent.

## Install

### From PyPI (after release)

Install the published package and use the `observability-agent` command (same behavior as `python agent/run_agent.py` from a git checkout). The PyPI package declares **Python 3.10+** (`requires-python` in `agent/pyproject.toml`).

```bash
pip install observability-agent
export LAB_ID="..." AGENT_TOKEN="..." BACKEND_URL="https://your-api.com"
observability-agent
```

No config file is required. Optionally use `--config=/path/to/agent_config.json` if you prefer JSON; copy `agent/agent_config.example.json` from this repo as a starting point.

### From this repository

From the repo root (Observability_V0):

```bash
pip install -r agent/requirements.txt
```

Or with the project venv:

```bash
source .venv/bin/activate
pip install -r agent/requirements.txt
```

## Where robot IPs are configured (production)

**Robot addresses are managed in the Fleet Manager web app** (e.g. [opentrons-fleet-manager.vercel.app](https://opentrons-fleet-manager.vercel.app/)), not on the agent machine. After you sign in, open the cloud dashboard and use **Robot addresses (relay agent)** for your lab: set each robot’s IP or hostname, **http** vs **https**, and port (usually `31950`).

The agent calls `GET /api/agent/robot-poll-targets` on your backend (using the lab agent token) and polls only that list. You do **not** put production IPs in config on disk unless you choose to.

### Environment variables (recommended for production)

No JSON file is required. Set three variables (same backend URL as `VITE_API_URL` / your deployed API), then run the agent:

```bash
export LAB_ID="YOUR_LAB_ID"
export AGENT_TOKEN="YOUR_AGENT_TOKEN"
export BACKEND_URL="https://your-observability-api.com"

# optional: seconds between poll cycles (default 5)
# export ROBOT_POLL_INTERVAL_SECONDS=5

python agent/run_agent.py
```

If you installed from PyPI: `observability-agent` with the same environment (no extra flags).

You can pass the same values as flags instead of env: `--lab-id`, `--agent-token`, `--backend-url`.

### Optional JSON config

If you prefer a file, copy the example and run with `--config`:

```bash
cp agent/agent_config.example.json agent/agent_config.json
# edit lab_id, agent_token; backend_url optional if BACKEND_URL is set
export BACKEND_URL=https://your-observability-api.com
python agent/run_agent.py --config=agent/agent_config.json
```

Minimal `agent_config.json` (no `robots` key):

```json
{
  "lab_id": "YOUR_LAB_ID",
  "agent_token": "YOUR_AGENT_TOKEN",
  "backend_url": "https://your-observability-api.com",
  "robot_poll_interval_seconds": 5
}
```

**Note:** The Fleet Manager frontend uses `VITE_API_URL` at **build time**; the agent uses **`BACKEND_URL`** (or `backend_url` in JSON). They should be the same API base URL.

### Local / dev without the cloud UI (`--local-robots`)

For development, you can keep the robot list on the agent by setting **`use_local_robots": true`** in JSON and a **`robots`** array, or use **`--local-robots`** with **`--robot-ips`** / **`--https-ips`**. Non-localhost lab machines often use **https** on port 31950; **localhost** is usually **http**.

```bash
python agent/run_agent.py --local-robots --robot-ips=198.51.100.73,localhost --https-ips=198.51.100.73
```

Or in `agent_config.json`:

```json
{
  "lab_id": "YOUR_LAB_ID",
  "agent_token": "YOUR_AGENT_TOKEN",
  "backend_url": "https://your-observability-api.com",
  "use_local_robots": true,
  "robots": [
    { "ip": "10.0.0.5", "scheme": "https", "port": 31950 }
  ]
}
```

Environment: `AGENT_USE_LOCAL_ROBOTS=true` is equivalent to enabling local robot config.

## Run as a service (optional)

To keep the agent running across reboots:

- **Linux (systemd)**: Create a unit file that runs `python agent/run_agent.py --config=/path/to/agent_config.json`.
- **macOS (launchd)**: Create a plist that runs the same command.

Ensure the config path and working directory are correct so the script can find the config and any credentials.

## Quick reference

| Flag / env       | Description                                  |
|------------------|----------------------------------------------|
| `--lab-id`       | Lab ID from the cloud app                    |
| `--agent-token`  | Token from "Create token" for that lab       |
| `--backend-url`  | Cloud backend base URL (HTTPS)               |
| `--config`       | Path to `agent_config.json`                  |
| `--local-robots` | Use `robots` from config / `--robot-ips` instead of the cloud list (dev) |
| `--robot-ips`    | With `--local-robots`: comma-separated IPs |
| `--https-ips`    | With `--local-robots`: IPs that use HTTPS   |
| `--interval`     | Poll interval in seconds (default 5)        |
| `LAB_ID`         | Same as `--lab-id`                           |
| `AGENT_TOKEN`    | Same as `--agent-token`                      |
| `BACKEND_URL`    | Same as `--backend-url`                      |
| `AGENT_USE_LOCAL_ROBOTS` | Set `true` to force local robot list (dev) |

## Publishing to PyPI (maintainers)

The installable package lives under `agent/` ([`agent/pyproject.toml`](../agent/pyproject.toml)): project name **`observability-agent`**, console script **`observability-agent`**.

1. **PyPI account and token** — Create an account on [pypi.org](https://pypi.org), then [Account settings → API tokens](https://pypi.org/manage/account/token/) and create a token (project-scoped to `observability-agent` once the project exists, or a whole-account token for the first upload).

2. **Set version** — In `agent/pyproject.toml`, set `[project] version` to a new [PEP 440](https://peps.python.org/pep-0440/) release (for example `0.1.0`). PyPI does not allow re-uploading the same version twice.

3. **Build and check** (from `agent/`):

   ```bash
   cd agent
   pip install build twine
   rm -rf dist/ build/ *.egg-info
   python -m build
   twine check dist/*
   ```

4. **Upload** — Prefer environment variables so the token is not saved in a file:

   ```bash
   TWINE_USERNAME=__token__ TWINE_PASSWORD=pypi-your-token-here twine upload dist/*
   ```

   Optional: [TestPyPI](https://test.pypi.org/) dry run:

   ```bash
   TWINE_USERNAME=__token__ TWINE_PASSWORD=pypi-your-test-token-here \
     twine upload --repository testpypi dist/*
   pip install -i https://test.pypi.org/simple/ observability-agent
   ```

After a successful upload, users can `pip install observability-agent` as in [From PyPI (after release)](#from-pypi-after-release).

### GitHub Actions (trusted publisher, no API token)

The repo workflow [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) runs on tags `v*` and includes a **`publish-pypi`** job that uploads the built agent to PyPI using [OIDC trusted publishing](https://docs.pypi.org/trusted-publishers/). In PyPI’s trusted-publisher form, the values must match the **distribution name** and this repo:

| PyPI field | Use |
|------------|-----|
| **PyPI project name** | `observability-agent` (must match `[project].name` in `agent/pyproject.toml`, not a display name like `ObservingRobots`) |
| **Owner** | Your GitHub user or org (e.g. `alexjoel42`) |
| **Repository name** | Repo name only — e.g. `opentrons-fleet-manager` — not a full `https://github.com/...` URL |
| **Workflow name** | `release.yml` (the file under `.github/workflows/`) |
| **Environment name** (optional) | `pypi` — create a GitHub Actions [environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment) with this name on the repo so the job can run |

Pushing a tag such as `v0.1.0` runs the release and then publishes that version to PyPI.
