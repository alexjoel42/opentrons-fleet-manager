"""Demo backend API for Opentrons fleet observability.

This module provides:
- BaseRobot: A synchronous HTTP client for querying Opentrons robots (health, logs,
  pipettes, modules, runs, protocols) via the Opentrons HTTP API.
- FastAPI application with REST endpoints for:
  - Health check and database status
  - Agent telemetry ingestion (lab/robot/snapshot)
  - Auth (signup, login) and labs (CRUD, tokens)
  - Cloud-style robot listing (from DB)
  - Local robot IP store and proxy endpoints (health, modules, pipettes, logs,
    runs, protocol, troubleshooting zip) that forward requests to robots by IP.
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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    ) -> httpx.Response:
        """Perform a GET request to the robot.

        Args:
            ip_address: Robot IP or hostname.
            path: API path (e.g. "health", "runs").
            scheme: Optional 'http' or 'https'.
            port: Optional port override.

        Returns:
            httpx.Response from the robot. Caller should call raise_for_status() or
            handle httpx.HTTPStatusError, ConnectError, TimeoutException as needed.
        """
        url = self._url(ip_address, path, scheme=scheme, port=port)
        return httpx.get(url, headers=self._headers, timeout=self.timeout)

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: initialize DB on startup if DATABASE_URL is set; close DB on shutdown."""
    try:
        from db import is_db_configured, init_db
        if is_db_configured():
            await init_db()
    except Exception:
        pass
    yield
    try:
        from db import close_db
        await close_db()
    except Exception:
        pass


app = FastAPI(lifespan=lifespan)


def _cors_allow_origins() -> list[str]:
    """Comma-separated `CORS_ORIGINS` env (e.g. https://app.vercel.app); default `*` for dev."""
    raw = (os.environ.get("CORS_ORIGINS") or "").strip()
    if not raw:
        return ["*"]
    out = [o.strip() for o in raw.split(",") if o.strip()]
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
    """Health check endpoint. Returns status and database connectivity when DATABASE_URL is set."""
    out: dict[str, Any] = {"status": "ok"}
    try:
        from db import is_db_configured, check_db_connected
        if is_db_configured():
            out["database"] = "connected" if await check_db_connected() else "disconnected"
        else:
            out["database"] = "not_configured"
    except Exception:
        out["database"] = "not_configured"
    return out


