"""Tests for run_archive. Run from backend/: ``python -m unittest test_run_archive``."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from run_archive import (
    LAST_SUCCESS_KEY,
    RunArchive,
    archive_fleet,
    is_archive_due,
    run_to_record,
)

RUN_A = {
    "id": "run-a",
    "status": "failed",
    "createdAt": "2026-09-30T13:00:00.000000+00:00",
    "startedAt": "2026-09-30T13:01:00.000000+00:00",
    "completedAt": "2026-09-30T14:31:30.000000+00:00",
    "protocolId": "proto-1",
    "errors": [{"errorCode": "4000", "errorType": "GeneralError", "detail": "Tip not detected"}],
}
RUN_B = {"id": "run-b", "status": "running", "startedAt": "2026-10-01T09:00:00Z", "protocolId": "proto-2"}


class RunArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.archive = RunArchive(Path(self._tmp.name) / "archive.db")
        self.lookups: list[str] = []

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _resolve(self, _ip: str, run: dict[str, Any]) -> str | None:
        self.lookups.append(run["id"])
        return {"proto-1": "Normalize.py", "proto-2": "PCR Setup.py"}.get(run.get("protocolId"))

    def _sync(self, ips: list[str], runs_by_ip: dict[str, list[dict[str, Any]]], notes: dict | None = None):
        def fetch_health(ip: str) -> dict[str, Any]:
            if ip not in runs_by_ip:
                raise httpx.ConnectError("Connection refused")
            return {"name": f"ABR-{ip[-1]}", "serial_number": f"SN{ip[-1]}"}

        return archive_fleet(
            self.archive,
            ips,
            fetch_health=fetch_health,
            fetch_runs=lambda ip: {"data": runs_by_ip[ip]},
            resolve_protocol_name=self._resolve,
            run_notes=notes or {},
        )

    def test_run_to_record_maps_fields(self) -> None:
        rec = run_to_record(RUN_A, "Normalize.py", {"detail": {"body": "Swapped tip rack"}})
        self.assertEqual(rec["duration_ms"], 90 * 60 * 1000 + 30 * 1000)
        self.assertEqual(rec["protocol_file_name"], "Normalize.py")
        self.assertEqual(rec["detail_note"], "Swapped tip rack")
        self.assertIsNone(rec["inline_note"])
        self.assertIn("Tip not detected", rec["errors_json"])

    def test_sync_stores_runs_and_is_idempotent(self) -> None:
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_A, RUN_B]})
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_A, RUN_B]})
        runs = self.archive.list_runs("10.0.0.1")
        self.assertEqual([r["run_id"] for r in runs], ["run-b", "run-a"])
        a = runs[1]
        self.assertEqual(a["protocol_file_name"], "Normalize.py")
        self.assertEqual(a["robot_name"], "ABR-1")
        self.assertEqual(a["errors"][0]["errorCode"], "4000")
        self.assertEqual(self.lookups.count("run-a"), 1, "protocol name should be resolved once")

    def test_unfinished_run_updates_and_data_survives_reset(self) -> None:
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_B]})
        finished = {**RUN_B, "status": "succeeded", "completedAt": "2026-10-01T10:00:00Z"}
        self._sync(["10.0.0.1"], {"10.0.0.1": [finished]})
        self._sync(["10.0.0.1"], {"10.0.0.1": []})  # robot reset: no runs reported
        (b,) = self.archive.list_runs("10.0.0.1")
        self.assertEqual(b["status"], "succeeded")
        self.assertEqual(b["duration_ms"], 3600 * 1000)
        self.assertEqual(b["protocol_file_name"], "PCR Setup.py")

    def test_notes_preserved_and_not_blanked(self) -> None:
        notes = {"10.0.0.1": {"run-a": {"inline": {"body": "check pipette"}}}}
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_A]}, notes)
        self.archive.upsert_note("10.0.0.1", "run-a", "detail", "Long context")
        self.archive.upsert_note("10.0.0.1", "run-a", "inline", "")
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_A]}, {})
        (a,) = self.archive.list_runs("10.0.0.1")
        self.assertEqual(a["inline_note"], "check pipette")
        self.assertEqual(a["detail_note"], "Long context")

    def test_offline_robot_does_not_block_fleet(self) -> None:
        result = self._sync(["10.0.0.1", "10.0.0.2"], {"10.0.0.1": [RUN_A]})
        self.assertEqual(result["archived"], {"10.0.0.1": 1})
        self.assertIn("10.0.0.2", result["errors"])
        self.assertTrue(result["succeeded"])
        self.assertIsNotNone(self.archive.get_meta(LAST_SUCCESS_KEY))

    def test_all_offline_does_not_reset_daily_clock(self) -> None:
        result = self._sync(["10.0.0.2"], {})
        self.assertFalse(result["succeeded"])
        self.assertIsNone(self.archive.get_meta(LAST_SUCCESS_KEY))

    def test_archive_survives_new_store_instance(self) -> None:
        self._sync(["10.0.0.1"], {"10.0.0.1": [RUN_A]})
        reopened = RunArchive(self.archive.db_path)
        self.assertEqual(len(reopened.list_runs("10.0.0.1")), 1)

    def test_is_archive_due(self) -> None:
        now = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
        self.assertTrue(is_archive_due(None, now))
        self.assertFalse(is_archive_due((now - timedelta(hours=23)).isoformat(), now))
        self.assertTrue(is_archive_due((now - timedelta(hours=24)).isoformat(), now))


if __name__ == "__main__":
    unittest.main()
