# Video Replay — Project overview

**Purpose:** Headless Opentrons run monitor (`monitor.py`). One background thread per robot polls the robot HTTP API (:31950), records the HLS camera feed with ffmpeg into a rolling buffer, and on error recovery / run failure / command error saves the last ~2 minutes as an `.mp4` + `.json` under **`--storage-directory`**. Optional Slack or webhook alerts; optional robot log zip via SSH (`read_robot_logs.py`).

**Architecture**

- **monitor.py:** CLI entrypoint. **`--storage-directory`** (required) is the base path for **`config.yaml`**, **`clips/`**, **`recordings/`**, and **`robot_key`**. Spawns **`RobotWatcher`** threads; main thread waits on SIGINT/SIGTERM.
- **RobotWatcher:** Polls **`GET /runs`** (current run), **`GET /protocols/{id}`** (protocol name for notifications). Manages **`Recorder`**, **`RunState`** (per-run trigger dedup), **`_maybe_trigger`**, **`_save_and_notify`**.
- **Recorder:** ffmpeg HLS → segmented `.ts` in **`work_dir/<robot>/`**; **`extract_clip`** concat → `.mp4` in per-incident folder under **`output_dir`**.
- **Notifications:** **`SlackNotifier`** (token file or ini, thread upload) or **`WebhookNotifier`**. Built per robot via **`build_robot_notifier`**.
- **Logs:** **`fetch_robot_logs`** → local **`read_robot_logs.get_logs(storage_dir, ip)`**; SSH key at **`{storage_dir}/robot_key`**.

**Config:** YAML at **`{storage_directory}/config.yaml`** (gitignored). Sections: **`robots`** (name, ip, optional slack overrides), **`clip`**, **`triggers`**, **`notify`**, **`output_dir`**, **`work_dir`**, **`poll_interval_seconds`**, **`opentrons_version`**.

**Run:** From **`video_replay/`**: **`make setup`**, then  
**`.venv/bin/python monitor.py --storage-directory /path/to/storage`**  
(optional **`--verbose`**). Requires **ffmpeg** on PATH.

**Quality:** **`make lint`** / **`make lint-fix`** / **`make format-fix`** — Ruff (same toolchain as Observability V0).

**Files**

- **monitor.py:** **`Config`**, **`RobotWatcher`**, **`Recorder`**, notifiers, **`main()`**.
- **read_robot_logs.py:** SSH/HTTP log download (abr-testing lineage); used only on error save.
- **requirements.txt:** **`requests`**, **`PyYAML`**, **`slack-sdk`**, **`ruff`**, plus transitive deps for log tooling.
- **Makefile:** **`setup`**, **`lint`**, **`help`**.

**Adding a robot:** Add an entry under **`robots:`** in **`config.yaml`**; restart monitor (one watcher thread per robot).

**Adding a trigger:** Extend **`TriggerConfig`** + **`_maybe_trigger`** in **`monitor.py`**; respect **`RunState`** cooldown and dedup flags.
