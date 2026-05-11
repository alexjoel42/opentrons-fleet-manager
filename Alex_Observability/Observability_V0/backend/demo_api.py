"""Demo backend API for Opentrons fleet observability.

This module provides:
- BaseRobot: HTTP client for querying Opentrons robots (health, logs, pipettes,
  modules, runs, protocols) via the Opentrons HTTP API.
- FastAPI application with REST endpoints for health, local robot IP storage
  (JSON), and proxy routes (health, modules, pipettes, logs, runs, protocol,
  troubleshooting zip) that forward requests to robots by IP.
"""

from __future__ import annotations

import asyncio
import io
import logging
import ipaddress
import json
import os
import threading
import zipfile
from urllib.parse import quote
from pathlib import Path
from typing import Any

import httpx
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from note_compliance import local_operator_name_from_request, stamp_note_body

_log = logging.getLogger(__name__)

# Default port for Opentrons robot HTTP API (see docs.opentrons.com).
DEFAULT_PORT = 31950
# Default request timeout in seconds for robot HTTP calls.
DEFAULT_TIMEOUT = 10.0
class BaseRobot:
    """
    Client for querying Opentrons robots over the HTTP API.

    Use this class to fetch health, logs, serial number, and other data from
    one or more robots by IP address. No request is made at construction time;
    data is fetched when you call the instance methods.

    Attributes:
        port: TCP port for the robot HTTP API (default 31950).
        timeout: Request timeout in seconds.
        _headers: Headers sent with every request (Content-Type, Opentrons-Version).
    Methods:
    - get_health_data
    - get_health
    - get_logs
    - get_serial_number
    - get_pipettes
    - get_modules
    - get_subsystems
    - get_gripper
    - get_robot_info
    - get_robot_hardware
    - get_robot_runs
    - get_robot_logs
    """

    def __init__(
        self,
        opentrons_version: str = "*",
        port: int = DEFAULT_PORT,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        """
        Initialize the robot API client.

        Args:
            opentrons_version: Value for the Opentrons-Version header (e.g. "*").
            port: Port number for the robot HTTP API.
            timeout: Request timeout in seconds.
        """
        self.port = port
        self.timeout = timeout
        self._headers = {
            "Content-Type": "application/json",
            "Opentrons-Version": opentrons_version,
        }

    def _url(
        self,
        ip_address: str,
        path: str = "health",
        scheme: str | None = None,
        port: int | None = None,
    ) -> str:
        """Build the full URL for a given IP and path.

        IPv6 addresses are bracketed in the host part. Path is normalized (leading
        slashes stripped).

        Args:
            ip_address: Robot IP or hostname.
            path: API path segment (e.g. "health", "runs").
            scheme: 'http' or 'https'; defaults to 'http'.
            port: TCP port; defaults to self.port.

        Returns:
            Full URL string (e.g. "http://192.0.2.10:31950/health").
        """
        s = (scheme or "http").lower()
        p = port if port is not None else self.port
        path = path.strip("/")
        try:
            addr = ipaddress.ip_address(ip_address.strip())
            if addr.version == 6:
                return f"{s}://[{ip_address}]:{p}/{path}"
        except ValueError:
            pass
        return f"{s}://{ip_address}:{p}/{path}"

    def _get(
        self,
        ip_address: str,
        path: str,
        scheme: str | None = None,
        port: int | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """Perform a GET request to the robot.

        Args:
            ip_address: Robot IP or hostname.
            path: API path (e.g. "health", "runs").
            scheme: Optional 'http' or 'https'.
            port: Optional port override.
            params: Optional query string parameters.

        Returns:
            httpx.Response from the robot. Caller should call raise_for_status() or
            handle httpx.HTTPStatusError, ConnectError, TimeoutException as needed.
        """
        url = self._url(ip_address, path, scheme=scheme, port=port)
        return httpx.get(url, headers=self._headers, params=params, timeout=self.timeout)

    def get_health(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> dict[str, Any]:
        """
        Fetch full health response for a robot.

        Per Opentrons HTTP API (docs.opentrons.com), GET /health returns JSON body with
        name, robot_serial, robot_model, api_version, logs (paths), links (log URLs), etc.
        We merge JSON body with legacy header fallbacks so both old and new API work.

        Returns:
            Dict with name, serial_number (from robot_serial or header), status, date, logs, links, etc.
        """
        response = self._get(ip_address, "health", scheme=scheme, port=port)
        out: dict[str, Any] = {
            "name": response.headers.get("name"),
            "date": response.headers.get("date"),
            "logs": response.headers.get("logs"),
            "serial_number": response.headers.get("serial_number"),
            "status": response.headers.get("status"),
            "health_data": response.headers.get("health_data"),
        }
        try:
            body = response.json()
            if isinstance(body, dict):
                if body.get("name") is not None:
                    out["name"] = body["name"]
                if body.get("robot_serial") is not None:
                    out["serial_number"] = body["robot_serial"]
                if body.get("serial_number") is not None:
                    out["serial_number"] = body["serial_number"]
                for key in ("status", "date", "logs", "robot_model", "api_version", "fw_version", "system_version", "links"):
                    if body.get(key) is not None:
                        out[key] = body[key]
        except Exception:
            pass
        return out

    def get_logs(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> str:
        """
        Fetch combined troubleshooting logs for a robot.

        Per Opentrons HTTP API, logs are GET /logs/{log_identifier} (e.g. api.log, serial.log).
        We fetch health to get available log links, then GET each log and concatenate.
        Log identifiers: api.log, serial.log, server.log, touchscreen.log, can_bus.log,
        update_server.log, combined_api_server.log (see LOG_IDENTIFIERS in routes).
        """
        # Per Opentrons API: GET /logs/{log_identifier} with format=text (e.g. api.log, serial.log)
        DEFAULT_LOG_IDS = [
            "api.log", "serial.log", "server.log", "touchscreen.log",
            "can_bus.log", "update_server.log", "combined_api_server.log",
        ]
        parts: list[str] = []
        try:
            health = self.get_health(ip_address, scheme=scheme, port=port)
            links = health.get("links")
            if isinstance(links, dict):
                for _key, path in links.items():
                    if not path or not isinstance(path, str):
                        continue
                    log_id = path.split("/")[-1] if "/" in path else path
                    content = self.get_log_file(ip_address, log_id, scheme=scheme, port=port)
                    if content:
                        parts.append(f"=== {log_id} ===\n{content}")
            if not parts:
                for log_id in DEFAULT_LOG_IDS:
                    content = self.get_log_file(ip_address, log_id, scheme=scheme, port=port)
                    if content:
                        parts.append(f"=== {log_id} ===\n{content}")
        except Exception:
            pass
        return "\n\n".join(parts) if parts else ""

    def get_serial_number(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> str | None:
        """Fetch serial number for a robot from GET /serial_number.

        Args:
            ip_address: Robot IP or hostname.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Serial number from response header, or None if missing.
        """
        response = self._get(ip_address, "serial_number", scheme=scheme, port=port)
        return response.headers.get("serial_number")

    def get_pipettes(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> Any:
        """Fetch pipette information for a robot from GET /pipettes.

        Args:
            ip_address: Robot IP or hostname.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            JSON body from the API, or pipettes header value if body is not JSON.
        """
        response = self._get(ip_address, "pipettes", scheme=scheme, port=port)
        # Prefer JSON body if present; otherwise a header
        try:
            return response.json()
        except Exception:
            return response.headers.get("pipettes")
    def get_modules(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch modules information for a robot from GET /modules.

        Normalizes the API response (data/modules array) into a list of dicts with
        name, moduleType, serialNumber, and status.

        Args:
            ip_address: Robot IP or hostname.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            List of module dicts; empty list on parse or request error.
        """
        response = self._get(ip_address, "modules", scheme=scheme, port=port)
        try:
            data = response.json()
        except Exception:
            return []
        # Opentrons API returns { "data": [ ... ], "meta": { ... } }
        raw_modules = data if isinstance(data, list) else data.get("data") or data.get("modules") or []
        modules_list: list[dict[str, Any]] = []
        for module in raw_modules:
            if not isinstance(module, dict):
                continue
            # status lives in nested module["data"], not top-level
            nested = module.get("data") or {}
            status = nested.get("status") if isinstance(nested, dict) else None
            modules_list.append({
                "name": module.get("serialNumber"), 
                "moduleType": module.get("moduleType"),
                "serialNumber": module.get("serialNumber"),
                "status": status,
            })
        return modules_list
    def get_runs(
        self,
        ip_address: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> Any:
        """Fetch list of runs from robot via GET /runs.

        Args:
            ip_address: Robot IP or hostname.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Parsed JSON response (typically has "data" list of runs).
        """
        # Omit `pageLength`: per Opentrons HTTP API, omitted/null returns all runs. Passing
        # pageLength has been observed to truncate lists on some robot builds (see fleet UI).
        response = self._get(ip_address, "runs", scheme=scheme, port=port)
        return response.json()

    def get_run(
        self,
        ip_address: str,
        run_id: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> Any:
        """Fetch a single run by ID from GET /runs/{run_id}.

        Args:
            ip_address: Robot IP or hostname.
            run_id: Run identifier.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Parsed JSON run payload.

        Raises:
            httpx.HTTPStatusError: On 4xx/5xx responses.
        """
        response = self._get(ip_address, f"runs/{run_id}", scheme=scheme, port=port)
        response.raise_for_status()
        return response.json()

    def get_run_commands(
        self,
        ip_address: str,
        run_id: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> Any:
        """Fetch commands for a run from GET /runs/{run_id}/commands.

        Args:
            ip_address: Robot IP or hostname.
            run_id: Run identifier.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Parsed JSON (list or dict of commands).
        """
        response = self._get(ip_address, f"runs/{run_id}/commands", scheme=scheme, port=port)
        return response.json()

    def get_log_file(
        self,
        ip_address: str,
        log_identifier: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> str | None:
        """Fetch a single log file from GET /logs/{log_identifier} with format=text.

        Args:
            ip_address: Robot IP or hostname.
            log_identifier: Log name (e.g. "api.log", "serial.log").
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Log content as string, or None on 404/error.
        """
        url = self._url(ip_address, f"logs/{log_identifier}", scheme=scheme, port=port)
        try:
            response = httpx.get(
                url,
                headers={**self._headers, "Accept": "text/plain"},
                params={"format": "text"},
                timeout=self.timeout,
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.text
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
            return None

    def get_protocol(
        self,
        ip_address: str,
        protocol_id: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> Any:
        """Fetch protocol metadata by ID from GET /protocols/{protocol_id}.

        Returns metadata such as files, protocolType, etc. Does not return file
        contents; use get_protocol_file for that.

        Args:
            ip_address: Robot IP or hostname.
            protocol_id: Protocol identifier.
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Parsed JSON protocol metadata.

        Raises:
            httpx.HTTPStatusError: On 4xx/5xx.
        """
        response = self._get(ip_address, f"protocols/{protocol_id}", scheme=scheme, port=port)
        response.raise_for_status()
        return response.json()

    def get_protocol_file(
        self,
        ip_address: str,
        protocol_id: str,
        file_name: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> str | bytes | None:
        """
        Fetch protocol file content by protocol ID and file name.
        Tries several paths under /protocols/{id}/ that may expose the Python/JSON file.
        Filename is URL-encoded so names with spaces (e.g. "1_Simple Normalize Long Right.py") work.
        """
        encoded_name = quote(file_name, safe="")
        paths_to_try = [
            f"protocols/{protocol_id}/files/{encoded_name}",
            f"protocols/{protocol_id}/src/{encoded_name}",
            f"protocols/{protocol_id}/files/{file_name}",
            f"protocols/{protocol_id}/src/{file_name}",
            f"protocols/{protocol_id}/files/main",
            f"protocols/{protocol_id}/download",
            f"protocols/{protocol_id}/content",
            f"protocols/{protocol_id}/file",
            f"protocols/{protocol_id}/",
        ]
        for path in paths_to_try:
            result = self._get_protocol_file_at_path(
                ip_address, path, scheme=scheme, port=port
            )
            if result is not None:
                return result
        return None

    def _get_protocol_file_at_path(
        self,
        ip_address: str,
        path: str,
        scheme: str | None = None,
        port: int | None = None,
    ) -> str | bytes | None:
        """GET one path and return body if 200 and content looks like protocol source.

        Skips JSON metadata responses (e.g. protocolType, files list). Returns text
        for text/python content types and bytes for application/octet-stream.

        Args:
            ip_address: Robot IP or hostname.
            path: Full path segment (e.g. "protocols/{id}/files/main").
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            Response body as str or bytes, or None on non-200 or metadata JSON.
        """
        url = self._url(ip_address, path, scheme=scheme, port=port)
        try:
            response = httpx.get(
                url,
                headers={**self._headers, "Accept": "text/plain, application/octet-stream, application/json"},
                timeout=self.timeout,
            )
            if response.status_code != 200:
                return None
            content_type = (response.headers.get("content-type") or "").lower()
            text = response.text
            # Skip protocol metadata JSON (GET /protocols/{id} returns that)
            if "json" in content_type and "protocolType" in text and "files" in text:
                return None
            if "text" in content_type or "python" in content_type:
                return text
            if "octet-stream" in content_type:
                return response.content
            return text
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
            return None


app = FastAPI()


def _normalize_cors_origin(origin: str) -> str:
    """Strip whitespace and trailing slashes so env matches browser `Origin` (no path)."""
    o = origin.strip()
    while o.endswith("/"):
        o = o[:-1].rstrip()
    return o


def _cors_allow_origins() -> list[str]:
    """Comma-separated `CORS_ORIGINS` env for split-origin frontends; default `*` for dev."""
    raw = (os.environ.get("CORS_ORIGINS") or "").strip()
    if not raw:
        return ["*"]
    out = [_normalize_cors_origin(o) for o in raw.split(",") if o.strip()]
    if not out:
        _log.warning(
            "CORS_ORIGINS is set but parses to no origins; falling back to '*' (fix the env value)"
        )
        return ["*"]
    return out


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """JSON 500s for unexpected errors (HTTPException uses the default handler via MRO)."""
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Enable CORS so the React frontend (e.g. localhost:5174) can call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

robot_client = BaseRobot()

# Max concurrent robots when building /api/fleet/snapshot (each robot uses up to 4 parallel HTTP calls).
FLEET_SNAPSHOT_ROBOT_CONCURRENCY = 12


def _health_dict_from_httpx_response(response: httpx.Response) -> dict[str, Any]:
    """Merge health headers and JSON body; matches BaseRobot.get_health behavior (no raise_for_status)."""
    out: dict[str, Any] = {
        "name": response.headers.get("name"),
        "date": response.headers.get("date"),
        "logs": response.headers.get("logs"),
        "serial_number": response.headers.get("serial_number"),
        "status": response.headers.get("status"),
        "health_data": response.headers.get("health_data"),
    }
    try:
        body = response.json()
        if isinstance(body, dict):
            if body.get("name") is not None:
                out["name"] = body["name"]
            if body.get("robot_serial") is not None:
                out["serial_number"] = body["robot_serial"]
            if body.get("serial_number") is not None:
                out["serial_number"] = body["serial_number"]
            for key in (
                "status",
                "date",
                "logs",
                "robot_model",
                "api_version",
                "fw_version",
                "system_version",
                "links",
            ):
                if body.get(key) is not None:
                    out[key] = body[key]
    except Exception:
        pass
    return out


def _modules_list_from_payload(data: Any) -> list[dict[str, Any]]:
    """Normalize modules JSON; matches BaseRobot.get_modules."""
    if not isinstance(data, (dict, list)):
        return []
    raw_modules = data if isinstance(data, list) else data.get("data") or data.get("modules") or []
    modules_list: list[dict[str, Any]] = []
    for module in raw_modules:
        if not isinstance(module, dict):
            continue
        nested = module.get("data") or {}
        status = nested.get("status") if isinstance(nested, dict) else None
        modules_list.append(
            {
                "name": module.get("serialNumber"),
                "moduleType": module.get("moduleType"),
                "serialNumber": module.get("serialNumber"),
                "status": status,
            }
        )
    return modules_list


async def _fetch_one_robot_snapshot(
    client: httpx.AsyncClient,
    ip: str,
    headers: dict[str, str],
    timeout: float,
    sem: asyncio.Semaphore,
) -> tuple[str, dict[str, Any], str | None]:
    """Fetch health, modules, pipettes, runs for one robot. Returns (ip, payload, error_if_unreachable)."""
    err_unreach: str | None = None

    async def get_health() -> dict[str, Any] | None:
        nonlocal err_unreach
        url = robot_client._url(ip, "health")
        try:
            r = await client.get(url, headers=headers, timeout=timeout)
            return _health_dict_from_httpx_response(r)
        except httpx.ConnectError as e:
            err_unreach = str(e) or "Connection refused"
            return None
        except httpx.TimeoutException as e:
            err_unreach = str(e) or "Request timed out"
            return None
        except Exception as e:
            err_unreach = str(e)
            return None

    async def get_modules() -> list[dict[str, Any]] | None:
        url = robot_client._url(ip, "modules")
        try:
            r = await client.get(url, headers=headers, timeout=timeout)
            try:
                data = r.json()
            except Exception:
                return []
            return _modules_list_from_payload(data)
        except (httpx.ConnectError, httpx.TimeoutException):
            return None
        except Exception:
            return None

    async def get_pipettes() -> Any:
        url = robot_client._url(ip, "pipettes")
        try:
            r = await client.get(url, headers=headers, timeout=timeout)
            try:
                return r.json()
            except Exception:
                return r.headers.get("pipettes")
        except (httpx.ConnectError, httpx.TimeoutException):
            return None
        except Exception:
            return None

    async def get_runs() -> Any:
        url = robot_client._url(ip, "runs")
        try:
            r = await client.get(url, headers=headers, timeout=timeout)
            return r.json()
        except (httpx.ConnectError, httpx.TimeoutException):
            return None
        except Exception:
            return None

    async with sem:
        health, modules, pipettes, runs = await asyncio.gather(
            get_health(),
            get_modules(),
            get_pipettes(),
            get_runs(),
        )

    payload: dict[str, Any] = {
        "health": health,
        "modules": modules,
        "pipettes": pipettes,
        "runs": runs,
    }
    if health is None and err_unreach:
        return ip, payload, err_unreach
    if health is None:
        return ip, payload, "Robot unreachable"
    return ip, payload, None


def _main_protocol_file_name_from_files_list(files: list[Any]) -> str | None:
    """Pick main protocol source name from a `files` array (Opentrons run/protocol metadata shape)."""
    if not files:
        return None
    for f in files:
        if isinstance(f, dict) and f.get("role") == "main":
            name = f.get("name") if isinstance(f.get("name"), str) else None
            if name:
                return name
    first = files[0]
    if isinstance(first, dict) and isinstance(first.get("name"), str):
        return first["name"]
    return None


def _resolve_main_protocol_file_name(ip: str, run: dict[str, Any]) -> str | None:
    """Resolve the main `.py` file name from run `data.files`, or from GET /protocols/{id} if missing."""
    run_data = run.get("data") if isinstance(run.get("data"), dict) else None
    run_files = (run_data.get("files") or []) if run_data else []
    name = _main_protocol_file_name_from_files_list(run_files)
    if name:
        return name
    protocol_id = run.get("protocolId")
    if not isinstance(protocol_id, str):
        return None
    try:
        protocol_response = robot_client.get_protocol(ip, protocol_id)
        protocol_meta = (
            protocol_response.get("data") if isinstance(protocol_response, dict) else protocol_response
        )
        if isinstance(protocol_meta, dict):
            return _main_protocol_file_name_from_files_list(protocol_meta.get("files") or [])
    except Exception:
        pass
    return None


# Hostnames accepted in addition to IPv4/IPv6 for robot address validation (e.g. dev/simulator).
ALLOWED_HOSTNAMES = frozenset({"localhost"})


@app.get("/")
async def root():
    """Landing when visiting the deployed base URL; API routes live under /api/*."""
    return {
        "service": "opentrons-fleet-manager-api",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


def _is_valid_robot_address(ip: str) -> bool:
    """Return True if the value is a valid IPv4, IPv6, or an allowed hostname (e.g. localhost)."""
    s = ip.strip()
    if not s:
        return False
    try:
        ipaddress.ip_address(s)
        return True
    except ValueError:
        return s.lower() in ALLOWED_HOSTNAMES


def validate_ip(ip: str) -> None:
    """Validate robot address. Raises HTTP 400 if not a valid IPv4, IPv6, or allowed hostname."""
    if not _is_valid_robot_address(ip):
        raise HTTPException(status_code=400, detail="Invalid robot IP address")


def robot_http_error(message: str, code: str, status_code: int = 503) -> HTTPException:
    """Build an HTTPException with consistent JSON detail for robot connection/API errors.

    Args:
        message: Human-readable error message.
        code: Machine-readable code (e.g. ROBOT_UNREACHABLE, TIMEOUT).
        status_code: HTTP status (default 503).

    Returns:
        HTTPException with detail={"error": message, "code": code}.
    """
    return HTTPException(status_code=status_code, detail={"error": message, "code": code})


# --- Robot IP store (JSON file, env fallback) ---
# Path to JSON file storing the list of configured robot IPs (key "ips").
ROBOT_IPS_FILE = Path(__file__).resolve().parent / "robot_ips.json"
# Local fleet: free-form notes per robot IP (key "notes": { "10.0.0.1": "..." }).
ROBOT_NOTES_FILE = Path(__file__).resolve().parent / "robot_notes.json"
# Named dashboard membership (subset of configured IPs per slug); shared across clients.
ROBOT_DASHBOARDS_FILE = Path(__file__).resolve().parent / "robot_dashboards.json"
# Cooperative checkout: who is using each robot (honor-system operator name).
ROBOT_CHECKOUTS_FILE = Path(__file__).resolve().parent / "robot_checkouts.json"
# Lock for thread-safe read/write of fleet JSON stores.
_store_lock = threading.RLock()


def _load_robot_ips() -> list[str]:
    """Load robot IP list from file. If file missing or empty, seed from ROBOT_IPS env and persist."""
    with _store_lock:
        if ROBOT_IPS_FILE.exists():
            try:
                raw = ROBOT_IPS_FILE.read_text()
                data = json.loads(raw)
                ips = data.get("ips") or []
                if isinstance(ips, list) and all(isinstance(x, str) for x in ips):
                    return [s.strip() for s in ips if _is_valid_robot_address(s)]
            except (json.JSONDecodeError, OSError):
                pass
        raw = os.environ.get("ROBOT_IPS", "")
        ips = [s.strip() for s in raw.split(",") if _is_valid_robot_address(s)]
        _save_robot_ips(ips)
        return ips


def _save_robot_ips(ips: list[str]) -> None:
    """Write robot IP list to ROBOT_IPS_FILE. Caller must hold _store_lock."""
    ROBOT_IPS_FILE.write_text(json.dumps({"ips": ips}, indent=2))


def _utc_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _normalize_local_run_notes(raw: Any) -> dict[str, dict[str, dict[str, dict[str, str]]]]:
    """run_notes[ip][run_id][detail|inline] = {body, updated_at}."""
    out: dict[str, dict[str, dict[str, dict[str, str]]]] = {}
    if not isinstance(raw, dict):
        return out
    for ip, runs in raw.items():
        if not isinstance(ip, str) or not _is_valid_robot_address(ip):
            continue
        if not isinstance(runs, dict):
            continue
        ipk = ip.strip()
        out[ipk] = {}
        for rid, slots in runs.items():
            if not isinstance(rid, str) or len(rid) > 128:
                continue
            if not isinstance(slots, dict):
                continue
            entry: dict[str, dict[str, str]] = {}
            for slot in ("detail", "inline"):
                chunk = slots.get(slot)
                if isinstance(chunk, dict):
                    b = chunk.get("body")
                    ts = chunk.get("updated_at")
                    if isinstance(b, str) and b.strip():
                        entry[slot] = {
                            "body": b.strip()[:200_000],
                            "updated_at": ts if isinstance(ts, str) else _utc_iso(),
                        }
            if entry:
                out[ipk][rid] = entry
    return out


def _read_notes_store_unlocked() -> dict[str, Any]:
    """Full local notes file: ``notes`` (per-IP dashboard) + ``run_notes`` (per IP/run/slot). Caller holds _store_lock."""
    if not ROBOT_NOTES_FILE.exists():
        return {"notes": {}, "run_notes": {}}
    try:
        data = json.loads(ROBOT_NOTES_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {"notes": {}, "run_notes": {}}
    notes: dict[str, str] = {}
    raw_notes = data.get("notes") or {}
    if isinstance(raw_notes, dict):
        for k, v in raw_notes.items():
            if isinstance(k, str) and isinstance(v, str) and _is_valid_robot_address(k):
                notes[k.strip()] = v
    run_notes = _normalize_local_run_notes(data.get("run_notes"))
    return {"notes": notes, "run_notes": run_notes}


def _write_notes_store_unlocked(store: dict[str, Any]) -> None:
    """Persist combined store. Caller holds _store_lock."""
    payload = {"notes": store.get("notes") or {}, "run_notes": store.get("run_notes") or {}}
    ROBOT_NOTES_FILE.write_text(json.dumps(payload, indent=2))


def _load_robot_notes() -> dict[str, str]:
    """Return all local fleet dashboard notes keyed by robot address."""
    with _store_lock:
        return dict(_read_notes_store_unlocked().get("notes") or {})


def _save_robot_notes(notes: dict[str, str]) -> None:
    """Update dashboard notes only; preserves run_notes. Caller must hold _store_lock."""
    store = _read_notes_store_unlocked()
    store["notes"] = notes
    _write_notes_store_unlocked(store)


def _is_valid_dashboard_slug(s: str) -> bool:
    if not s or len(s) > 64:
        return False
    for c in s:
        if c.isalnum() or c in "-_":
            continue
        return False
    return True


def _load_robot_dashboards_unlocked() -> dict[str, Any]:
    """Return dashboards map and tab order. Caller must hold _store_lock."""
    if not ROBOT_DASHBOARDS_FILE.exists():
        return {"dashboards": {}, "order": []}
    try:
        data = json.loads(ROBOT_DASHBOARDS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {"dashboards": {}, "order": []}
    dashboards_raw = data.get("dashboards") if isinstance(data, dict) else None
    dashboards: dict[str, list[str]] = {}
    if isinstance(dashboards_raw, dict):
        for k, v in dashboards_raw.items():
            if not isinstance(k, str) or not _is_valid_dashboard_slug(k.strip()):
                continue
            key = k.strip()
            if not isinstance(v, list):
                continue
            ips_out: list[str] = []
            for x in v:
                if isinstance(x, str) and _is_valid_robot_address(x.strip()):
                    ips_out.append(x.strip())
            dashboards[key] = ips_out
    order_raw = data.get("order") if isinstance(data, dict) else None
    order_list: list[str] = []
    if isinstance(order_raw, list):
        for x in order_raw:
            if isinstance(x, str) and _is_valid_dashboard_slug(x.strip()):
                order_list.append(x.strip())
    seen_order: list[str] = []
    for slug in order_list:
        if slug in dashboards and slug not in seen_order:
            seen_order.append(slug)
    for slug in dashboards:
        if slug not in seen_order:
            seen_order.append(slug)
    return {"dashboards": dashboards, "order": seen_order}


def _save_robot_dashboards_unlocked(dashboards: dict[str, list[str]], order: list[str]) -> None:
    """Persist dashboard membership. Caller must hold _store_lock."""
    ROBOT_DASHBOARDS_FILE.write_text(json.dumps({"dashboards": dashboards, "order": order}, indent=2))


def _load_robot_dashboards() -> dict[str, Any]:
    with _store_lock:
        return dict(_load_robot_dashboards_unlocked())


def _load_robot_checkouts_unlocked() -> dict[str, dict[str, str]]:
    """checkout[ip] = {operator, since}. Caller must hold _store_lock."""
    if not ROBOT_CHECKOUTS_FILE.exists():
        return {}
    try:
        data = json.loads(ROBOT_CHECKOUTS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    raw = data.get("checkouts") if isinstance(data, dict) else None
    out: dict[str, dict[str, str]] = {}
    if not isinstance(raw, dict):
        return out
    for ip, entry in raw.items():
        if not isinstance(ip, str) or not _is_valid_robot_address(ip.strip()):
            continue
        if not isinstance(entry, dict):
            continue
        op = entry.get("operator")
        since = entry.get("since")
        if not isinstance(op, str) or not op.strip():
            continue
        if not isinstance(since, str):
            since = _utc_iso()
        out[ip.strip()] = {"operator": op.strip()[:200], "since": since}
    return out


def _save_robot_checkouts_unlocked(checkouts: dict[str, dict[str, str]]) -> None:
    """Persist checkouts. Caller must hold _store_lock."""
    ROBOT_CHECKOUTS_FILE.write_text(json.dumps({"checkouts": checkouts}, indent=2))


def _load_robot_checkouts() -> dict[str, dict[str, str]]:
    with _store_lock:
        return dict(_load_robot_checkouts_unlocked())


def _strip_ip_from_dashboards_unlocked(ip_key: str) -> None:
    """Remove ip from every dashboard list when robot removed from fleet."""
    store = _load_robot_dashboards_unlocked()
    dashboards: dict[str, list[str]] = dict(store.get("dashboards") or {})
    order: list[str] = list(store.get("order") or [])
    changed = False
    for slug, ips in list(dashboards.items()):
        filt = [x for x in ips if x != ip_key]
        if len(filt) != len(ips):
            changed = True
        dashboards[slug] = filt
    if changed:
        _save_robot_dashboards_unlocked(dashboards, order)


@app.get("/api/dashboards")
def get_dashboards() -> dict[str, Any]:
    """Return named dashboard membership and tab order (shared JSON store)."""
    return _load_robot_dashboards()


@app.put("/api/dashboards")
def put_dashboards(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Replace dashboard membership. Each IP may appear in at most one dashboard; IPs must exist in fleet."""
    raw_d = body.get("dashboards")
    raw_order = body.get("order")
    if not isinstance(raw_d, dict):
        raise HTTPException(
            status_code=400,
            detail={"error": '"dashboards" must be an object mapping slug to IP arrays', "code": "INVALID_BODY"},
        )
    normalized: dict[str, list[str]] = {}
    for k, v in raw_d.items():
        if not isinstance(k, str) or not _is_valid_dashboard_slug(k.strip()):
            raise HTTPException(
                status_code=400,
                detail={"error": f"Invalid dashboard slug: {k!r}", "code": "INVALID_SLUG"},
            )
        slug = k.strip()
        if not isinstance(v, list):
            raise HTTPException(
                status_code=400,
                detail={"error": f"Dashboard {slug!r} must map to an IP array", "code": "INVALID_BODY"},
            )
        ips_list: list[str] = []
        for x in v:
            if not isinstance(x, str):
                continue
            s = x.strip()
            if s and _is_valid_robot_address(s):
                ips_list.append(s)
        normalized[slug] = ips_list

    order_out: list[str] = []
    if raw_order is not None:
        if not isinstance(raw_order, list):
            raise HTTPException(
                status_code=400,
                detail={"error": '"order" must be an array of dashboard slugs', "code": "INVALID_BODY"},
            )
        for x in raw_order:
            if isinstance(x, str) and _is_valid_dashboard_slug(x.strip()):
                slug = x.strip()
                if slug in normalized and slug not in order_out:
                    order_out.append(slug)
    for slug in normalized:
        if slug not in order_out:
            order_out.append(slug)

    with _store_lock:
        allowed = set(_load_robot_ips())
        seen_ips: set[str] = set()
        for slug, ips_list in normalized.items():
            for ip in ips_list:
                if ip not in allowed:
                    raise HTTPException(
                        status_code=400,
                        detail={"error": f"IP {ip!r} is not in the fleet list", "code": "UNKNOWN_IP"},
                    )
                if ip in seen_ips:
                    raise HTTPException(
                        status_code=400,
                        detail={"error": f"IP {ip!r} appears in more than one dashboard", "code": "DUPLICATE_IP"},
                    )
                seen_ips.add(ip)
        _save_robot_dashboards_unlocked(normalized, order_out)

    return _load_robot_dashboards()


@app.get("/api/robots")
def list_robots() -> dict[str, Any]:
    """Return configured robot IPs, per-IP notes, and cooperative checkouts."""
    ips = _load_robot_ips()
    notes = _load_robot_notes()
    checkouts = _load_robot_checkouts()
    return {"ips": ips, "notes": notes, "checkouts": checkouts}


@app.get("/api/fleet/snapshot")
async def fleet_snapshot(dashboard: str | None = Query(None)) -> dict[str, Any]:
    """Batch health, modules, pipettes, and runs for configured robots.

    Optional ``dashboard``: omit, empty, or ``all`` for entire fleet; otherwise only IPs
    assigned to that dashboard slug are included (unknown slug → empty snapshot).

    Uses bounded concurrency. Includes ``checkouts`` for robots in this snapshot.
    """
    all_ips = _load_robot_ips()
    d_slug = (dashboard or "").strip()
    if not d_slug or d_slug.lower() == "all":
        ips = all_ips
    else:
        dash_store = _load_robot_dashboards()
        dmap: dict[str, Any] = dash_store.get("dashboards") or {}
        ips = list(dmap.get(d_slug, []))

    checkouts_all = _load_robot_checkouts()
    checkouts = {ip: checkouts_all[ip] for ip in ips if ip in checkouts_all}

    if not ips:
        return {"robots": {}, "errors": {}, "checkouts": checkouts}

    headers = robot_client._headers
    timeout = robot_client.timeout
    sem = asyncio.Semaphore(FLEET_SNAPSHOT_ROBOT_CONCURRENCY)
    async with httpx.AsyncClient() as client:
        tasks = [_fetch_one_robot_snapshot(client, ip, headers, timeout, sem) for ip in ips]
        results = await asyncio.gather(*tasks)
    robots: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for ip, payload, err in results:
        robots[ip] = payload
        if err:
            errors[ip] = err
    return {"robots": robots, "errors": errors, "checkouts": checkouts}


@app.post("/api/robots/{ip}/checkout")
def checkout_robot(ip: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Claim a robot for an operator. Idempotent if the same operator already holds the checkout."""
    validate_ip(ip)
    key = ip.strip()
    operator = (body.get("operator") or "").strip()
    if not operator:
        raise HTTPException(
            status_code=400,
            detail={"error": 'Body must include non-empty "operator"', "code": "INVALID_BODY"},
        )
    operator_norm = operator[:200]
    with _store_lock:
        checkouts = _load_robot_checkouts_unlocked()
        existing = checkouts.get(key)
        if existing:
            if existing.get("operator") == operator_norm:
                return {"ip": key, "checkout": existing}
            raise HTTPException(
                status_code=409,
                detail={
                    "error": f"Robot is in use by {existing.get('operator')}",
                    "code": "CHECKOUT_CONFLICT",
                },
            )
        entry = {"operator": operator_norm, "since": _utc_iso()}
        checkouts[key] = entry
        _save_robot_checkouts_unlocked(checkouts)
    return {"ip": key, "checkout": entry}


@app.delete("/api/robots/{ip}/checkout")
def release_robot_checkout(ip: str) -> dict[str, Any]:
    """Release cooperative checkout (lab trust: any visitor may release)."""
    validate_ip(ip)
    key = ip.strip()
    with _store_lock:
        checkouts = _load_robot_checkouts_unlocked()
        removed = checkouts.pop(key, None)
        if removed is not None:
            _save_robot_checkouts_unlocked(checkouts)
    return {"ip": key, "released": removed is not None}


@app.post("/api/robots")
def add_robot(body: dict[str, str] = Body(...)) -> dict[str, list[str]]:
    """Add a robot IP to the store. Body must include "ip". Returns updated list of IPs."""
    ip = (body.get("ip") or "").strip()
    validate_ip(ip)
    with _store_lock:
        ips = _load_robot_ips()
        if ip in ips:
            return {"ips": ips}
        ips = ips + [ip]
        _save_robot_ips(ips)
    return {"ips": ips}


@app.post("/api/robots/bulk")
def add_robots_bulk(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Merge many robot addresses into the store. Body: {\"ips\": [\"10.0.0.1\", ...]}. Skips invalid entries."""
    raw = body.get("ips")
    if not isinstance(raw, list):
        raise HTTPException(
            status_code=400,
            detail={"error": 'Request body must include "ips" as an array of strings', "code": "INVALID_BODY"},
        )
    to_add: list[str] = []
    for x in raw:
        if not isinstance(x, str):
            continue
        s = x.strip()
        if not s or not _is_valid_robot_address(s):
            continue
        to_add.append(s)
    with _store_lock:
        ips = _load_robot_ips()
        seen = set(ips)
        added = 0
        for s in to_add:
            if s not in seen:
                seen.add(s)
                ips.append(s)
                added += 1
        _save_robot_ips(ips)
    return {"ips": ips, "added": added}


@app.delete("/api/robots/{ip}")
def remove_robot(ip: str) -> dict[str, list[str]]:
    """Remove a robot IP from the store. Returns the updated list of IPs."""
    validate_ip(ip)
    key = ip.strip()
    with _store_lock:
        ips = [x for x in _load_robot_ips() if x != key]
        _save_robot_ips(ips)
        store = _read_notes_store_unlocked()
        store["notes"].pop(key, None)
        store["run_notes"].pop(key, None)
        _write_notes_store_unlocked(store)
        _strip_ip_from_dashboards_unlocked(key)
        co = _load_robot_checkouts_unlocked()
        if co.pop(key, None) is not None:
            _save_robot_checkouts_unlocked(co)
    return {"ips": ips}


@app.patch("/api/robots/{ip}/notes")
def patch_robot_notes_by_ip(
    ip: str,
    request: Request,
    body: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    """Set or clear dashboard notes for one robot (local JSON store). Body: {\"notes\": \"...\" | null}."""
    validate_ip(ip)
    key = ip.strip()
    if "notes" not in body:
        raise HTTPException(
            status_code=400,
            detail={"error": 'Body must include "notes" (string or null)', "code": "INVALID_BODY"},
        )
    raw = body.get("notes")
    op_name = local_operator_name_from_request(request)
    with _store_lock:
        store = _read_notes_store_unlocked()
        notes: dict[str, str] = dict(store.get("notes") or {})
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            notes.pop(key, None)
        elif isinstance(raw, str):
            notes[key] = stamp_note_body(raw.strip()[:200_000], op_name)
        else:
            raise HTTPException(
                status_code=400,
                detail={"error": '"notes" must be a string or null', "code": "INVALID_BODY"},
            )
        store["notes"] = notes
        _write_notes_store_unlocked(store)
        out = notes.get(key)
    return {"ip": key, "notes": out}


@app.get("/api/robots/{ip}/run-notes")
def get_local_run_notes(ip: str) -> dict[str, Any]:
    """Per-run notes (detail + inline) for one robot IP from local JSON store."""
    validate_ip(ip)
    key = ip.strip()
    with _store_lock:
        store = _read_notes_store_unlocked()
    runs = (store.get("run_notes") or {}).get(key, {})
    return {"ip": key, "runs": runs}


@app.patch("/api/robots/{ip}/runs/{run_id}/notes")
def patch_local_run_notes(
    ip: str,
    run_id: str,
    request: Request,
    body: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    """Update detail and/or inline run notes. Include ``detail`` and/or ``inline`` keys (string or null; empty clears)."""
    validate_ip(ip)
    key = ip.strip()
    rid = (run_id or "").strip()
    if not rid or len(rid) > 128:
        raise HTTPException(status_code=400, detail="Invalid run_id")
    if not any(k in body for k in ("detail", "inline")):
        raise HTTPException(
            status_code=400,
            detail={"error": 'Include at least one of "detail", "inline"', "code": "INVALID_BODY"},
        )
    now = _utc_iso()
    op_name = local_operator_name_from_request(request)
    with _store_lock:
        store = _read_notes_store_unlocked()
        run_notes: dict[str, Any] = dict(store.get("run_notes") or {})
        by_ip: dict[str, Any] = dict(run_notes.get(key) or {})
        entry: dict[str, Any] = dict(by_ip.get(rid) or {})
        for slot in ("detail", "inline"):
            if slot not in body:
                continue
            val = body.get(slot)
            if val is None or (isinstance(val, str) and not val.strip()):
                entry.pop(slot, None)
            elif isinstance(val, str):
                entry[slot] = {
                    "body": stamp_note_body(val.strip()[:200_000], op_name),
                    "updated_at": now,
                }
            else:
                raise HTTPException(
                    status_code=400,
                    detail={"error": f'"{slot}" must be a string or null', "code": "INVALID_BODY"},
                )
        if entry:
            by_ip[rid] = entry
        else:
            by_ip.pop(rid, None)
        if by_ip:
            run_notes[key] = by_ip
        else:
            run_notes.pop(key, None)
        store["run_notes"] = run_notes
        _write_notes_store_unlocked(store)
        out_entry = by_ip.get(rid) or {}
    return {"ip": key, "run_id": rid, "detail": out_entry.get("detail"), "inline": out_entry.get("inline")}


@app.get("/api/robots/{ip}/health")
def get_robot_health(ip: str) -> dict[str, Any]:
    """Proxy GET /health from the robot at the given IP. Returns health dict or raises with robot_http_error."""
    validate_ip(ip)
    try:
        return robot_client.get_health(ip)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/modules")
def get_robot_modules(ip: str) -> list[dict[str, Any]]:
    """Proxy GET /modules from the robot at the given IP. Returns list of module dicts."""
    validate_ip(ip)
    try:
        return robot_client.get_modules(ip)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/pipettes")
def get_robot_pipettes(ip: str) -> Any:
    """Proxy GET /pipettes from the robot at the given IP. Returns pipette data (dict or list)."""
    validate_ip(ip)
    try:
        return robot_client.get_pipettes(ip)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/logs")
def get_robot_logs(ip: str) -> dict[str, str | None]:
    """Proxy combined robot logs from the robot at the given IP. Returns {"logs": "<text>"}."""
    validate_ip(ip)
    try:
        logs = robot_client.get_logs(ip)
        return {"logs": logs}
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/serial_number")
def get_robot_serial_number(ip: str) -> dict[str, str | None]:
    """Proxy serial number from the robot at the given IP. Returns {"serial_number": "<value>"}."""
    validate_ip(ip)
    try:
        serial = robot_client.get_serial_number(ip)
        return {"serial_number": serial}
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/runs")
def get_robot_runs(ip: str) -> Any:
    """Proxy GET /runs from the robot at the given IP. Returns runs list (typically data array)."""
    validate_ip(ip)
    try:
        return robot_client.get_runs(ip)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/runs/{run_id}")
def get_robot_run(ip: str, run_id: str) -> Any:
    """Proxy GET /runs/{run_id} from the robot. Returns run payload (includes data.files with protocol file name)."""
    validate_ip(ip)
    try:
        return robot_client.get_run(ip, run_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise robot_http_error("Run not found", "RUN_NOT_FOUND", 404)
        raise robot_http_error(str(e) or "Robot error", "ROBOT_ERROR", e.response.status_code)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/runs/{run_id}/check")
def get_robot_run_check(ip: str, run_id: str) -> dict[str, bool]:
    """Check that run detail is available for the given run. Returns runDetailAvailable and troubleshootingZipAvailable flags."""
    validate_ip(ip)
    try:
        robot_client.get_run(ip, run_id)
        return {"runDetailAvailable": True, "troubleshootingZipAvailable": True}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise robot_http_error("Run not found", "RUN_NOT_FOUND", 404)
        raise robot_http_error(str(e) or "Robot error", "ROBOT_ERROR", e.response.status_code)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")


@app.get("/api/robots/{ip}/runs/{run_id}/protocol-name")
def get_robot_run_protocol_name(ip: str, run_id: str) -> dict[str, str | None]:
    """Return the main protocol source file name (e.g. `assay.py`) without fetching file contents.

    Uses run `data.files` when present; otherwise loads protocol metadata from GET /protocols/{id}.
    """
    validate_ip(ip)
    try:
        run_response = robot_client.get_run(ip, run_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise robot_http_error("Run not found", "RUN_NOT_FOUND", 404)
        raise robot_http_error(str(e) or "Robot error", "ROBOT_ERROR", e.response.status_code)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")

    run = run_response.get("data") if isinstance(run_response, dict) else run_response
    if not isinstance(run, dict):
        raise robot_http_error("Run not found", "NOT_FOUND", 404)

    return {"protocolFileName": _resolve_main_protocol_file_name(ip, run)}


@app.get("/api/robots/{ip}/runs/{run_id}/protocol")
def get_robot_run_protocol(ip: str, run_id: str) -> Any:
    """Get protocol metadata and main protocol file content for a run.

    Resolves run -> protocolId -> protocol resource, then fetches main file content when
    the robot exposes it. Returns runId, run, protocolId, protocol, protocolFileName,
    protocolFileContent, and optional message if file content could not be retrieved.
    """
    validate_ip(ip)
    try:
        run_response = robot_client.get_run(ip, run_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise robot_http_error("Run not found", "RUN_NOT_FOUND", 404)
        raise robot_http_error(str(e) or "Robot error", "ROBOT_ERROR", e.response.status_code)
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")

    run = run_response.get("data") if isinstance(run_response, dict) else run_response
    if not isinstance(run, dict):
        raise robot_http_error("Run not found", "NOT_FOUND", 404)

    protocol_id = run.get("protocolId")
    if not protocol_id or not isinstance(protocol_id, str):
        return {
            "runId": run_id,
            "run": run,
            "protocolId": None,
            "protocol": None,
            "protocolFileContent": None,
            "message": "Run has no protocolId.",
        }

    protocol_meta: Any = None
    protocol_file_content: str | None = None

    run_data = run.get("data") if isinstance(run.get("data"), dict) else None
    run_files = (run_data.get("files") or []) if run_data else []
    main_file_name: str | None = _main_protocol_file_name_from_files_list(run_files)

    try:
        protocol_response = robot_client.get_protocol(ip, protocol_id)
        protocol_meta = (
            protocol_response.get("data") if isinstance(protocol_response, dict) else protocol_response
        )
        if not main_file_name and isinstance(protocol_meta, dict):
            main_file_name = _main_protocol_file_name_from_files_list(protocol_meta.get("files") or [])
    except Exception:
        protocol_meta = None

    # Try to fetch protocol file content (use main file name or fallback "main" for path tries)
    file_name_to_try = main_file_name or "main"
    raw = robot_client.get_protocol_file(ip, protocol_id, file_name_to_try)
    if raw is not None:
        protocol_file_content = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw

    if not main_file_name and protocol_file_content:
        main_file_name = "protocol.py"

    message: str | None = None
    if protocol_file_content is None and protocol_id:
        message = (
            "Protocol file could not be retrieved from the robot. "
            "The robot may not expose the protocol source at the expected endpoints."
        )

    return {
        "runId": run_id,
        "run": run,
        "protocolId": protocol_id,
        "protocol": protocol_meta,
        "protocolFileName": main_file_name,
        "protocolFileContent": protocol_file_content,
        **({"message": message} if message else {}),
    }


# Log file identifiers requested from the robot for the troubleshooting zip (per Opentrons HTTP API).
LOG_IDENTIFIERS = [
    "api.log",
    "serial.log",
    "server.log",
    "touchscreen.log",
    "can_bus.log",
    "update_server.log",
    "combined_api_server.log",
]


def _run_from_list(runs_data: Any) -> dict[str, Any] | None:
    """Extract the current run, or latest run with errors, or latest run from GET /runs response.

    Args:
        runs_data: Parsed JSON from GET /runs (expects "data" list of run dicts).

    Returns:
        One run dict or None if no runs.
    """
    data = runs_data.get("data") if isinstance(runs_data, dict) else None
    if not isinstance(data, list) or not data:
        return None
    # Prefer current run
    for r in data:
        if isinstance(r, dict) and r.get("current"):
            return r
    # Else latest run that has errors
    for r in reversed(data):
        if isinstance(r, dict) and (r.get("errors") or []):
            return r
    # Else just latest
    return data[-1] if data else None


def _build_troubleshooting_zip(ip: str, run: dict[str, Any]) -> bytes:
    """Build an in-memory zip with ERROR_SUMMARY.txt, run_log.json, protocol file, and logs/.

    Fetches robot serial, pipettes, modules, run commands, protocol file, and log files
    from the robot at ip and assembles them into a single zip payload.

    Args:
        ip: Robot IP or hostname.
        run: Run dict (id, errors, pipettes, modules, protocolId, etc.).

    Returns:
        Zip file content as bytes.
    """
    run_id = run.get("id") or "unknown"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. ERROR_SUMMARY.txt: error message(s) + robot + pipette + module serials
        robot_serial: str | None = None
        try:
            robot_serial = robot_client.get_serial_number(ip)
        except Exception:
            pass
        pipettes = run.get("pipettes") or []
        modules = run.get("modules") or []
        # If run has no pipettes/modules, fetch from robot
        if not pipettes or not modules:
            try:
                if not pipettes:
                    raw = robot_client.get_pipettes(ip)
                    if isinstance(raw, dict) and "data" in raw:
                        pipettes = raw.get("data") or []
                    elif isinstance(raw, list):
                        pipettes = raw
                if not modules:
                    modules = robot_client.get_modules(ip)
            except Exception:
                pass
        errors = run.get("errors") or []
        lines = [
            "=== ERROR SUMMARY ===",
            "",
        ]
        if errors:
            for i, err in enumerate(errors):
                if isinstance(err, dict):
                    lines.append(f"Error {i + 1}: {err.get('detail') or err.get('errorType') or 'Unknown'}")
                    if err.get("errorCode"):
                        lines.append(f"  Code: {err.get('errorCode')}")
            lines.append("")
        else:
            lines.append("No errors recorded for this run.")
            lines.append("")
        lines.extend([
            "=== ROBOT ===",
            f"Serial: {robot_serial or 'N/A'}",
            "",
            "=== PIPETTES ===",
        ])
        for p in pipettes:
            if isinstance(p, dict):
                name = p.get("pipetteName") or p.get("name") or "—"
                mount = p.get("mount") or ""
                serial = p.get("serialNumber") or p.get("id") or "N/A"
                lines.append(f"  {name} (mount: {mount}) — Serial: {serial}")
        if not pipettes:
            lines.append("  None")
        lines.extend(["", "=== MODULES ==="])
        for m in modules:
            if isinstance(m, dict):
                model = m.get("model") or m.get("moduleType") or "—"
                serial = m.get("serialNumber") or m.get("name") or "N/A"
                lines.append(f"  {model} — Serial: {serial}")
        if not modules:
            lines.append("  None")
        zf.writestr("ERROR_SUMMARY.txt", "\n".join(lines))

        # 2. Run log: run payload + commands if available
        run_log: dict[str, Any] = {"run": run}
        try:
            run_log["commands"] = robot_client.get_run_commands(ip, run_id)
        except Exception:
            run_log["commands"] = None
        zf.writestr("run_log.json", json.dumps(run_log, indent=2))

        # 3. Protocol file (main Python/source) when available
        protocol_id = run.get("protocolId") if isinstance(run.get("protocolId"), str) else None
        if protocol_id:
            main_file_name: str | None = None
            try:
                protocol_response = robot_client.get_protocol(ip, protocol_id)
                protocol_meta = protocol_response.get("data") if isinstance(protocol_response, dict) else protocol_response
                if isinstance(protocol_meta, dict):
                    files = protocol_meta.get("files") or []
                    for f in files:
                        if isinstance(f, dict) and f.get("role") == "main":
                            main_file_name = f.get("name") if isinstance(f.get("name"), str) else None
                            break
                    if not main_file_name and files:
                        first = files[0]
                        if isinstance(first, dict) and first.get("name"):
                            main_file_name = first["name"]
            except Exception:
                pass
            if main_file_name:
                raw = robot_client.get_protocol_file(ip, protocol_id, main_file_name)
                if raw is not None:
                    content = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
                    zf.writestr(f"protocol/{main_file_name}", content)

        # 4. All log files under logs/
        for log_id in LOG_IDENTIFIERS:
            content = robot_client.get_log_file(ip, log_id)
            if content:
                zf.writestr(f"logs/{log_id}", content)
    return buf.getvalue()


@app.get("/api/robots/{ip}/troubleshooting.zip")
def get_robot_troubleshooting_zip(
    ip: str,
    runId: str | None = Query(None, alias="runId"),
) -> Response:
    """Build and return troubleshooting.zip for the robot (optional runId query for specific run).

    Zip contains ERROR_SUMMARY.txt, run_log.json, protocol file if available, and logs/.
    If runId is omitted, uses current or latest run with errors from GET /runs.
    """
    validate_ip(ip)
    try:
        if runId:
            try:
                run_response = robot_client.get_run(ip, runId)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    raise robot_http_error("Run not found", "RUN_NOT_FOUND", 404)
                raise
            run = run_response.get("data") if isinstance(run_response, dict) else run_response
            if not isinstance(run, dict):
                raise robot_http_error("Run not found", "NOT_FOUND", 404)
        else:
            runs_response = robot_client.get_runs(ip)
            run = _run_from_list(runs_response)
            if not run:
                raise robot_http_error("No runs available", "NO_RUNS", 404)
        zip_bytes = _build_troubleshooting_zip(ip, run)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=troubleshooting.zip"},
        )
    except HTTPException:
        raise
    except httpx.ConnectError as e:
        raise robot_http_error(str(e) or "Connection refused", "ROBOT_UNREACHABLE")
    except httpx.TimeoutException as e:
        raise robot_http_error(str(e) or "Request timed out", "TIMEOUT")
    except Exception as e:
        raise robot_http_error(str(e), "ROBOT_ERROR")