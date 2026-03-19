# Local relay agent setup

The relay agent runs in your lab, polls Opentrons robot(s) on the local network, and POSTs telemetry to the cloud backend. No inbound firewall rules are required; the agent only makes outbound HTTPS requests.

## Prerequisites

- Python 3.9+
- Network access to the robot(s) on port 31950 (HTTP or HTTPS, depending on your setup)
- A lab and agent token from the cloud app (sign up, create a lab, generate a token via the API or UI)

## Install

From the repo root (Observability_V0):

```bash
pip install -r agent/requirements.txt
```

Or with the project venv:

```bash
source .venv/bin/activate
pip install -r agent/requirements.txt
```

## Configure robots (including HTTPS)

You can use **periodic check-ins** with specific IPs and choose HTTP vs HTTPS per robot:

- **198.51.100.73** and **203.0.113.198** (documentation-range examples): often require **HTTPS** (set `scheme: "https"`); use your lab’s real IPs in production.
- **localhost**: typically **HTTP** (set `scheme: "http"`).

### Option 1: Config file (recommended)

Copy the example and edit:

```bash
cp agent/agent_config.example.json agent/agent_config.json
```

Edit `agent_config.json`:

```json
{
  "lab_id": "YOUR_LAB_ID",
  "agent_token": "YOUR_AGENT_TOKEN",
  "backend_url": "https://your-observability-api.com",
  "robot_poll_interval_seconds": 5,
  "robots": [
    { "ip": "198.51.100.73", "scheme": "https", "port": 31950 },
    { "ip": "203.0.113.198", "scheme": "https", "port": 31950 },
    { "ip": "localhost", "scheme": "http", "port": 31950 }
  ]
}
```

Run with config:

```bash
python agent/run_agent.py --config=agent/agent_config.json
```

### Option 2: Command-line and env

```bash
export LAB_ID=your-lab-id
export AGENT_TOKEN=your-agent-token
export BACKEND_URL=https://your-api.com

# Default robots: 198.51.100.73, 203.0.113.198 (HTTPS), localhost (HTTP)
python agent/run_agent.py

# Or specify IPs (HTTPS for IPs listed in --https-ips)
python agent/run_agent.py --robot-ips=198.51.100.73,203.0.113.198,localhost --https-ips=198.51.100.73,203.0.113.198
```

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
| `--robot-ips`    | Comma-separated IPs (default: 198.51.100.73, 203.0.113.198, localhost) |
| `--https-ips`    | Comma-separated IPs to use HTTPS (default: 198.51.100.73, 203.0.113.198) |
| `--interval`     | Poll interval in seconds (default 5)        |
| `LAB_ID`         | Same as `--lab-id`                           |
| `AGENT_TOKEN`    | Same as `--agent-token`                      |
| `BACKEND_URL`    | Same as `--backend-url`                      |
