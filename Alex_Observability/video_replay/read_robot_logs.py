"""ABR Read Robot Logs.

This library has functions to download logs from robots, extracting wanted information,
and uploading to a google sheet using credentials and google_sheets_tools module
saved in a local directory.
"""
import csv
import subprocess
from datetime import datetime
import os
from typing import List, Dict, Any, Tuple, Optional
import time as t
import json
import requests
from pathlib import Path
import zipfile
import websocket  # type: ignore[import-untyped,import-not-found]


def _ensure_ssh_key_permissions(key_path: Path) -> None:
    """OpenSSH refuses private keys readable by group or others."""
    if key_path.is_file():
        key_path.chmod(0o600)


def save_run_log_to_json(
    ip: str, results: Dict[str, Any], storage_directory: Path
) -> str:
    """Save run log to local json file."""
    data_file_name = "run_log.json"
    saved_file_path = os.path.join(storage_directory, data_file_name)
    with open(saved_file_path, mode="w") as f:
        json.dump(results, f, indent=2)
    return saved_file_path


def get_calibration_offsets(
    ip: str,
    storage_directory: Path,
    collected_files: Optional[List[str]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Connect to robot via IP and get calibration data."""
    if collected_files is None:
        collected_files = []
    calibration = dict()
    # Robot Information [Name, Software Version]
    try:
        response = requests.get(
            f"http://{ip}:31950/health",
            headers={"opentrons-version": "*"},
            timeout=10,
        )
        response.raise_for_status()
        #print(f"Connected to {ip}")
        health_data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Failed to fetch calibration data (HTTP unavailable): {e}")
        return "", {}
    robot_name = health_data.get("name", "")
    api_version = health_data.get("api_version", "")
    pull_date_timestamp = datetime.now()
    date = pull_date_timestamp.date().isoformat()
    file_date = str(pull_date_timestamp).replace(":", "").split(".")[0]
    calibration["Robot"] = robot_name
    calibration["Software Version"] = api_version
    calibration["Pull Date"] = date
    calibration["Pull Timestamp"] = pull_date_timestamp.isoformat()
    calibration["run_id"] = "calibration" + "_" + file_date
    # Calibration [Instruments, modules, deck]
    try:
        response = requests.get(
            f"http://{ip}:31950/instruments",
            headers={"opentrons-version": "*"},
            params={"cursor": 0, "pageLength": 0},
            timeout=10,
        )
        response.raise_for_status()
        instruments: Dict[str, Any] = response.json()
        calibration["Instruments"] = instruments.get("data", "")
        response = requests.get(
            f"http://{ip}:31950/modules",
            headers={"opentrons-version": "*"},
            params={"cursor": 0, "pageLength": 0},
            timeout=10,
        )
        response.raise_for_status()
        modules: Dict[str, Any] = response.json()
        calibration["Modules"] = modules.get("data", "")
        response = requests.get(
            f"http://{ip}:31950/calibration/status",
            headers={"opentrons-version": "*"},
            params={"cursor": 0, "pageLength": 0},
            timeout=10,
        )
        response.raise_for_status()
        deck: Dict[str, Any] = response.json()
        calibration["Deck"] = deck.get("deckCalibration", "")
    except requests.exceptions.RequestException as e:
        print(f"Failed to fetch some calibration data (HTTP unavailable): {e}")

    save_name = "calibration.json"
    saved_file_path = os.path.join(storage_directory, save_name)
    with open(saved_file_path, mode="w") as f:
        json.dump(calibration, f, indent=2)
    return str(saved_file_path), calibration


def retrieve_version_file(
    robot_ip: str,
    storage: Path,
) -> Path | str:
    """Retrieve Version file."""
    version_file_path = "/etc/VERSION.json"
    save_dir = Path(f"{str(storage)}")
    key_path = storage / "robot_key"
    _ensure_ssh_key_permissions(key_path)
    command = [
        "scp",
        "-i",
        str(key_path),
        "-o",
        "StrictHostKeyChecking=no",
        "-r",
        f"root@{robot_ip}:{version_file_path}",
        save_dir,
    ]
    try:
        subprocess.run(command, check=True)  # type: ignore
        return os.path.join(save_dir, "VERSION.json")
    except subprocess.CalledProcessError as e:
        print(f"Error during file transfer: {e}")
        return ""


def get_basic_logs(ip: str, storage_directory: Path) -> Tuple[List[str], str, str]:
    """Fetch system HTTP logs and robot health info.

    Returns collected file paths, name, and version.
    """
    log_types: List[Dict[str, Any]] = [
        {"log type": "api.log", "records": 10000},
        {"log type": "server.log", "records": 10000},
        {"log type": "serial.log", "records": 10000},
        {"log type": "touchscreen.log", "records": 10000},
    ]
    collected_files: List[str] = []

    # Grab robot info through HTTP
    try:
        health_resp = requests.get(
            f"http://{ip}:31950/health", headers={"opentrons-version": "*"}
        )
        health_resp.raise_for_status()
        health_data = health_resp.json()
        robot_name = health_data.get("name", "unknown")
        sw_version = health_data.get("api_version", "unknown")
    except Exception as e:
        print(f"Failed to get robot health info: {e}")
        robot_name = "unknown"
        sw_version = "unknown"

    # Grab the system logs via HTTP
    for log_type in log_types:
        try:
            log_type_name: str = log_type["log type"]
            log_records: int = int(log_type["records"])
            response = requests.get(
                f"http://{ip}:31950/logs/{log_type_name}",
                headers={"log_identifier": log_type_name},
                params={"records": log_records},
            )
            response.raise_for_status()
            log_data: str = response.text
            log_name: str = log_type_name
            file_path: str = os.path.join(storage_directory, log_name)

            with open(file_path, mode="w", encoding="utf-8") as f:
                f.write(log_data)

            collected_files.append(file_path)
        except Exception as e:
            print(f"Failed to fetch {log_type['log type']}: {e}")
            continue
    return collected_files, robot_name, sw_version

def get_run_data(one_run: Any, ip: str) -> Dict[str, Any]:
    """Use http requests to get command, health, and protocol data from robot."""
    response = requests.get(
        f"http://{ip}:31950/runs/{one_run}/commands",
        headers={"opentrons-version": "*"},
        params={"cursor": 0, "pageLength": 0},
    )
    data = response.json()
    try:
        command_count = data["meta"]["totalLength"]
    except KeyError:
        command_count = 0
    page_length = 100
    commands = list()
    run = dict()
    for cursor in range(0, command_count, page_length):
        response = requests.get(
            f"http://{ip}:31950/runs/{one_run}/commands",
            headers={"opentrons-version": "*"},
            params={"cursor": cursor, "pageLength": page_length},
        )
        command_data = response.json()
        commands.extend(command_data.get("data", ""))
    run["commands"] = commands
    response = requests.get(
        f"http://{ip}:31950/runs/{one_run}", headers={"opentrons-version": "*"}
    )
    run_meta_data = response.json()
    protocol_id = run_meta_data["data"]["protocolId"]
    run.update(run_meta_data["data"])
    response = requests.get(
        f"http://{ip}:31950/protocols/{protocol_id}", headers={"opentrons-version": "*"}
    )
    protocol_data = response.json()
    run["protocol"] = protocol_data["data"]
    response = requests.get(
        f"http://{ip}:31950/health", headers={"opentrons-version": "*"}
    )
    health_data = response.json()
    run["robot_name"] = health_data.get("name", "")
    run["API_Version"] = health_data.get("api_version", "")
    run["robot_serial"] = health_data.get("robot_serial", "")
    run["run_id"] = one_run

    # Instruments Attached
    response = requests.get(
        f"http://{ip}:31950/instruments", headers={"opentrons-version": "*"}
    )
    instrument_data = response.json()
    for instrument in instrument_data["data"]:
        run[instrument["mount"]] = instrument["serialNumber"]
    return run


def get_logs(storage_directory: Path, ip: str) -> str:
    """Collect Robot logs, organize in a zip file, then return the zip path."""
    collected_files, robot_name, sw_version = get_basic_logs(ip, storage_directory)
    # Collect all nonstandard logs
    collected_files = fetch_weston_log(
        ip, storage_directory, collected_files, robot_name
    )

    calibration_file, _ = get_calibration_offsets(
        ip, storage_directory, collected_files
    )
    if calibration_file:
        collected_files.append(calibration_file)

    collected_files = retreive_odd_console(ip, storage_directory, collected_files)

    version_file_path = retrieve_version_file(ip, storage_directory)
    if version_file_path:
        collected_files.append(str(version_file_path))

    # Get latest run log
    try:
        runs_resp = requests.get(
            f"http://{ip}:31950/runs", headers={"opentrons-version": "*"}, timeout=10
        )
        runs_resp.raise_for_status()
        run_list = runs_resp.json().get("data") or []
        if run_list:
            latest_run_id = run_list[-1]["id"]
            run_results = get_run_data(latest_run_id, ip)
            run_log_path = save_run_log_to_json(ip, run_results, storage_directory)
            if run_log_path:
                collected_files.append(run_log_path)
                #print(f"Run log saved: {run_log_path}")
    except Exception as e:
        print(f"Failed to fetch run log: {e}")

    timestamp = datetime.now().strftime("%Y-%m-%d")

    # Create a ZIP archive with all collected files
    zip_filename: str = os.path.join(
        storage_directory, f"{robot_name}_{timestamp}_{sw_version}_logs.zip"
    )

    with zipfile.ZipFile(zip_filename, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file_path in collected_files:
            arcname: str = os.path.basename(file_path)
            zipf.write(file_path, arcname=arcname)

    for file_path in collected_files:
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"Failed to delete {file_path}: {e}")
    
    print(f"Sucessfully collected {robot_name}'s logs")

    return zip_filename


def fetch_weston_log(
    ip: str, storage_directory: Path, collected_files: list, robot_name: str
) -> list[str]:
    """Get weston log via SSH journalctl, saved with robot name."""
    destination_path = Path(storage_directory) / "weston.log"
    key_path = Path(storage_directory) / "robot_key"
    _ensure_ssh_key_permissions(key_path)

    try:
        result = subprocess.run(
            [
                "ssh",
                "-i",
                str(key_path),
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "BatchMode=yes",
                f"root@{ip}",
                "journalctl",
                "_COMM=weston",
                "--no-pager",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        destination_path.write_text(result.stdout, encoding="utf-8")
        collected_files.append(str(destination_path))
    except subprocess.CalledProcessError as e:
        print(f"Failed to fetch weston log for {robot_name}: {e}")
    except subprocess.TimeoutExpired:
        print(f"Weston log fetch timed out for {robot_name}")

    return collected_files


def retreive_odd_console(
    robot_ip: str, storage_directory: Path, collected_files: list
) -> list:
    """Connect to the ODD through port 9223, collect and save console logs."""
    log_buffer = 3.0
    output_csv = Path(storage_directory) / "odd_console.log"

    # Find the opentrons page target, this is specific to each boot of each robot
    try:
        targets = requests.get(f"http://{robot_ip}:9223/json/list", timeout=5).json()
    except Exception as e:
        print(f"Could not reach port 9223 on {robot_ip}: {e}")
        return collected_files

    target = next(
        (
            t
            for t in targets
            if t.get("type") == "page" and "opentrons" in (t.get("title") or "").lower()
        ),
        None,
    )
    if target is None:
        msg: Any = f"No Opentrons console log target found on {robot_ip}."
        print(msg)
        with open(output_csv, "w", newline="") as csv_file:
            writer = csv.writer(csv_file)
            writer.writerow(["timestamp", "level", "message"])
            writer.writerow([t.strftime("%Y-%m-%d %H:%M:%S"), "ERROR", msg])
        collected_files.append(str(output_csv))
        return collected_files

    ws_url = target["webSocketDebuggerUrl"].replace("localhost", robot_ip)
    ws = websocket.create_connection(ws_url, timeout=10)
    # setting a collection time basically
    ws.settimeout(log_buffer)

    for i, method in enumerate(
        ["Runtime.enable", "Log.enable", "Console.enable"], start=1
    ):
        ws.send(json.dumps({"id": i, "method": method}))

    # Collect all entries: (robot_timestamp_ms, level, text)
    entries: List[Tuple[float, str, str]] = []
    while True:
        try:
            msg = json.loads(ws.recv())
        except websocket.WebSocketTimeoutException:
            break

        method = msg.get("method", "")
        robot_ts_ms: float = 0.0
        level = ""
        text = ""

        if method == "Runtime.consoleAPICalled":
            args = msg["params"].get("args", [])
            text = " ".join(
                str(a["value"]) if "value" in a else a.get("description", json.dumps(a))
                for a in args
            )
            level = msg["params"].get("type", "log").upper()
            robot_ts_ms = float(msg["params"].get("timestamp") or 0)

        elif method == "Log.entryAdded":
            entry = msg["params"]["entry"]
            raw_text = entry.get("text", "")
            text = raw_text if isinstance(raw_text, str) else json.dumps(raw_text)
            level = entry.get("level", "?").upper()
            robot_ts_ms = float(entry.get("timestamp") or 0)

        elif method == "Console.messageAdded":
            m = msg["params"]["message"]
            raw_text = m.get("text", "")
            text = raw_text if isinstance(raw_text, str) else json.dumps(raw_text)
            level = m.get("level", "log").upper()
            robot_ts_ms = float(m.get("timestamp") or 0)

        if "[object Object]" in text:
            text = f"[unparseable object] raw: {json.dumps(msg['params'])}"

        if level and text:
            entries.append((robot_ts_ms, level, text))

    ws.close()

    # logs come in by log type, so we sort by time
    entries.sort(key=lambda e: e[0])

    with open(output_csv, "w", newline="") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["timestamp", "level", "message"])
        for ts_ms, level, text in entries:
            ts = (
                t.strftime("%b %d %H:%M:%S", t.localtime(ts_ms / 1000))
                if ts_ms
                else "unknown"
            )
            writer.writerow([ts, level, text])

    #print(f"\nSaved {len(entries)} entries to {output_csv}")
    collected_files.append(str(output_csv))

    return collected_files
