"""
List protocols from robot API, find protocol dir by ID under opentrons_robot_server
versioned paths, pick the highest migration version, and copy the protocol .py to Jupyter.

Intended to run on the robot (or a host that has the robot's data mounted) so that
/var/data/opentrons_robot_server and /data/opentrons_robot_server exist.

Usage:
  # List protocols (from any machine with HTTP access to robot)
  python -m scripts.copy_protocol_to_jupyter ROBOT_IP --list

  # Copy protocol by run ID (resolves protocol from GET /runs/{run_id}, then find & copy)
  python -m scripts.copy_protocol_to_jupyter ROBOT_IP --run-id RUN_ID

  # Copy protocol by protocol ID (run on robot or where protocol dirs exist)
  python -m scripts.copy_protocol_to_jupyter ROBOT_IP PROTOCOL_ID

  # Copy first protocol from list
  python -m scripts.copy_protocol_to_jupyter ROBOT_IP

  # Custom search roots and destination
  SEARCH_ROOTS="..." JUPYTER_DIR=/path python -m scripts.copy_protocol_to_jupyter ROBOT_IP --run-id RUN_ID

Env:
  ROBOT_PORT       Robot HTTP port (default 31950).
  SEARCH_ROOTS     Space-separated list of roots to search for .../VERSION/protocols/PROTOCOL_ID (default below).
  JUPYTER_DIR      Copy destination (default /var/lib/jupyter/notebooks).
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.error
import urllib.request

ROBOT_PORT = int(os.environ.get("ROBOT_PORT", "31950"))
DEFAULT_SEARCH_ROOTS = [
    "/var/data/opentrons_robot_server",
    "/data/opentrons_robot_server",
]
DEFAULT_JUPYTER_DIR = "/var/lib/jupyter/notebooks"

def _robot_url(ip: str, path: str, port: int = ROBOT_PORT) -> str:
    path = path.strip("/")
    return f"http://{ip}:{port}/{path}"


def get_protocol_id_from_run(ip: str, run_id: str, port: int = ROBOT_PORT) -> str | None:
    """GET /runs/{run_id}, return protocolId from the run data."""
    url = _robot_url(ip, f"runs/{run_id}", port=port)
    req = urllib.request.Request(
        url,
        headers={"Opentrons-Version": "*", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"Failed to GET run: {e}", file=sys.stderr)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON from /runs/{{run_id}}: {e}", file=sys.stderr)
        return None
    run = data.get("data") if isinstance(data, dict) else data
    if not isinstance(run, dict):
        print("Unexpected /runs response shape.", file=sys.stderr)
        return None
    pid = run.get("protocolId") or run.get("protocol_id")
    return pid if isinstance(pid, str) else None


def get_protocols(ip: str, port: int = ROBOT_PORT) -> list[dict] | None:
    """GET /protocols and return list of protocol objects (data or data.data)."""
    url = _robot_url(ip, "protocols", port=port)
    req = urllib.request.Request(
        url,
        headers={"Opentrons-Version": "*", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"Failed to GET protocols: {e}", file=sys.stderr)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON from /protocols: {e}", file=sys.stderr)
        return None
    # Response may be { "data": [ ... ] } or direct list
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if not isinstance(data, list):
        print("Unexpected /protocols response shape.", file=sys.stderr)
        return None
    return data


def protocol_id_from_entry(entry: dict) -> str | None:
    """Extract protocol id from a protocol list entry."""
    if isinstance(entry, dict):
        return entry.get("id") or entry.get("protocolId")
    return None


def find_protocol_dirs(protocol_id: str, search_roots: list[str]) -> list[tuple[float, str]]:
    """
    Find all directories named protocol_id under .../VERSION/protocols/ in search_roots.
    Returns list of (version_number, dir_path) sorted by version ascending.
    Version is parsed as float (e.g. 7.1, 11).
    """
    results: list[tuple[float, str]] = []
    for root in search_roots:
        if not os.path.isdir(root):
            continue
        try:
            for base, dirs, _ in os.walk(root, topdown=True):
                # Look for .../VERSION/protocols in path, then protocol_id as child
                for d in dirs:
                    if d != protocol_id:
                        continue
                    full = os.path.join(base, d)
                    # base should be .../VERSION/protocols
                    parent = os.path.dirname(base)
                    protocols_dir = os.path.basename(base)
                    version_dir = os.path.basename(parent)
                    if protocols_dir == "protocols" and version_dir:
                        try:
                            ver = float(version_dir)
                        except ValueError:
                            ver = 0.0
                        results.append((ver, full))
                # Don't recurse into non-version-looking dirs if we're already under protocols
                if "protocols" in base:
                    dirs.clear()
        except OSError as e:
            print(f"Warning: skipping {root}: {e}", file=sys.stderr)
    results.sort(key=lambda x: x[0])
    return results


def copy_py_to_jupyter(protocol_dir: str, dest_dir: str) -> list[str]:
    """Copy all .py files from protocol_dir to dest_dir. Returns list of destination paths."""
    os.makedirs(dest_dir, exist_ok=True)
    copied: list[str] = []
    try:
        names = os.listdir(protocol_dir)
    except OSError as e:
        print(f"Cannot list {protocol_dir}: {e}", file=sys.stderr)
        return copied
    for name in names:
        if not name.endswith(".py"):
            continue
        src = os.path.join(protocol_dir, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(dest_dir, name)
        try:
            shutil.copy2(src, dst)
            copied.append(dst)
        except OSError as e:
            print(f"Copy failed {src} -> {dst}: {e}", file=sys.stderr)
    return copied


def main() -> int:
    search_roots = os.environ.get("SEARCH_ROOTS", "").strip().split()
    if not search_roots:
        search_roots = DEFAULT_SEARCH_ROOTS
    jupyter_dir = os.environ.get("JUPYTER_DIR", DEFAULT_JUPYTER_DIR)

    argv = [a for a in sys.argv[1:] if a not in ("--list", "--run-id")]
    list_only = "--list" in sys.argv[1:]
    run_id = None
    if "--run-id" in sys.argv[1:]:
        idx = sys.argv[1:].index("--run-id")
        if idx + 2 <= len(sys.argv[1:]):
            run_id = sys.argv[1:][idx + 1]
    if run_id:
        argv = [a for a in argv if a != run_id]

    if len(argv) < 1:
        print("Usage: python -m scripts.copy_protocol_to_jupyter ROBOT_IP [PROTOCOL_ID | --run-id RUN_ID] [--list]", file=sys.stderr)
        print("  --list      Only list protocol IDs from GET /protocols", file=sys.stderr)
        print("  --run-id ID Resolve protocol from GET /runs/{id}, then find and copy to Jupyter", file=sys.stderr)
        return 1

    robot_ip = argv[0].strip()
    protocol_id = argv[1].strip() if len(argv) > 1 else None

    if run_id:
        protocol_id = get_protocol_id_from_run(robot_ip, run_id.strip())
        if not protocol_id:
            print(f"Run {run_id} has no protocolId (or run not found).", file=sys.stderr)
            return 1
        print(f"Run {run_id} -> protocol id {protocol_id}", file=sys.stderr)

    if list_only:
        protocols = get_protocols(robot_ip)
        if protocols is None:
            return 1
        if not protocols:
            print("No protocols returned.")
            return 0
        for p in protocols:
            pid = protocol_id_from_entry(p)
            name = (p if isinstance(p, dict) else {}).get("name", "")
            print(pid or "(no id)", name and f"  # {name}" or "")
        return 0

    if not protocol_id:
        protocols = get_protocols(robot_ip)
        if protocols is None:
            return 1
        if protocols:
            protocol_id = protocol_id_from_entry(protocols[0])
            if protocol_id:
                print(f"Using first protocol id: {protocol_id}", file=sys.stderr)

    if not protocol_id:
        print("No protocol ID (and no --run-id). Give PROTOCOL_ID or --run-id RUN_ID.", file=sys.stderr)
        return 1

    found = find_protocol_dirs(protocol_id, search_roots)
    if not found:
        print(f"No directories found for protocol id: {protocol_id}", file=sys.stderr)
        print("Search roots:", search_roots, file=sys.stderr)
        print("Tip: run on the robot (or where those paths exist).", file=sys.stderr)
        return 1

    # Highest version last after sort
    _ver, best_dir = found[-1]
    print(f"Using highest migration version: {best_dir}")

    copied = copy_py_to_jupyter(best_dir, jupyter_dir)
    if not copied:
        print("No .py files found in that directory.", file=sys.stderr)
        return 1
    for path in copied:
        print(f"Copied to {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
