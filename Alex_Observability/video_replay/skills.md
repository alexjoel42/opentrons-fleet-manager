# Video Replay — Project overview

**Purpose:** Headless Opentrons run monitor (`monitor.py`) for the **RobotFleet Raspberry Pi**. One background thread per robot polls the robot HTTP API (:31950), records the HLS camera feed with ffmpeg into a rolling buffer, and on error recovery / run failure / command error saves the last ~2 minutes as an `.mp4` + `.json` under **`--storage-directory`**. Optional Slack alerts; optional robot log zip via SSH (`read_robot_logs.py`).

Repo: [alexjoel42/opentrons-fleet-manager](https://github.com/alexjoel42/opentrons-fleet-manager)

---

## Pi deployment (three steps)

### 1. Jupyter on the Pi

SSH into the Pi, start passwordless Jupyter on all interfaces:

```bash
nohup jupyter notebook --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='' --NotebookApp.password='' > jupyter.log 2>&1 &
```

Browse to **`http://<Pi_IP>:8888`**. Use a named terminal (e.g. **`DO_NOT_CLOSE`**) for the long-running monitor session.

### 2. Script and config setup

From repo **`Alex_Observability/video_replay/`**:

```bash
make setup
make init-storage
source .venv/bin/activate
```

- **`make init-storage`** creates **`../video_storage/`** (sibling to repo) with `clips/`, `recordings/`, `config.example.yaml`, `config.example.ini`.
- Copy examples → **`config.yaml`** and **`config.ini`**; fill in robots, Slack channel, and **`[DEFAULT] slack_token = xoxb-...`** in `config.ini`.
- Robot SSH keys must be in **`~/.ssh`** on the Pi (default SSH config; verified at startup via **`try_ssh`**).
- Create Slack app at [api.slack.com/apps](https://api.slack.com/apps); invite bot to target channel from `config.yaml`.

### 3. Run monitor

```bash
python3 monitor.py --storage-directory <storage_path>
```

Example: `/home/pi/video_storage` on Pi, or absolute path to `video_storage` on any host. Optional **`--verbose`**. Requires **ffmpeg** on PATH.

---

## Architecture

- **monitor.py:** CLI entrypoint. **`--storage-directory`** (required) is base path for **`config.yaml`**, **`config.ini`**, **`clips/`**, **`recordings/`**. Spawns **`RobotWatcher`** threads; main thread waits on SIGINT/SIGTERM. **`try_ssh`** checks each robot via **`~/.ssh`** before monitoring starts.
- **RobotWatcher:** Polls **`GET /runs`**, manages **`Recorder`**, error triggers, **`_save_and_notify`**.
- **Recorder:** ffmpeg HLS → segmented `.ts` in **`work_dir/<robot>/`**; **`extract_clip`** → `.mp4` under **`output_dir`**.
- **Notifications:** **`SlackNotifier`** (token from **`config.ini`** via **`notify.token_ini`**) or **`WebhookNotifier`**. Built per robot via **`build_robot_notifier`**.
- **Logs:** **`fetch_robot_logs`** → **`read_robot_logs.get_logs(storage_dir, ip)`**; SSH via default **`~/.ssh`** keys.

---

## Config

YAML at **`{storage_directory}/config.yaml`**. Sections: **`robots`** (name, ip, optional channel overrides), **`clip`**, **`triggers`**, **`notify`**, **`output_dir`**, **`work_dir`**, **`poll_interval_seconds`**, **`opentrons_version`**.

Slack token in **`{storage_directory}/config.ini`**:

```ini
[DEFAULT]
slack_token = xoxb-...
```

Referenced by **`notify.token_ini: "./config.ini"`** in `config.yaml`. Both config files are gitignored — do not commit tokens or keys.

---

## Makefile

From **`video_replay/`**: **`setup`**, **`init-storage`**, **`check-ffmpeg`**, **`lint`**, **`lint-fix`**, **`format-fix`**, **`help`**.

---

## Files

- **monitor.py:** **`Config`**, **`RobotWatcher`**, **`Recorder`**, notifiers, **`main()`**.
- **read_robot_logs.py:** SSH/HTTP log download; used on error save.
- **config.example.yaml** / **config.example.ini:** Templates copied by **`make init-storage`**.
- **requirements.txt:** **`requests`**, **`PyYAML`**, **`slack-sdk`**, **`ruff`**, etc.

---

## Common tasks

- **Adding a robot:** Add entry under **`robots:`** in **`config.yaml`**; restart monitor.
- **Adding a trigger:** Extend **`TriggerConfig`** + **`_maybe_trigger`** in **`monitor.py`**; respect **`RunState`** cooldown and dedup flags.

**Full setup and reference:** **[README.md](README.md)**
