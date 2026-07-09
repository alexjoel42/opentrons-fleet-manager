import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
import requests
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# Repo root: .../opentrons-fleet-manager. Output is a sibling folder on Desktop (etc.).
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MEMORY_RESULTS_DIR = REPO_ROOT.parent / "memory results"

def try_ssh(ip: str) -> None:
    """Verify SSH access to a robot using default ~/.ssh keys.

    Raises SystemExit if the connection fails for any reason (timeout, bad key,
    unreachable host, etc.).
    """
    try:
        result = subprocess.run(
            [
                "ssh",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                f"root@{ip}",
                "true",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except subprocess.TimeoutExpired as exc:
        raise SystemExit(
            f"Cannot connect to {ip}. Please confirm {ip}'s ssh key is in .ssh"
        ) from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise SystemExit(f"Cannot SSH to root@{ip}: {exc}") from exc

    if result.returncode != 0:
        raise SystemExit(f"Cannot connect to {ip}. Please confirm {ip}'s ssh key is in .ssh")

    print(f"SSH connection with {ip} succeeded")

def ensure_memory_results_dir() -> Path:
    """Create the output folder (sibling to opentrons-fleet-manager) if needed."""
    MEMORY_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    return MEMORY_RESULTS_DIR


def utcstamp() -> str:
    """Filesystem-safe UTC timestamp, e.g. 20260707T162430Z."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def find_name(ip_address: str) -> str:
    try:
        health = requests.get(
            f"http://{ip_address}:31950/health",
            headers={"opentrons-version": "*"},
            timeout=10,
        )
        name = health.json().get("name") or ip_address
        return sanitize_robot_name(str(name))
    except Exception:
        return sanitize_robot_name(ip_address)


def sanitize_robot_name(name: str) -> str:
    """Make robot names safe for directory and file names."""
    cleaned = "".join(
        char if char.isalnum() or char in "-_" else "_"
        for char in name.strip()
    ).strip("_")
    return cleaned or "robot"


def create_session_dir(output_dir: Path, robot_name: str) -> Path:
    session_dir = output_dir / f"{robot_name}_{utcstamp()}"
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def limit_folders(output_dir: Path, keep: int = 15) -> None:
    """Keep only the most recent session folders."""
    if keep <= 0:
        return
    dirs = sorted(
        (p for p in output_dir.iterdir() if p.is_dir()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for path in dirs[keep:]:
        shutil.rmtree(path, ignore_errors=True)


@dataclass
class memoryInfo:
    """a class for memory info"""

    timestamp: str
    total: int
    used: int
    free: int
    shared: int
    cache: int
    available: int


def stream_system_memory(ip_address: str, interval_seconds: int) -> Iterator[memoryInfo]:
    remote_cmd = f"""
while true; do
  date -Iseconds
  free -m
  echo "---"
  sleep {interval_seconds}
done
"""

    proc = subprocess.Popen(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            f"root@{ip_address}",
            remote_cmd,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    yielded = False
    try:
        if proc.stdout is None:
            raise RuntimeError("Failed to open SSH stdout stream")

        sample_lines: list[str] = []
        for line in proc.stdout:
            if line.strip() == "---":
                sample = parse_memory_sample(sample_lines)
                if sample is not None:
                    yielded = True
                    yield sample
                sample_lines = []
                continue
            sample_lines.append(line)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        stderr = proc.stderr.read().strip() if proc.stderr else ""
        if not yielded:
            detail = stderr or f"ssh exited with code {proc.returncode}"
            raise ConnectionError(
                f"Could not read memory from root@{ip_address}: {detail}"
            )


def parse_memory_sample(sample_lines: list[str]) -> memoryInfo | None:
    if not sample_lines:
        return None

    timestamp = sample_lines[0].strip()
    mem_lines = [line for line in sample_lines if line.startswith("Mem:")]
    if not mem_lines:
        return None

    parts = mem_lines[0].split()
    if len(parts) < 7:
        return None

    _, total, used, free, shared, cache, available = parts[:7]

    return memoryInfo(
        timestamp=timestamp,
        total=int(total),
        used=int(used),
        free=int(free),
        shared=int(shared),
        cache=int(cache),
        available=int(available),
    )


def parse_process_output(output: str) -> dict[str, dict[str, int | str]]:
    """Parse baltop table output into per-process JSON fields."""
    processes = {}
    for line in output.splitlines()[2:]:
        fields = line.split(maxsplit=3)
        if len(fields) != 4:
            continue

        pid, pss_mb, _, command = fields
        processes[pid] = {
            "true_ram_pss_mb": int(pss_mb),
            "command": command,
        }
    return processes


def find_processes(ip_address: str) -> dict[str, dict[str, int | str]]:
    """get top memory using processes"""
    remote_cmd = r"""
printf "%-8s %-12s %-s\n" "PID" "TRUE RAM (PSS)" "COMMAND"
printf "%-8s %-12s %-s\n" "---" "--------------" "-------"
for d in /proc/[0-9]*; do
    pid=${d##*/}
    if [ "$pid" = "$$" ]; then
        continue
    fi
    if [ -f "$d/cmdline" ] && tr '\0' ' ' < "$d/cmdline" | grep -q "opentrons"; then
        if [ -f "$d/smaps_rollup" ]; then
            pss=$(awk '/^Pss:/ {print $2}' "$d/smaps_rollup")
        else
            pss=$(awk '/^Pss:/ {sum+=$2} END {print sum}' "$d/smaps")
        fi
        if [ ! -z "$pss" ]; then
            pss_mb=$((pss / 1024))
            cmd=$(tr '\0' ' ' < "$d/cmdline" | awk '{print $1 " " $2}')
            printf "%-8s %-12s %-s\n" "$pid" "${pss_mb} MB" "$cmd"
        fi
    fi
done
"""
    result = subprocess.run(
        ["ssh", f"root@{ip_address}", remote_cmd],
        capture_output=True,
        text=True,
        check=False,
    )
    print(result.stdout, end="", flush=True)
    return parse_process_output(result.stdout)


def make_plot(json_path: Path) -> None:
    memory_rows = read_memory_use(json_path)
    if not memory_rows:
        print(f"No memory data found in {json_path}")
        return

    df = pd.DataFrame(memory_rows, columns=["timestamp", "memory_percent_used"])
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    fig, ax = plt.subplots()
    ax.plot(df["timestamp"], df["memory_percent_used"])
    ax.set_title("Used Memory Over Time")
    ax.set_xlabel("Time")
    ax.set_ylabel("Memory Usage (%)")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()
    fig.tight_layout()

    plot_path = json_path.with_suffix(".png")
    fig.savefig(plot_path)
    plt.show()
    print(f"Saved plot to {plot_path}", flush=True)


def read_memory_use(json_path: Path) -> list[tuple[str, float]]:
    rows = []
    with open(json_path) as json_file:
        for line in json_file:
            if not line.strip():
                continue
            obj = json.loads(line)
            timestamp = list(obj.keys())[0]
            inner = obj[timestamp]
            maintenance = inner.get("maintenance", {})
            memory_percent = maintenance.get("used_memory_percent")
            if memory_percent is not None:
                rows.append((timestamp, memory_percent))
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tracks robot system RAM usage")
    parser.add_argument(
        "--ip_address",
        metavar="IP",
        default=None,
        type=str,
        help="Robot IP address",
    )
    parser.add_argument(
        "--interval_seconds",
        default=1,
        type=int,
        help="Seconds between memory samples",
    )
    parser.add_argument(
        "--end_script",
        default=72,
        type=int,
        help="Max number of hours the script can run",
    )
    args = parser.parse_args()

    output_dir = ensure_memory_results_dir()

    if args.ip_address:
        ip_address = args.ip_address
    else:
        try:
            ip_address = input("Enter Robot IP: ").strip()
        except EOFError:
            print(
                "Robot IP is required. Run: python3 ram_tracker.py --ip_address <robot-ip>",
                file=sys.stderr,
            )
            raise SystemExit(1) from None
        if not ip_address:
            print("Robot IP is required.", file=sys.stderr)
            raise SystemExit(1)
    
    try_ssh(ip_address)

    robot_name = find_name(ip_address)
    session_dir = create_session_dir(output_dir, robot_name)
    json_path = session_dir / f"{robot_name}_memory.jsonl"
    json_path.touch()
    print(f"Writing results to {session_dir}", flush=True)

    used_history = deque(maxlen=12)
    try:
        while True:
            try:
                for memory_sample in stream_system_memory(
                    ip_address, args.interval_seconds
                ):
                    used_history.append(memory_sample.used)
                    used_pct = round(
                        (memory_sample.used / memory_sample.total) * 100, 3
                    )
                    json_msg = {
                        memory_sample.timestamp: {
                            "maintenance": {
                                "used_memory_percent": used_pct,
                                "used_memory_mb": memory_sample.used,
                            },
                            "events": [],
                        }
                    }
                    maintenance = json_msg[memory_sample.timestamp]

                    if len(used_history) < used_history.maxlen:
                        maintenance["events"].append(
                            {
                                "message": "No Warnings",
                            }
                        )
                        print(json.dumps(json_msg), flush=True)
                        with open(json_path, "a") as json_file:
                            json_file.write(json.dumps(json_msg) + "\n")
                        continue

                    baseline = sum(used_history) / len(used_history)
                    increase_from_baseline = memory_sample.used - baseline
                    if used_pct > 90.0:
                        top_memory_processes = find_processes(ip_address)
                        maintenance["events"].append(
                            {
                                "message": "High memory usage",
                                "top_memory_processes": top_memory_processes,
                            }
                        )
                    elif memory_sample.used > baseline * 1.20:
                        top_memory_processes = find_processes(ip_address)
                        maintenance["events"].append(
                            {
                                "message": "Used memory rose above 1.2x baseline",
                                "top_memory_processes": top_memory_processes,
                            }
                        )
                    elif increase_from_baseline > 150:
                        top_memory_processes = find_processes(ip_address)
                        maintenance["events"].append(
                            {
                                "message": "Used memory increased by more than 150 MB",
                                "top_memory_processes": top_memory_processes,
                            }
                        )
                    else:
                        maintenance["events"].append(
                            {
                                "message": "No Warnings",
                            }
                        )

                    print(json.dumps(json_msg), flush=True)
                    with open(json_path, "a") as json_file:
                        json_file.write(json.dumps(json_msg) + "\n")
            except ConnectionError as exc:
                print(f"{exc}", flush=True)
                print("Retrying SSH in 5 seconds...", flush=True)
                time.sleep(5)
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received. Creating memory plot...", flush=True)
        make_plot(json_path)
        limit_folders(output_dir)
        print(f"Session saved to {session_dir}", flush=True)
