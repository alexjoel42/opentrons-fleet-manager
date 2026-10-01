"""Compact, persistent run archive (SQLite) so run history survives robot resets.

Stores one row per ``(robot_ip, run_id)`` with protocol name, timestamps, wall-clock
duration, error summaries, and run notes. Command logs and protocol source are not stored.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

_log = logging.getLogger(__name__)

ARCHIVE_INTERVAL = timedelta(hours=24)
LAST_SUCCESS_KEY = "last_success_at"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS archived_runs (
    robot_ip TEXT NOT NULL,
    run_id TEXT NOT NULL,
    robot_name TEXT,
    robot_serial TEXT,
    status TEXT,
    created_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    protocol_id TEXT,
    protocol_file_name TEXT,
    errors_json TEXT,
    inline_note TEXT,
    detail_note TEXT,
    first_archived_at TEXT NOT NULL,
    last_archived_at TEXT NOT NULL,
    PRIMARY KEY (robot_ip, run_id)
);
CREATE TABLE IF NOT EXISTS archive_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

# Columns refreshed from the robot on every pass; NULL never replaces an existing value
# so data survives once the robot stops reporting it.
_RUN_COLUMNS = (
    "robot_name",
    "robot_serial",
    "status",
    "created_at",
    "started_at",
    "completed_at",
    "duration_ms",
    "protocol_id",
    "protocol_file_name",
    "errors_json",
    "inline_note",
    "detail_note",
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _str_or_none(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def wall_clock_duration_ms(started_at: Any, completed_at: Any) -> int | None:
    a, b = _parse_iso(started_at), _parse_iso(completed_at)
    if a is None or b is None or b < a:
        return None
    return int((b - a).total_seconds() * 1000)


def error_summaries(run: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    errors = run.get("errors")
    if not isinstance(errors, list):
        return out
    for err in errors:
        if not isinstance(err, dict):
            continue
        entry = {
            k: str(err[k]).strip()
            for k in ("errorCode", "errorType", "detail")
            if err.get(k) is not None and str(err[k]).strip()
        }
        if entry:
            out.append(entry)
    return out


def run_to_record(
    run: dict[str, Any],
    protocol_file_name: str | None,
    notes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Map an Opentrons run payload (plus local notes) to archive columns."""
    errors = error_summaries(run)
    notes = notes or {}

    def _note(slot: str) -> str | None:
        chunk = notes.get(slot)
        return _str_or_none(chunk.get("body")) if isinstance(chunk, dict) else None

    return {
        "run_id": str(run.get("id") or "").strip(),
        "status": _str_or_none(run.get("status")),
        "created_at": _str_or_none(run.get("createdAt")),
        "started_at": _str_or_none(run.get("startedAt")),
        "completed_at": _str_or_none(run.get("completedAt")),
        "duration_ms": wall_clock_duration_ms(run.get("startedAt"), run.get("completedAt")),
        "protocol_id": _str_or_none(run.get("protocolId")),
        "protocol_file_name": _str_or_none(protocol_file_name),
        "errors_json": json.dumps(errors) if errors else None,
        "inline_note": _note("inline"),
        "detail_note": _note("detail"),
    }