async def get_agent_db_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async DB session for agent and auth endpoints.

    Yields:
        AsyncSession: SQLAlchemy async session. Commits on success, rolls back on error.

    Raises:
        HTTPException: 503 if DATABASE_URL is not configured.
    """
    from db import get_async_session_factory, is_db_configured
    if not is_db_configured():
        raise HTTPException(status_code=503, detail="Database not configured")
    factory = get_async_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@app.post("/api/agent/telemetry")
async def post_agent_telemetry(
    request: Request,
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
):
    """Ingest telemetry from the local observability agent.

    Requires Authorization: Bearer <agent_token> (lab token). Creates or updates
    robots and their TelemetrySnapshot from the payload.

    Request body:
        lab_id: Optional. robots: List of dicts with ip, serial/robot_id, health, runs, logs.

    Returns:
        {"ok": True, "lab_id": <lab_id>}.
    """
    from datetime import datetime, timezone
    from agent_auth import verify_agent_token
    from models import Robot, TelemetrySnapshot

    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = auth[7:].strip()
    lab = await verify_agent_token(db, token)

    robots_payload = body.get("robots")
    if not isinstance(robots_payload, list):
        raise HTTPException(status_code=400, detail="Missing or invalid 'robots' array")

    now = datetime.now(timezone.utc)
    for r in robots_payload:
        if not isinstance(r, dict):
            continue
        ip = (r.get("ip") or "").strip() or None
        serial = (r.get("robot_id") or r.get("serial") or "").strip() or None
        health = r.get("health") if isinstance(r.get("health"), dict) else None
        runs = r.get("runs")
        if not isinstance(runs, (list, dict)):
            runs = None
        logs = r.get("logs")
        if logs is not None and not isinstance(logs, str):
            logs = str(logs) if logs else None
        if not ip and not serial:
            continue

        stmt = select(Robot).where(Robot.lab_id == lab.id)
        if serial:
            stmt = stmt.where(Robot.robot_serial == serial)
        else:
            stmt = stmt.where(Robot.ip_last_seen == ip)
        stmt = stmt.limit(1)
        result = await db.execute(stmt)
        robot = result.scalar_one_or_none()
        if not robot:
            robot = Robot(
                lab_id=lab.id,
                name=serial or ip,
                robot_serial=serial,
                ip_last_seen=ip,
                last_seen_at=now,
            )
            db.add(robot)
            await db.flush()
        else:
            robot.last_seen_at = now
            robot.ip_last_seen = ip or robot.ip_last_seen
            if serial:
                robot.robot_serial = serial

        snap = await db.get(TelemetrySnapshot, robot.id)
        if not snap:
            snap = TelemetrySnapshot(robot_id=robot.id)
            db.add(snap)
        snap.health_json = health
        snap.last_run_summary_json = runs if isinstance(runs, dict) else ({"data": runs} if isinstance(runs, list) else None)
        snap.log_tail_text = (logs[:65535] if logs else None)
        snap.updated_at = now

    return {"ok": True, "lab_id": lab.id}


@app.get("/api/agent/robot-poll-targets")
async def get_agent_robot_poll_targets(
    request: Request,
    db: AsyncSession = Depends(get_agent_db_session),
):
    """Return robot addresses the relay agent should poll for this lab (configured in the cloud app).

    Same Authorization as telemetry: Bearer lab agent token. The agent should use this list
    instead of local config for production deployments.
    """
    from agent_auth import verify_agent_token

    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = auth[7:].strip()
    lab = await verify_agent_token(db, token)
    targets = lab.robot_poll_targets
    if targets is None:
        targets = []
    return {"lab_id": lab.id, "robots": targets}


def _normalize_robot_poll_targets(raw: Any) -> list[dict[str, Any]]:
    """Validate request body robots list for lab.robot_poll_targets."""
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="robots must be a list")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="each robot must be an object with ip, scheme, port")
        ip = (item.get("ip") or "").strip()
        if not _is_valid_robot_address(ip):
            raise HTTPException(status_code=400, detail=f"Invalid robot address: {ip!r}")
        scheme = (item.get("scheme") or "http").lower()
        if scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail=f"scheme must be http or https for {ip!r}")
        port = item.get("port", DEFAULT_PORT)
        try:
            port_int = int(port)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid port for {ip!r}")
        if not 1 <= port_int <= 65535:
            raise HTTPException(status_code=400, detail=f"Invalid port for {ip!r}")
        out.append({"ip": ip, "scheme": scheme, "port": port_int})
    return out


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_agent_db_session),
):
    """FastAPI dependency: require valid JWT in Authorization: Bearer <token> and return User.

    Returns:
        User model instance for the authenticated user.

    Raises:
        HTTPException: 401 if header missing, token invalid/expired, or user not found.
    """
    from auth import decode_access_token, get_user_by_id
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = auth[7:].strip()
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@app.post("/api/auth/signup")
async def auth_signup(
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
):
    """Create a new user account. Body must include email and password.

    Returns:
        {"access_token": "<jwt>", "token_type": "bearer"}.

    Raises:
        HTTPException: 400 if email/password missing or email already registered.
    """
    from auth import create_access_token, get_user_by_email, hash_password
    from models import User
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password required")
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    await db.flush()
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


@app.post("/api/auth/login")
async def auth_login(
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
):
    """Authenticate user and return a JWT. Body must include email and password.

    Returns:
        {"access_token": "<jwt>", "token_type": "bearer"}.

    Raises:
        HTTPException: 400 if email/password missing; 401 if credentials invalid.
    """
    from auth import create_access_token, get_user_by_email, verify_password
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password required")
    user = await get_user_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/labs")
async def list_labs(
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """List all labs owned by the current user. Requires JWT auth."""
    from models import Lab
    result = await db.execute(
        select(Lab).where(Lab.owner_id == user.id).order_by(Lab.created_at)
    )
    labs = result.scalars().all()
    return [{"id": lab.id, "name": lab.name, "created_at": lab.created_at.isoformat() if lab.created_at else None} for lab in labs]


@app.post("/api/labs")
async def create_lab(
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """Create a new lab. Body may include "name" (default "Unnamed Lab"). Owner is current user."""
    from models import Lab
    name = (body.get("name") or "").strip() or "Unnamed Lab"
    lab = Lab(name=name, owner_id=user.id)
    db.add(lab)
    await db.flush()
    return {"id": lab.id, "name": lab.name, "created_at": lab.created_at.isoformat() if lab.created_at else None}


@app.get("/api/labs/{lab_id}")
async def get_lab(
    lab_id: str,
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """Get a single lab by ID. Caller must be the lab owner."""
    from models import Lab
    lab = await db.get(Lab, lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Lab not found")
    return {"id": lab.id, "name": lab.name, "created_at": lab.created_at.isoformat() if lab.created_at else None}


@app.get("/api/labs/{lab_id}/robot-poll-targets")
async def get_lab_robot_poll_targets(
    lab_id: str,
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """List robot addresses the relay agent should poll for this lab (managed in the cloud UI)."""
    from models import Lab

    lab = await db.get(Lab, lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Lab not found")
    targets = lab.robot_poll_targets
    if targets is None:
        targets = []
    return {"robots": targets}


@app.put("/api/labs/{lab_id}/robot-poll-targets")
async def put_lab_robot_poll_targets(
    lab_id: str,
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """Replace robot poll targets for the lab. Body: {\"robots\": [{\"ip\",\"scheme\",\"port\"}, ...]}."""
    from models import Lab

    lab = await db.get(Lab, lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Lab not found")
    raw = body.get("robots")
    if raw is None:
        raise HTTPException(status_code=400, detail="missing robots")
    normalized = _normalize_robot_poll_targets(raw)
    lab.robot_poll_targets = normalized
    await db.flush()
    return {"robots": normalized}


@app.post("/api/labs/{lab_id}/tokens")
async def create_lab_token(
    lab_id: str,
    body: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """Generate a new agent token for the lab. Lab owner only. Plain token is returned once (not stored)."""
    import secrets
    from agent_auth import hash_agent_token
    from models import Lab, LabAgentToken
    lab = await db.get(Lab, lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Lab not found")
    token_plain = secrets.token_urlsafe(32)
    token_hash = hash_agent_token(token_plain)
    db.add(LabAgentToken(lab_id=lab.id, token_hash=token_hash, label=body.get("label")))
    await db.flush()
    return {"token": token_plain, "lab_id": lab_id}


@app.get("/api/labs/{lab_id}/robots")
async def list_lab_robots(
    lab_id: str,
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """List all robots in a lab with their latest telemetry. Lab owner only."""
    from models import Lab, Robot, TelemetrySnapshot
    lab = await db.get(Lab, lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Lab not found")
    result = await db.execute(
        select(Robot, TelemetrySnapshot)
        .outerjoin(TelemetrySnapshot, Robot.id == TelemetrySnapshot.robot_id)
        .where(Robot.lab_id == lab_id)
    )
    rows = result.all()
    out = []
    for robot, snap in rows:
        out.append({
            "id": robot.id,
            "lab_id": robot.lab_id,
            "name": robot.name,
            "robot_serial": robot.robot_serial,
            "ip_last_seen": robot.ip_last_seen,
            "last_seen_at": robot.last_seen_at.isoformat() if robot.last_seen_at else None,
            "health": snap.health_json if snap else None,
            "runs": snap.last_run_summary_json if snap else None,
            "logs": (snap.log_tail_text[:2000] if snap and snap.log_tail_text else None),
        })
    return out


@app.get("/api/cloud/robots")
async def list_robots_cloud(
    lab_id: str | None = Query(None),
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """List robots from the database (user's labs only). Optional query param lab_id to filter by lab."""
    from models import Lab, Robot, TelemetrySnapshot
    stmt = select(Robot, TelemetrySnapshot).outerjoin(
        TelemetrySnapshot, Robot.id == TelemetrySnapshot.robot_id
    ).join(Lab, Robot.lab_id == Lab.id).where(Lab.owner_id == user.id)
    if lab_id:
        stmt = stmt.where(Robot.lab_id == lab_id)
    stmt = stmt.order_by(Robot.last_seen_at.desc().nullslast())
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            "id": r.id,
            "lab_id": r.lab_id,
            "name": r.name,
            "robot_serial": r.robot_serial,
            "ip_last_seen": r.ip_last_seen,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            "health": s.health_json if s else None,
            "runs": s.last_run_summary_json if s else None,
            "logs": (s.log_tail_text[:2000] if s and s.log_tail_text else None),
        }
        for r, s in rows
    ]


@app.get("/api/cloud/robots/{robot_id}")
async def get_robot_cloud(
    robot_id: str,
    db: AsyncSession = Depends(get_agent_db_session),
    user: Any = Depends(get_current_user),
):
    """Get a single robot by ID including health, runs, and logs. Robot must belong to a lab owned by the user."""
    from models import Lab, Robot, TelemetrySnapshot
    robot = await db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")
    lab = await db.get(Lab, robot.lab_id)
    if not lab or lab.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Robot not found")
    snap = await db.get(TelemetrySnapshot, robot_id)
    return {
        "id": robot.id,
        "lab_id": robot.lab_id,
        "name": robot.name,
        "robot_serial": robot.robot_serial,
        "ip_last_seen": robot.ip_last_seen,
        "last_seen_at": robot.last_seen_at.isoformat() if robot.last_seen_at else None,
        "created_at": robot.created_at.isoformat() if robot.created_at else None,
        "health": snap.health_json if snap else None,
        "runs": snap.last_run_summary_json if snap else None,
        "logs": snap.log_tail_text if snap else None,
    }


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
# Lock for thread-safe read/write of robot_ips.json.
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


@app.get("/api/robots")
def list_robots() -> dict[str, list[str]]:
    """Return configured robot IPs from the store (seeded from ROBOT_IPS env on first load if empty)."""
    return {"ips": _load_robot_ips()}


@app.get("/api/fleet/snapshot")
async def fleet_snapshot() -> dict[str, Any]:
    """Batch health, modules, pipettes, and runs for all configured robots in one request.

    Uses bounded concurrency to avoid unbounded parallel connections. Per-robot entries
    may include null fields when a sub-request fails; ``errors`` maps IP to a message when
    health could not be retrieved (typically unreachable).
    """
    ips = _load_robot_ips()
    if not ips:
        return {"robots": {}, "errors": {}}
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
    return {"robots": robots, "errors": errors}


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
    with _store_lock:
        ips = [x for x in _load_robot_ips() if x != ip.strip()]
        _save_robot_ips(ips)
    return {"ips": ips}


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