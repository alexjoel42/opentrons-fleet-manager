"""Tests for protocol and runtime-parameter files in the troubleshooting zip.

Run from backend/: ``python -m unittest test_troubleshooting_zip``
"""

from __future__ import annotations

import io
import unittest
import zipfile
from unittest.mock import patch

import httpx

from demo_api import (
    BaseRobot,
    _build_troubleshooting_zip,
    _files_from_run_download,
    _runtime_parameter_lines,
)


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


class RunDownloadTests(unittest.TestCase):
    def test_files_are_basenames_only(self) -> None:
        blob = _zip_bytes({
            "nested/assay.py": b"print(1)\n",
            "inputs/samples.csv": b"Well,Vol\nA1,1\n",
            "folder/": b"",
        })
        files = dict(_files_from_run_download(blob))
        self.assertEqual(set(files), {"assay.py", "samples.csv"})
        self.assertEqual(files["assay.py"], b"print(1)\n")

    def test_bad_zip_returns_empty(self) -> None:
        self.assertEqual(_files_from_run_download(b"not a zip"), [])

    def test_runtime_parameters_show_chosen_value_and_csv_id(self) -> None:
        lines = _runtime_parameter_lines({
            "runTimeParameters": [
                {"variableName": "num_samples", "type": "int", "value": 48, "default": 96},
                {
                    "variableName": "parameters_csv",
                    "type": "csv_file",
                    "file": {"id": "file-1", "name": "samples.csv"},
                },
                {"variableName": "waste_chute", "type": "bool", "value": False, "default": False},
            ]
        })
        self.assertIn("  num_samples (int): 48 (default 96)", lines)
        self.assertIn("  parameters_csv (csv_file): samples.csv (id file-1)", lines)
        self.assertIn("  waste_chute (bool): false", lines)
        self.assertNotIn("default false", lines[2])

    def test_runtime_parameters_missing(self) -> None:
        self.assertEqual(_runtime_parameter_lines({}), ["  None"])

    def test_get_run_download_requests_opt_in_flags(self) -> None:
        blob = _zip_bytes({"assay.py": b"x"})
        response = httpx.Response(200, content=blob)
        with patch("demo_api.httpx.get", return_value=response) as get:
            result = BaseRobot().get_run_download(
                "10.0.0.5",
                "run-1",
                protocol=True,
                csv_input=True,
                csv_output=True,
            )
        self.assertEqual(result, blob)
        args, kwargs = get.call_args
        self.assertEqual(
            kwargs["params"],
            {"protocol": "true", "csvInput": "true", "csvOutput": "true"},
        )
        self.assertTrue(args[0].endswith("/runs/run-1/download"))

    def test_troubleshooting_zip_includes_protocol_and_runtime_values(self) -> None:
        blob = _zip_bytes({"assay.py": b"defaults stay in the file\n", "samples.csv": b"a,b\n"})
        run = {
            "id": "run-1",
            "pipettes": [{"pipetteName": "p50", "mount": "left", "serialNumber": "P1"}],
            "modules": [],
            "errors": [],
            "runTimeParameters": [
                {"variableName": "num_samples", "type": "int", "value": 48, "default": 96},
            ],
        }
        with patch("demo_api.robot_client") as client:
            client.get_run_download.return_value = blob
            client.get_serial_number.return_value = "SER"
            client.get_run_commands.return_value = []
            client.get_log_file.return_value = None
            out = _build_troubleshooting_zip("10.0.0.5", run)
        with zipfile.ZipFile(io.BytesIO(out)) as zf:
            self.assertEqual(zf.read("protocol/assay.py"), b"defaults stay in the file\n")
            self.assertEqual(zf.read("protocol/samples.csv"), b"a,b\n")
            summary = zf.read("ERROR_SUMMARY.txt").decode()
        self.assertIn("num_samples (int): 48 (default 96)", summary)
        self.assertIn("protocol/samples.csv", summary)
        kwargs = client.get_run_download.call_args.kwargs
        self.assertTrue(kwargs["protocol"])
        self.assertTrue(kwargs["csv_input"])
        self.assertTrue(kwargs["csv_output"])

    def test_get_run_download_204_is_empty(self) -> None:
        response = httpx.Response(204, content=b"")
        with patch("demo_api.httpx.get", return_value=response):
            result = BaseRobot().get_run_download("10.0.0.5", "run-1", csv_output=True)
        self.assertIsNone(result)
