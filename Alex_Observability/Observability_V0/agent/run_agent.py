#!/usr/bin/env python3
"""
Local relay agent: polls Opentrons robot(s) on the lab network and POSTs telemetry to the cloud.
Supports HTTP and HTTPS per robot (e.g. 198.51.100.73 and 203.0.113.198 over HTTPS, localhost over HTTP).

Usage (recommended — no JSON file):
  export LAB_ID=... AGENT_TOKEN=... BACKEND_URL=https://your-api.com
  python run_agent.py

  # Optional: poll interval (seconds), default 5
  export ROBOT_POLL_INTERVAL_SECONDS=10

CLI flags override env when set:
  python run_agent.py --lab-id=... --agent-token=... --backend-url=...

Optional JSON (advanced):
  python run_agent.py --config=agent_config.json

Robot addresses for production come from the cloud app (Fleet Manager): the agent calls
GET /api/agent/robot-poll-targets. Use --local-robots (or use_local_robots in JSON) only
for development without the cloud UI.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import httpx

# Default robots for periodic check-ins: two over HTTPS, localhost over HTTP
DEFAULT_ROBOTS = [
    {"ip": "198.51.100.73", "scheme": "https", "port": 31950},
    {"ip": "203.0.113.198", "scheme": "https", "port": 31950},
    {"ip": "localhost", "scheme": "http", "port": 31950},
]

ROBOT_TIMEOUT = 10.0
BACKEND_TIMEOUT = 30.0
MIN_BACKOFF = 5.0
MAX_BACKOFF = 60.0
# How often to refresh robot list from the cloud (when not using --local-robots).
TARGETS_REFRESH_SECONDS = 30.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("agent")


def _url(ip: str, path: str, scheme: str = "http", port: int = 31950) -> str:
    path = path.strip("/")
    return f"{scheme}://{ip}:{port}/{path}"


def fetch_robot_telemetry(
    ip: str,
    scheme: str = "http",
    port: int = 31950,
    timeout: float = ROBOT_TIMEOUT,
) -> dict | None:
    """Fetch health, runs, and logs from one robot. Returns dict for payload or None on failure."""
    headers = {"Content-Type": "application/json", "Opentrons-Version": "*"}
    out = {"ip": ip, "health": None, "runs": None, "logs": None, "serial": None}
    try:
        with httpx.Client(timeout=timeout) as client:
            # Health
            r = client.get(_url(ip, "health", scheme, port), headers=headers)
            if r.status_code == 200:
                out["health"] = {
                    "name": r.headers.get("name"),
                    "date": r.headers.get("date"),
                    "logs": r.headers.get("logs"),
                    "serial_number": r.headers.get("serial_number"),
                    "status": r.headers.get("status"),
                    "health_data": r.headers.get("health_data"),
                }
                out["serial"] = r.headers.get("serial_number")
            # Runs
            r = client.get(_url(ip, "runs", scheme, port), headers=headers)
            if r.status_code == 200:
                try:
                    out["runs"] = r.json()
                except Exception:
                    out["runs"] = {}
            # Logs
            r = client.get(_url(ip, "logs", scheme, port), headers=headers)
            if r.status_code == 200:
                out["logs"] = r.headers.get("logs") or ""
    except Exception as e:
        log.warning("Robot %s (%s): %s", ip, scheme, e)
        return None
    return out


def build_telemetry_payload(robots_config: list, timeout: float = ROBOT_TIMEOUT) -> list:
    """Build list of robot telemetry dicts for POST body."""
    payload_robots = []
    for r in robots_config:
        if isinstance(r, str):
            ip, scheme, port = r.strip(), "http", 31950
        else:
            ip = (r.get("ip") or "").strip()
            scheme = (r.get("scheme") or "http").lower()
            port = int(r.get("port") or 31950)
        if not ip:
            continue
        data = fetch_robot_telemetry(ip, scheme=scheme, port=port, timeout=timeout)
        if data is None:
            continue
        payload_robots.append({
            "ip": ip,
            "robot_id": data.get("serial"),
            "serial": data.get("serial"),
            "health": data.get("health"),
            "runs": data.get("runs"),
            "logs": data.get("logs"),
        })
    return payload_robots


def fetch_robot_poll_targets(
    backend_url: str,
    agent_token: str,
    timeout: float = BACKEND_TIMEOUT,
) -> list[dict] | None:
    """GET poll targets from cloud. Returns None on HTTP/network failure."""
    url = f"{backend_url.rstrip('/')}/api/agent/robot-poll-targets"
    headers = {
        "Authorization": f"Bearer {agent_token}",
        "Accept": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.get(url, headers=headers)
            if r.status_code != 200:
                log.error("GET robot-poll-targets %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()
            robots = data.get("robots")
            if not isinstance(robots, list):
                return None
            out: list[dict] = []
            for item in robots:
                if not isinstance(item, dict):
                    continue
                ip = (item.get("ip") or "").strip()
                if not ip:
                    continue
                scheme = (item.get("scheme") or "http").lower()
                if scheme not in ("http", "https"):
                    scheme = "http"
                try:
                    port = int(item.get("port") or 31950)
                except (TypeError, ValueError):
                    port = 31950
                out.append({"ip": ip, "scheme": scheme, "port": port})
            return out
    except Exception as e:
        log.error("GET robot-poll-targets failed: %s", e)
        return None


def post_telemetry(
    backend_url: str,
    agent_token: str,
    lab_id: str,
    robots: list,
    timeout: float = BACKEND_TIMEOUT,
) -> bool:
    """POST telemetry to cloud. Returns True on success."""
    url = f"{backend_url.rstrip('/')}/api/agent/telemetry"
    headers = {
        "Authorization": f"Bearer {agent_token}",
        "Content-Type": "application/json",
    }
    body = {"lab_id": lab_id, "robots": robots}
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(url, json=body, headers=headers)
            if r.status_code in (200, 201):
                return True
            log.error("Backend %s: %s %s", r.status_code, r.text[:200])
            return False
    except Exception as e:
        log.error("Backend POST failed: %s", e)
        return False


def _env_poll_interval_seconds(default: float = 5.0) -> float:
    for key in ("ROBOT_POLL_INTERVAL_SECONDS", "AGENT_POLL_INTERVAL_SECONDS"):
        raw = os.environ.get(key, "").strip()
        if not raw:
            continue
        try:
            return float(raw)
        except ValueError:
            log.warning("Ignoring invalid %s=%r", key, raw)
    return default


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Config must be a JSON object")
    robots = data.get("robots")
    if robots is None:
        robots = []
    if not isinstance(robots, list):
        robots = []
    data["robots"] = robots
    data.setdefault("robot_poll_interval_seconds", _env_poll_interval_seconds(5.0))
    data.setdefault("backend_url", os.environ.get("BACKEND_URL", ""))
    data.setdefault("lab_id", os.environ.get("LAB_ID", ""))
    data.setdefault("agent_token", os.environ.get("AGENT_TOKEN", ""))
    data.setdefault("use_local_robots", False)
    return data


def _env_use_local_robots() -> bool:
    v = os.environ.get("AGENT_USE_LOCAL_ROBOTS", "").strip().lower()
    return v in ("1", "true", "yes")


def _config_use_local_robots(cfg: dict) -> bool:
    v = cfg.get("use_local_robots")
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Opentrons observability relay agent",
        epilog=(
            "Typical production: set LAB_ID, AGENT_TOKEN, BACKEND_URL and run without --config. "
            "See module docstring."
        ),
    )
    ap.add_argument("--lab-id", default=os.environ.get("LAB_ID"), help="Lab ID (or LAB_ID)")
    ap.add_argument("--agent-token", default=os.environ.get("AGENT_TOKEN"), help="Agent token (or AGENT_TOKEN)")
    ap.add_argument(
        "--backend-url",
        default=os.environ.get("BACKEND_URL"),
        help="Cloud backend URL (or BACKEND_URL)",
    )
    ap.add_argument("--robot-ips", help="With --local-robots: comma-separated robot IPs")
    ap.add_argument("--config", help="Optional JSON config (LAB_ID / AGENT_TOKEN / BACKEND_URL env are enough)")
    ap.add_argument(
        "--interval",
        type=float,
        default=_env_poll_interval_seconds(5.0),
        help="Poll interval in seconds (default: env ROBOT_POLL_INTERVAL_SECONDS or 5)",
    )
    ap.add_argument("--https-ips", help="With --local-robots: comma-separated IPs to use HTTPS")
    ap.add_argument(
        "--local-robots",
        action="store_true",
        help="Use robots from config/--robot-ips instead of the cloud (dev only; production uses Fleet Manager)",
    )
    args = ap.parse_args()

    use_local = bool(args.local_robots)
    if not use_local:
        use_local = _env_use_local_robots()

    if args.config:
        config = load_config(args.config)
        lab_id = config.get("lab_id") or args.lab_id
        agent_token = config.get("agent_token") or args.agent_token
        backend_url = config.get("backend_url") or args.backend_url
        interval = float(config.get("robot_poll_interval_seconds", args.interval))
        if not use_local:
            use_local = _config_use_local_robots(config) or bool(args.local_robots)
        if use_local:
            robots_config = list(config.get("robots") or [])
            if not robots_config:
                robots_config = list(DEFAULT_ROBOTS)
        else:
            robots_config = []
    else:
        lab_id = args.lab_id
        agent_token = args.agent_token
        backend_url = args.backend_url
        interval = args.interval
        if use_local:
            if args.robot_ips:
                ips = [s.strip() for s in args.robot_ips.split(",") if s.strip()]
                https_ips = set()
                if args.https_ips:
                    https_ips = {s.strip() for s in args.https_ips.split(",") if s.strip()}
                else:
                    https_ips = {"198.51.100.73", "203.0.113.198"}
                robots_config = [
                    {"ip": ip, "scheme": "https" if ip in https_ips else "http", "port": 31950}
                    for ip in ips
                ]
            else:
                robots_config = list(DEFAULT_ROBOTS)
        else:
            robots_config = []

    if not lab_id or not agent_token or not backend_url:
        log.error(
            "Set LAB_ID, AGENT_TOKEN, and BACKEND_URL in the environment (recommended), "
            "or pass --lab-id, --agent-token, --backend-url, or use --config=..."
        )
        return 1

    if use_local:
        log.info(
            "Lab %s; backend %s; LOCAL robots %s; interval %.1fs",
            lab_id,
            backend_url,
            [r.get("ip") if isinstance(r, dict) else r for r in robots_config],
            interval,
        )
    else:
        log.info(
            "Lab %s; backend %s; robot list from cloud (GET /api/agent/robot-poll-targets); interval %.1fs",
            lab_id,
            backend_url,
            interval,
        )

    backoff = MIN_BACKOFF
    cached_cloud_robots: list = []
    last_targets_fetch = 0.0
    have_cloud_targets_response = False

    while True:
        try:
            if use_local:
                active_robots = robots_config
            else:
                now = time.time()
                if now - last_targets_fetch >= TARGETS_REFRESH_SECONDS:
                    fetched = fetch_robot_poll_targets(backend_url, agent_token)
                    last_targets_fetch = now
                    if fetched is not None:
                        cached_cloud_robots = fetched
                        have_cloud_targets_response = True
                    elif not cached_cloud_robots:
                        log.warning(
                            "Could not load robot list from cloud yet; retry in %.0fs",
                            TARGETS_REFRESH_SECONDS,
                        )
                active_robots = cached_cloud_robots

            if not use_local and not active_robots:
                if have_cloud_targets_response:
                    log.warning(
                        "No robot addresses in the cloud for this lab. Add them in Fleet Manager (web app)."
                    )
                else:
                    log.warning(
                        "Waiting for robot list from the cloud API (GET /api/agent/robot-poll-targets)."
                    )
                time.sleep(interval)
                continue

            robots_payload = build_telemetry_payload(active_robots)
            if not robots_payload:
                log.warning("No robot data collected this cycle")
            else:
                ok = post_telemetry(backend_url, agent_token, lab_id, robots_payload)
                if ok:
                    log.info("POST ok (%d robot(s))", len(robots_payload))
                    backoff = MIN_BACKOFF
                else:
                    log.warning("POST failed; retry in %.0fs", backoff)
                    time.sleep(backoff)
                    backoff = min(backoff * 2, MAX_BACKOFF)
                    continue
        except KeyboardInterrupt:
            log.info("Stopping")
            break
        except Exception as e:
            log.exception("Cycle error: %s", e)
            time.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF)
            continue
        time.sleep(interval)
    return 0


if __name__ == "__main__":
    sys.exit(main())
