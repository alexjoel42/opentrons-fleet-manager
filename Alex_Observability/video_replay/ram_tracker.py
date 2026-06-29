import argparse
import json
from pathlib import Path
import subprocess
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
import requests
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates


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
        ["ssh", f"root@{ip_address}", remote_cmd],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        if proc.stdout is None:
            raise RuntimeError("Failed to open SSH stdout stream")

        sample_lines: list[str] = []
        for line in proc.stdout:
            if line.strip() == "---":
                yield parse_memory_sample(sample_lines)
                sample_lines = []
                continue
            sample_lines.append(line)
    finally:
        proc.terminate()


def parse_memory_sample(sample_lines: list[str]) -> memoryInfo:
    timestamp = sample_lines[0].strip()
    mem_line = next(line for line in sample_lines if line.startswith("Mem:"))
    _, total, used, free, shared, cache, available = mem_line.split()

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


def init_json(ip_address: str) -> str:
    """initialize a JSON and return the name"""
    try:
        health = requests.get(
            f"http://{ip_address}:31950/health",
            headers={"opentrons-version": "*"},
            timeout=10,
        )
        robot_name = health.json().get("name", ip_address)
    except Exception:
        robot_name = ip_address

    json_path = f"{robot_name}_memory.jsonl"
    with open(json_path, "w") as json_file:
        pass
    return json_path

def make_plot(json_path: str) -> None:
    memory_rows = read_memory_use(json_path)
    if not memory_rows:
        print(f"No memory data found in {json_path}")
        return

    df = pd.DataFrame(memory_rows, columns=["timestamp", "available_memory_percent"])
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    fig, ax = plt.subplots()
    ax.plot(df["timestamp"], df["available_memory_percent"])
    ax.set_title("Available Memory Over Time")
    ax.set_xlabel("Time")
    ax.set_ylabel("Available Memory (%)")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()
    fig.tight_layout()

    plot_path = Path(json_path).with_suffix(".png")
    fig.savefig(plot_path)
    plt.show()
    

def read_memory_use(json_path: str) -> list[tuple[str, float]]:
    rows = []
    with open(json_path) as json_file:
        for line in json_file:
            if not line.strip():
                continue
            obj = json.loads(line)
            timestamp = list(obj.keys())[0]
            inner = obj[timestamp]
            maintenance = inner.get("maintenance", {})
            memory_percent = maintenance.get("available_memory_percent")
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

    ip_address = args.ip_address or input("Enter Robot IP: ")
    available_history = deque(maxlen=12)
    json_path = init_json(ip_address)
    try:
        for memory_sample in stream_system_memory(ip_address, args.interval_seconds):
            available_history.append(memory_sample.available)
            available_pct = round((memory_sample.available / memory_sample.total)*100, 3)
            json_msg = {
                memory_sample.timestamp: {
                    "maintenance": {
                        "available_memory_percent": available_pct,
                        "available_memory_mb": memory_sample.available,
                    },
                    "events": [],
                }
            }
            maintenance = json_msg[memory_sample.timestamp]

            if len(available_history) < available_history.maxlen:
                maintenance["events"].append(
                    {
                        "message": "No Warnings",
                    }
                )
                print(json.dumps(json_msg), flush=True)
                with open(json_path, "a") as json_file:
                    json_file.write(json.dumps(json_msg) + "\n")
                continue

            baseline = sum(available_history) / len(available_history)
            drop_from_baseline = baseline - memory_sample.available
            if available_pct < 28.0:
                top_memory_processes = find_processes(ip_address)
                maintenance["events"].append(
                    {
                        "message": "Low available memory",
                        "top_memory_processes": top_memory_processes,
                    }
                )
            elif memory_sample.available < baseline * 0.80:
                top_memory_processes = find_processes(ip_address)
                maintenance["events"].append(
                    {
                        "message": "Available memory dropped below .8 of baseline",
                        "top_memory_processes": top_memory_processes,
                    }
                )
            elif drop_from_baseline > 150:
                top_memory_processes = find_processes(ip_address)
                maintenance["events"].append(
                    {
                        "message": "Available memory dropped by more than 150 MB",
                        "top_memory_processes": top_memory_processes,
                    }
                )
            else:
                maintenance["events"].append(
                    {
                        "message": "Not Enough",
                    }
                )

            with open(json_path, "a") as json_file:
                json_file.write(json.dumps(json_msg) + "\n")
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received. Creating memory plot...", flush=True)
        make_plot(json_path)

'''
1. Profile continuously 
cursor write me a plotted graph based on the json dump that I've given you thanks fam

'''