class RunArchive:
    """Thread-safe SQLite store. Opens a short-lived connection per operation."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self._lock = threading.Lock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def get_meta(self, key: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM archive_meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO archive_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def known_protocol_names(self, robot_ip: str) -> dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT run_id, protocol_file_name FROM archived_runs "
                "WHERE robot_ip = ? AND protocol_file_name IS NOT NULL",
                (robot_ip,),
            ).fetchall()
        return {r["run_id"]: r["protocol_file_name"] for r in rows}

    def upsert_runs(
        self,
        robot_ip: str,
        records: list[dict[str, Any]],
        robot_name: str | None = None,
        robot_serial: str | None = None,
    ) -> int:
        now = utc_now().isoformat()
        cols = ", ".join(_RUN_COLUMNS)
        placeholders = ", ".join("?" for _ in _RUN_COLUMNS)
        updates = ", ".join(f"{c} = COALESCE(excluded.{c}, {c})" for c in _RUN_COLUMNS)
        sql = (
            f"INSERT INTO archived_runs (robot_ip, run_id, {cols}, first_archived_at, last_archived_at) "
            f"VALUES (?, ?, {placeholders}, ?, ?) "
            f"ON CONFLICT(robot_ip, run_id) DO UPDATE SET {updates}, "
            "last_archived_at = excluded.last_archived_at"
        )
        rows = []
        for rec in records:
            run_id = rec.get("run_id")
            if not run_id:
                continue
            merged = {**rec, "robot_name": robot_name, "robot_serial": robot_serial}
            rows.append((robot_ip, run_id, *(merged.get(c) for c in _RUN_COLUMNS), now, now))
        if not rows:
            return 0
        with self._lock, self._connect() as conn:
            conn.executemany(sql, rows)
        return len(rows)

    def upsert_note(self, robot_ip: str, run_id: str, slot: str, body: str | None) -> None:
        """Record a saved note immediately. Empty bodies keep the last archived note for audit."""
        if slot not in ("inline", "detail") or not _str_or_none(body):
            return
        self.upsert_runs(robot_ip, [{"run_id": run_id, f"{slot}_note": body.strip()}])

    def list_runs(self, robot_ip: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM archived_runs WHERE robot_ip = ? "
                "ORDER BY COALESCE(started_at, created_at, first_archived_at) DESC",
                (robot_ip,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            raw_errors = item.pop("errors_json", None)
            try:
                item["errors"] = json.loads(raw_errors) if raw_errors else []
            except json.JSONDecodeError:
                item["errors"] = []
            out.append(item)
        return out


def is_archive_due(last_success_iso: str | None, now: datetime | None = None) -> bool:
    last = _parse_iso(last_success_iso)
    if last is None:
        return True
    return (now or utc_now()) - last >= ARCHIVE_INTERVAL


def archive_robot(
    archive: RunArchive,
    ip: str,
    *,
    fetch_health: Callable[[str], dict[str, Any]],
    fetch_runs: Callable[[str], Any],
    resolve_protocol_name: Callable[[str, dict[str, Any]], str | None],
    notes_by_run: dict[str, Any],
) -> int:
    """Archive every run the robot currently reports. Raises if the robot is unreachable."""
    health = fetch_health(ip)
    runs_payload = fetch_runs(ip)
    runs = runs_payload.get("data") if isinstance(runs_payload, dict) else None
    if not isinstance(runs, list):
        runs = []
    known = archive.known_protocol_names(ip)
    records: list[dict[str, Any]] = []
    for run in runs:
        if not isinstance(run, dict) or not run.get("id"):
            continue
        run_id = str(run["id"])
        name = known.get(run_id)
        if name is None:
            try:
                name = resolve_protocol_name(ip, run)
            except Exception as exc:
                _log.warning("Protocol name lookup failed for %s run %s: %s", ip, run_id, exc)
        records.append(run_to_record(run, name, notes_by_run.get(run_id)))
    return archive.upsert_runs(
        ip,
        records,
        robot_name=_str_or_none(health.get("name")),
        robot_serial=_str_or_none(health.get("serial_number")),
    )


def archive_fleet(
    archive: RunArchive,
    ips: list[str],
    *,
    fetch_health: Callable[[str], dict[str, Any]],
    fetch_runs: Callable[[str], Any],
    resolve_protocol_name: Callable[[str, dict[str, Any]], str | None],
    run_notes: dict[str, dict[str, Any]],
    max_workers: int = 8,
) -> dict[str, Any]:
    """One archive pass over the fleet. Offline robots are reported, not fatal.

    The pass counts as successful (and resets the daily clock) when at least one robot
    was reached, or when the fleet is empty.
    """

    def _one(ip: str) -> tuple[str, int | None, str | None]:
        try:
            count = archive_robot(
                archive,
                ip,
                fetch_health=fetch_health,
                fetch_runs=fetch_runs,
                resolve_protocol_name=resolve_protocol_name,
                notes_by_run=run_notes.get(ip) or {},
            )
            return ip, count, None
        except Exception as exc:
            _log.warning("Run archive skipped %s: %s", ip, exc)
            return ip, None, str(exc) or exc.__class__.__name__

    archived: dict[str, int] = {}
    errors: dict[str, str] = {}
    if ips:
        with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(ips)))) as pool:
            for ip, count, err in pool.map(_one, ips):
                if err is not None:
                    errors[ip] = err
                else:
                    archived[ip] = count or 0
    finished_at = utc_now().isoformat()
    succeeded = bool(archived) or not ips
    if succeeded:
        archive.set_meta(LAST_SUCCESS_KEY, finished_at)
    return {"archived": archived, "errors": errors, "finished_at": finished_at, "succeeded": succeeded}
