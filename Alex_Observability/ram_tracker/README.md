# RAM Tracker

A **headless RAM profiler** for Opentrons robots: SSH into a robot, sample system memory on an interval, append readings to a JSONL file, and flag low-memory events with top Opentrons process PSS usage. On exit (Ctrl-C), plots available memory over time as a PNG.

---

## Architecture

```
  ram_tracker.py  --SSH-->  robot (root@<ip>)
       |                        |
       |                        +-- `free -m` (system memory, every N seconds)
       |                        +-- `/proc/*/smaps` (Opentrons process PSS on alerts)
       |
       +-- HTTP :31950/health (robot name for output filename)
       +-- <robot_name>_memory.jsonl  (local append-only log)
       +-- <robot_name>_memory.png    (plot on Ctrl-C)
```

- **ram_tracker.py**: Streams memory samples over SSH, writes JSONL, evaluates alert rules, optionally dumps top memory-consuming Opentrons processes.
- **Output**: One JSON object per line with timestamp, available memory (MB and %), and an `events` array.

**Main flows**

1. **Profile**: Connect via SSH, sample `free -m` every `--interval_seconds`.
2. **Warmup**: First 12 samples record baseline only (no alert logic).
3. **Alert**: After warmup, trigger process scan when memory drops below thresholds.
4. **Plot**: Ctrl-C reads the JSONL and saves an available-memory-over-time chart.

---

## How to run

**Prerequisites:** Python 3.10+, SSH access to the robot as `root@<ip>` (default key/agent), network access to robot HTTP API on port **31950**.

From **ram_tracker**:

### One-time setup

```bash
make setup
source .venv/bin/activate
```

### Run the tracker

```bash
python3 ram_tracker.py --ip_address 198.51.100.73
```

Or omit `--ip_address` to be prompted interactively.

| Flag                 | Default | Description                          |
|----------------------|---------|--------------------------------------|
| `--ip_address`       | prompt  | Robot IP address                     |
| `--interval_seconds` | `1`     | Seconds between memory samples       |
| `--end_script`       | `72`    | Max hours (parsed; not yet enforced) |

Stop with **Ctrl-C** to generate the memory plot (`<robot_name>_memory.png`).

| Command            | Description                              |
|--------------------|------------------------------------------|
| `make setup`       | Create `.venv` and install requirements  |
| `make lint`        | Ruff (Python)                            |
| `make lint-fix`    | Auto-fix lint where possible             |
| `make format-fix`  | Lint-fix + Ruff format                   |
| `make help`        | List Make targets                        |

---

## Alert rules

After a 12-sample warmup, each sample is checked:

| Condition | Event |
|-----------|-------|
| Available memory &lt; 28% | `Low available memory` + top Opentrons processes |
| Available &lt; 80% of rolling baseline | `Available memory dropped below .8 of baseline` + processes |
| Drop from baseline &gt; 150 MB | `Available memory dropped by more than 150 MB` + processes |
| Otherwise | `Not Enough` (no process scan) |

Process scan runs over SSH and reports PSS (MB) for processes whose cmdline contains `opentrons`.

---

## Output format

JSONL file: `{robot_name}_memory.jsonl`

```json
{"2026-07-07T14:30:00-04:00": {"maintenance": {"available_memory_percent": 42.5, "available_memory_mb": 3400}, "events": [{"message": "No Warnings"}]}}
```

On alert, `events` includes `top_memory_processes` keyed by PID.

---

## Future ideas

- Enforce `--end_script` max runtime.
- Configurable alert thresholds and output directory.
- Optional Slack/webhook notifications on low-memory events.
- systemd unit for long-running Pi deployments.
