"""
Probe the robot HTTP API for where protocol file content lives under /protocols/{protocol_id}/.

Usage:
  python -m scripts.probe_protocol_endpoints ROBOT_IP PROTOCOL_ID [MAIN_FILENAME]
  python -m scripts.probe_protocol_endpoints ROBOT_IP RUN_ID   # use run_id to resolve protocol_id + main file

Example:
  python -m scripts.probe_protocol_endpoints 192.0.2.100 8f9d00bc-9249-4313-84a3-06dbbbfe1039 testing_lids.py

Prints status, content-type, and a short preview for each path tried.
"""
from __future__ import annotations

import json
import sys
from urllib.parse import quote

import httpx

DEFAULT_PORT = 31950
TIMEOUT = 15.0
HEADERS = {"Content-Type": "application/json", "Opentrons-Version": "*"}
DEFAULT_IP = "198.51.100.73"


def url(ip: str, path: str, port: int = DEFAULT_PORT) -> str:
    path = path.strip("/")
    return f"http://{ip}:{port}/{path}"


def probe(ip: str, protocol_id: str, main_filename: str | None) -> None:
    paths = [
        f"protocols/{protocol_id}",
        f"protocols/{protocol_id}/",
        f"protocols/{protocol_id}/files",
        f"protocols/{protocol_id}/file",
        f"protocols/{protocol_id}/content",
        f"protocols/{protocol_id}/download",
        f"protocols/{protocol_id}/src",
    ]
    if main_filename:
        encoded = quote(main_filename, safe="")
        paths.extend([
            f"protocols/{protocol_id}/files/{encoded}",
            f"protocols/{protocol_id}/src/{encoded}",
            f"protocols/{protocol_id}/files/{main_filename}",
            f"protocols/{protocol_id}/files/main",
            f"protocols/{protocol_id}/src/{main_filename}",
        ])

    print(f"Probing robot at {ip} for protocol_id={protocol_id}")
    if main_filename:
        print(f"  main_filename={main_filename}\n")
    else:
        print("  (no main filename; add as 3rd arg to probe file paths)\n")

    with httpx.Client(timeout=TIMEOUT, headers=HEADERS) as client:
        for path in paths:
            u = url(ip, path)
            try:
                r = client.get(u)
                ct = r.headers.get("content-type", "")
                preview = ""
                if r.status_code == 200:
                    if "json" in ct:
                        try:
                            data = r.json()
                            if isinstance(data, dict) and "data" in data:
                                data = data["data"]
                            if isinstance(data, dict) and "files" in data:
                                preview = f"metadata files={[f.get('name') for f in (data.get('files') or [])]}"
                            else:
                                preview = (json.dumps(data)[:120] + "..") if len(json.dumps(data)) > 120 else json.dumps(data)
                        except Exception:
                            preview = r.text[:120] + "..." if len(r.text) > 120 else r.text
                    else:
                        text = r.text
                        preview = (text[:120] + "...") if len(text) > 120 else text
                        if preview and "\n" in preview:
                            preview = preview.split("\n")[0][:80] + "..."

                print(f"  {r.status_code}  {path}")
                print(f"       content-type: {ct}")
                if preview:
                    print(f"       preview: {preview}")
                print()
            except httpx.ConnectError as e:
                print(f"  ERR  {path}  (connect: {e})\n")
            except Exception as e:
                print(f"  ERR  {path}  ({e})\n")


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python -m scripts.probe_protocol_endpoints ROBOT_IP PROTOCOL_ID [MAIN_FILENAME]", file=sys.stderr)
        print("       python -m scripts.probe_protocol_endpoints ROBOT_IP RUN_ID  # resolve protocol_id from run", file=sys.stderr)
        print(f"       Example: python -m scripts.probe_protocol_endpoints {DEFAULT_IP} 114e30e6-6ea9-4612-adab-7cd7cc1b56cf rando.py", file=sys.stderr)
        return 1

    ip = sys.argv[1].strip()
    protocol_id = sys.argv[2].strip()
    main_filename = sys.argv[3].strip() if len(sys.argv) > 3 else None

    # If we only have run_id, resolve protocol_id and main file from robot
    if not main_filename:
        run_url = url(ip, f"runs/{protocol_id}")
        try:
            with httpx.Client(timeout=TIMEOUT, headers=HEADERS) as client:
                r = client.get(run_url)
                r.raise_for_status()
                data = r.json()
                run = data.get("data") if isinstance(data, dict) else data
                if isinstance(run, dict) and run.get("protocolId"):
                    protocol_id = run["protocolId"]
                    files = (run.get("data") or {}).get("files") or []
                    for f in files:
                        if isinstance(f, dict) and f.get("role") == "main":
                            main_filename = f.get("name")
                            break
                    if not main_filename and files and isinstance(files[0], dict):
                        main_filename = files[0].get("name")
                    print(f"Resolved from run: protocol_id={protocol_id}, main_filename={main_filename}\n")
        except Exception as e:
            print(f"Could not resolve run to protocol: {e}\n", file=sys.stderr)
            print("Probing with protocol_id only (no file paths).\n", file=sys.stderr)

    # If still no main filename, get it from GET /protocols/{id} metadata (run often lacks data.files)
    if not main_filename:
        try:
            with httpx.Client(timeout=TIMEOUT, headers=HEADERS) as client:
                r = client.get(url(ip, f"protocols/{protocol_id}"))
                r.raise_for_status()
                data = r.json()
                meta = data.get("data") if isinstance(data, dict) else data
                if isinstance(meta, dict):
                    files = meta.get("files") or []
                    for f in files:
                        if isinstance(f, dict) and f.get("role") == "main":
                            main_filename = f.get("name")
                            break
                    if not main_filename and files and isinstance(files[0], dict):
                        main_filename = files[0].get("name")
                    if main_filename:
                        print(f"Resolved from protocol metadata: main_filename={main_filename}\n")
        except Exception as e:
            print(f"Could not get protocol metadata: {e}\n", file=sys.stderr)

    probe(ip, protocol_id, main_filename)
    return 0


if __name__ == "__main__":
    sys.exit(main())
