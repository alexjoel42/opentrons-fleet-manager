"""
Fetch protocol metadata and protocol file for a run ID.

Run from backend dir:  cd backend && python -m scripts.fetch_protocol_for_run ROBOT_IP [RUN_ID]
Or from repo root:     make fetch-protocol ROBOT_IP=198.51.100.73 RUN_ID=0a6af184-...

If the observability backend is not running, the script talks to the robot directly (no backend needed).

Optional env:
  BASE_URL  Backend URL (default http://localhost:8000). If unreachable, robot is used directly.
  OUT_DIR  Directory to write files (default: current directory).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_RUN_ID = "abe52b38-a77f-4962-9766-c57d21c3931b"
DEFAULT_BASE_URL = "http://localhost:8000"
ROBOT_PORT = 31950
HEADERS = ("Content-Type", "application/json"), ("Opentrons-Version", "*")


def _robot_url(ip: str, path: str) -> str:
    path = path.strip("/")
    return f"http://{ip}:{ROBOT_PORT}/{path}"


def _get(ip: str, path: str, timeout: float = 15.0) -> tuple[int, str]:
    req = urllib.request.Request(
        _robot_url(ip, path),
        headers=dict(HEADERS),
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace") if e.fp else ""
    except urllib.error.URLError:
        return -1, ""


def fetch_from_robot_direct(ip: str, run_id: str) -> dict | None:
    """Talk to robot at ip:31950; return same shape as backend /api/robots/{ip}/runs/{run_id}/protocol."""
    status, body = _get(ip, f"runs/{run_id}")
    if status != 200:
        return None
    try:
        run_response = json.loads(body)
    except json.JSONDecodeError:
        return None
    run = run_response.get("data") if isinstance(run_response, dict) else run_response
    if not isinstance(run, dict):
        return None
    protocol_id = run.get("protocolId")
    if not protocol_id or not isinstance(protocol_id, str):
        return {
            "runId": run_id,
            "run": run,
            "protocolId": None,
            "protocol": None,
            "protocolFileName": None,
            "protocolFileContent": None,
            "message": "Run has no protocolId.",
        }

    status, body = _get(ip, f"protocols/{protocol_id}")
    protocol_meta = None
    main_file_name = None
    if status == 200:
        try:
            protocol_response = json.loads(body)
            protocol_meta = protocol_response.get("data") if isinstance(protocol_response, dict) else protocol_response
            if isinstance(protocol_meta, dict):
                files = protocol_meta.get("files") or []
                for f in files:
                    if isinstance(f, dict) and f.get("role") == "main":
                        main_file_name = f.get("name") if isinstance(f.get("name"), str) else None
                        break
                if not main_file_name and files and isinstance(files[0], dict):
                    main_file_name = files[0].get("name")
        except json.JSONDecodeError:
            pass

    protocol_file_content = None
    if main_file_name:
        for path in (
            f"protocols/{protocol_id}/files/{main_file_name}",
            f"protocols/{protocol_id}/src/{main_file_name}",
            f"protocols/{protocol_id}/files/main",
            f"protocols/{protocol_id}/content",
            f"protocols/{protocol_id}/file",
            f"protocols/{protocol_id}/",
        ):
            status, body = _get(ip, path)
            if status != 200 or not body:
                continue
            if "protocolType" in body and "files" in body:
                continue
            protocol_file_content = body
            break

    return {
        "runId": run_id,
        "run": run,
        "protocolId": protocol_id,
        "protocol": protocol_meta,
        "protocolFileName": main_file_name,
        "protocolFileContent": protocol_file_content,
    }


def main() -> int:
    out_dir = os.environ.get("OUT_DIR", os.getcwd())

    if len(sys.argv) < 2:
        print("Usage: python -m scripts.fetch_protocol_for_run ROBOT_IP [RUN_ID]", file=sys.stderr)
        print("  Run from backend: cd backend && python -m scripts.fetch_protocol_for_run ...", file=sys.stderr)
        print("  Or: make fetch-protocol ROBOT_IP=198.51.100.73 RUN_ID=0a6af184-...", file=sys.stderr)
        return 1

    ip = sys.argv[1].strip()
    run_id = sys.argv[2].strip() if len(sys.argv) > 2 else DEFAULT_RUN_ID
    base_url = os.environ.get("BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    api_url = f"{base_url}/api/robots/{urllib.parse.quote(ip)}/runs/{urllib.parse.quote(run_id)}/protocol"

    data = None
    try:
        req = urllib.request.Request(api_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        if "Connection refused" in str(e.reason) or "refused" in str(e.reason).lower():
            print("Backend not running; fetching from robot directly.", file=sys.stderr)
            data = fetch_from_robot_direct(ip, run_id)
        else:
            print(f"Request failed: {e.reason}", file=sys.stderr)
            return 1
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        try:
            err = json.loads(body)
            msg = err.get("message") or err.get("detail") or body or str(e)
        except Exception:
            msg = body or str(e)
        print(f"HTTP {e.code}: {msg}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if not data:
        if data is None:
            print("Request failed.", file=sys.stderr)
        return 1

    json_path = os.path.join(out_dir, f"run_{run_id}_protocol.json")
    with open(json_path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved response to {json_path}")

    content = data.get("protocolFileContent")
    if content:
        name = data.get("protocolFileName") or f"protocol_{run_id}.py"
        if not name.endswith(".py") and not name.endswith(".json"):
            name = name + ".py"
        protocol_path = os.path.join(out_dir, name)
        with open(protocol_path, "w") as f:
            f.write(content)
        print(f"Saved protocol file to {protocol_path}")
    else:
        print("No protocol file content in response.")
        if data.get("protocol"):
            print("Protocol metadata is in the JSON file.")
        if data.get("message"):
            print(data["message"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
