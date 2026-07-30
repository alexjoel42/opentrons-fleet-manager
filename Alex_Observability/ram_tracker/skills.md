# RAM Tracker — Project overview

**Purpose:** Profile Opentrons robot system RAM over SSH. **`ram_tracker.py`** streams **`free -m`** samples from **`root@<ip>`**, appends JSONL locally, flags low-memory conditions, and on Ctrl-C plots available memory % to a PNG.

**Architecture**

- **SSH stream:** **`stream_system_memory()`** runs a remote loop: **`date -Iseconds`**, **`free -m`**, sleep **`interval_seconds`**. Parses into **`memoryInfo`** dataclass.
- **HTTP:** **`init_json()`** calls **`GET http://<ip>:31950/health`** for robot name → output file **`{robot_name}_memory.jsonl`**.
- **Alerts:** After 12-sample warmup (**`deque(maxlen=12)`**), compare available MB/% against baseline; on trigger call **`find_processes()`** (remote **`/proc/*/smaps_rollup`** for cmdlines containing **`opentrons`**).
- **Plot:** **`make_plot()`** on KeyboardInterrupt — reads JSONL, saves **`{robot_name}_memory.png`**, calls **`plt.show()`**.

**Run:** From **`ram_tracker/`**: **`make setup`**, then  
**`.venv/bin/python ram_tracker.py --ip_address <ip> [--interval_seconds 1]`**  
Requires passwordless **`ssh root@<ip>`**.

**Quality:** **`make lint`** / **`make lint-fix`** / **`make format-fix`** — Ruff default rules (same as Observability_V0 **`lint-py`**).

**Files**

- **ram_tracker.py:** CLI entrypoint, streaming parser, alert logic, plot helper.
- **requirements.txt:** **`requests`**, **`pandas`**, **`matplotlib`**, **`ruff`**.

**CLI args:** **`--ip_address`**, **`--interval_seconds`** (default 1), **`--end_script`** (default 72, parsed but not enforced in loop).

**Output:** **`{robot_name}_memory.jsonl`** in cwd; each line is **`{timestamp: {maintenance: {...}, events: [...]}}`**.
