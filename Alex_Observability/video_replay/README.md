# Video Replay Monitor

Headless Opentrons run monitor for the **RobotFleet Raspberry Pi**. Watches robots over HTTP (port **31950**), records the live HLS camera feed with **ffmpeg** into a rolling buffer, and saves the last ~2 minutes of footage as an `.mp4` plus metadata when a run hits error recovery, fails, or reports a command error. Optionally sends Slack notifications, pulls robot logs via SSH, and runs **Gemini AI video analysis** that posts an Error + Suggested Fix reply in the Slack thread.

Repo: [alexjoel42/opentrons-fleet-manager](https://github.com/alexjoel42/opentrons-fleet-manager)

---

## Overview

There are three main setup steps to use the RobotFleet Pi for video replays:

1. **Set up a Jupyter notebook environment** on the Raspberry Pi (browser-based terminal and file access).
2. **Configure video_replay storage** — folders, Slack credentials, and optionally a Gemini API key for AI analysis (robot SSH keys live in `~/.ssh`).
3. **Run `monitor.py`** and leave it running for the duration of your monitoring session.

---

## 1. Setting up Jupyter notebook

Set up Jupyter so anyone on your Wi‑Fi network can open it with the Pi’s IP address and port — no password or token required.

SSH into the Raspberry Pi, then run:

```bash
nohup jupyter notebook --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token='' --NotebookApp.password='' > jupyter.log 2>&1 &
```

- Change **`8888`** to use a different port.
- Set **`NotebookApp.token`** and **`NotebookApp.password`** if you want authentication instead of open access.

Open **`http://<Pi_IP>:8888`** in your browser. From there you can create terminals and edit files on the Pi.

> **Tip:** When you open a terminal in Jupyter for the long-running monitor, name it something obvious like **`DO_NOT_CLOSE`** — that session must stay open for the duration of the script run.

---

## 2. Setup video_replay configuration

This step creates the Python environment, storage layout, and config files the monitor needs. You will need:

- **Robot SSH keys** in your **`~/.ssh`** folder (for log download on errors) — the script uses your default SSH config, same as a normal `ssh root@<robot-ip>` session
- **Slack bot token** (for notifications) — place in `config.ini`
- **Gemini API key** (optional, for AI video analysis) — set as the `GEMINI_API_KEY` environment variable

In a Jupyter terminal, from the repo:

```bash
cd Alex_Observability/video_replay
make setup
make init-storage
source .venv/bin/activate
```

`make setup` installs Python deps from `requirements.txt`, including **`google-genai`** (used by `ai_analysis.py`). `make init-storage` creates a **`video_storage`** folder **next to** the `opentrons-fleet-manager` repo (sibling directory). Default path:

```
../video_storage/
  clips/                  # saved incident clips (created automatically)
  recordings/             # rolling ffmpeg buffer (created automatically)
  config.example.yaml
  config.example.ini
```

### Configure `config.yaml` and `config.ini`

Copy the example files and edit them:

```bash
cp ../video_storage/config.example.yaml ../video_storage/config.yaml
cp ../video_storage/config.example.ini ../video_storage/config.ini
```

**`config.yaml`** — robot list, clip/trigger settings, Slack channel, etc. Comments in the example file explain each field. At minimum, set your robot names and IPs under `robots:`.

**`config.ini`** — Slack bot token (required when `notify.type` is `slack`):

```ini
[DEFAULT]
slack_token = xoxb-your-bot-token-here
```

Create a Slack app and bot token at [api.slack.com/apps](https://api.slack.com/apps). **Invite the app to the target Slack channel** specified in `config.yaml` (`notify.channel` or per-robot `channel` overrides).

**SSH keys** — ensure each robot’s key is set up under **`~/.ssh`** on the Pi before starting the monitor. On startup the script verifies SSH to each robot; if a key is missing or wrong, it exits with an error.

### Configure Gemini AI analysis (optional)

When Slack notifications are enabled and a clip is saved, the monitor can upload the clip to **Gemini**, get a short diagnosis, and post it as a reply in the same Slack thread.

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Export it in the same shell (or systemd unit) that runs the monitor:

```bash
export GEMINI_API_KEY=your-gemini-api-key-here
```

If `GEMINI_API_KEY` is unset, the monitor still records clips and sends Slack alerts — AI analysis is skipped and logged. Analysis runs in a **background thread** so it never blocks robot polling.

---

## 3. Run the script

Copy the full path to your `video_storage` folder — referred to below as **`<storage_path>`** (e.g. `/home/pi/video_storage` on the Pi).

With the venv activated, from **`Alex_Observability/video_replay`**:

```bash
export GEMINI_API_KEY=your-gemini-api-key-here   # optional; enables AI analysis
python3 monitor.py --storage-directory <storage_path>
```

Or from the parent of the repo (adjust paths to match your machine):

```bash
cd ../../..
python3 opentrons-fleet-manager/Alex_Observability/video_replay/monitor.py --storage-directory <storage_path>
```

Optional flags:

| Flag | Description |
|------|-------------|
| `--config config.yaml` | Config filename or path (default: `config.yaml` under storage dir) |
| `--verbose` | Debug logging |

Leave the terminal open. Stop with **Ctrl+C** (graceful shutdown).

---

## Architecture

```
  monitor.py (main thread)
       |
       +-- RobotWatcher thread (per robot) --HTTP :31950-->  Opentrons robot(s)
       |         |
       |         +-- ffmpeg  <-- HLS http://<ip>:31950/hls/stream.m3u8
       |         +-- read_robot_logs.get_logs (SSH, on error)
       |         +-- SlackNotifier
       |                 |
       |                 +-- upload clip + logs to Slack thread
       |                 +-- background: ai_analysis.analyze_video (Gemini)
       |                         → reply in same Slack thread
       |
       +-- clips/ + recordings/ under --storage-directory
```

- **monitor.py** — Loads `config.yaml`, spawns one `RobotWatcher` thread per robot, handles SIGINT/SIGTERM.
- **RobotWatcher** — Polls `/runs`; starts/stops recording; evaluates error triggers; saves clips and notifies.
- **Recorder** — ffmpeg segment muxer rolling buffer; concatenates recent segments into `.mp4` on trigger.
- **read_robot_logs.py** — Downloads robot log `.zip` over SSH.
- **ai_analysis.py** — Uploads the incident clip to Gemini (`gemini-3.6-flash`) and returns a short **Error** + **Suggested Fix**. Dependency-isolated (`google-genai` + stdlib only). Failures are logged and never break Slack alerting.

**Main flows**

1. **Run starts** — Begin recording HLS feed; optionally notify Slack.
2. **Error / recovery / failure** — Save pre-error clip + metadata; fetch robot logs; notify Slack (parent message + file uploads); if `GEMINI_API_KEY` is set, analyze the clip and post the result as a thread reply; prune old incident folders.
3. **Run ends** — Stop recording and clean up buffer for that run.

---

## Storage layout

After setup, **`--storage-directory`** should look like:

```
<storage_path>/
  config.yaml           # main config (gitignored — do not commit)
  config.ini            # Slack token (gitignored)
  clips/                # incident folders
  recordings/           # rolling ffmpeg segments
```

Example `config.yaml` (see `config.example.yaml` for full reference):

```yaml
poll_interval_seconds: 10
opentrons_version: "*"
output_dir: "./clips"
work_dir: "./recordings"

clip:
  pre_error_seconds: 120
  post_error_seconds: 10
  segment_seconds: 10
  buffer_seconds: 180
  cooldown_seconds: 60

triggers:
  on_error_recovery: true
  on_failed: true
  on_command_error: true

notify:
  enabled: true
  type: slack
  token_ini: "./config.ini"
  channel: abr-robot-alerts
  upload_clip: true

robots:
  - name: robot-a
    ip: 169.254.1.2
  - name: robot-b
    ip: 169.254.1.3
```

---

## Output layout

Each incident is saved under `output_dir` in its own folder:

```
clips/
  flex-01_a1b2c3d4_20260707T154530Z/
    flex-01_a1b2c3d4_20260707T154530Z.mp4
    flex-01_a1b2c3d4_20260707T154530Z.json
    <robot-logs>.zip          # if SSH log collection succeeded
```

The `.json` sidecar includes run id, status, error detail, timestamps, and paths to the clip and log zip.

---

## Makefile targets

Run from **`Alex_Observability/video_replay`**:

| Command | Description |
|---------|-------------|
| `make setup` | Install ffmpeg (if needed), create `.venv`, install Python deps |
| `make init-storage` | Create `../video_storage` with `clips/`, `recordings/`, config examples |
| `make check-ffmpeg` | Verify ffmpeg is on PATH |
| `make lint` | Ruff lint |
| `make lint-fix` | Auto-fix lint where possible |
| `make format-fix` | Lint-fix + Ruff format |
| `make help` | List all targets |

---

## Prerequisites

- Python 3.8+
- **ffmpeg** on `PATH` (`make setup` attempts to install it)
- Network access to robot(s) on port **31950**
- For log collection: robot SSH keys in **`~/.ssh`** on the host running the monitor
- For AI analysis: **`GEMINI_API_KEY`** in the environment, outbound HTTPS to Google’s Gemini API, and `google-genai` (installed by `make setup`)

---

## Notifications

| `notify.type` | Behavior |
|---------------|----------|
| `none` | Clips saved locally only |
| `slack` | Bot message + optional file upload (clip + logs) via `slack_sdk`; if `GEMINI_API_KEY` is set, Gemini analysis is posted as a thread reply |
| `webhook` | POST to Slack Incoming Webhook or generic JSON endpoint (no file upload, no AI analysis) |

Slack token: set `token_ini` (recommended — `config.ini` with `[DEFAULT] slack_token = ...`) or `token_file` (plain `xoxb-...` file). Per-robot overrides: `channel`, `username`, `config_ini`.

---

## AI video analysis

`ai_analysis.py` reviews a top-down deck clip with Gemini and returns exactly two parts:

- **Error** — 2–3 sentences naming what went wrong, using deck slot coordinates (A1–D3)
- **Suggested Fix** — 1–2 sentences on how to resume normal operation

When used from the monitor (Slack path), analysis runs after the clip is uploaded and the result is posted under **AI Video Analysis** in the incident thread. Transient Gemini `503` responses are retried with exponential backoff.

### Standalone usage

You can analyze an existing clip without running the full monitor (venv activated, `GEMINI_API_KEY` set):

```bash
cd Alex_Observability/video_replay
export GEMINI_API_KEY=your-gemini-api-key-here
python3 ai_analysis.py /path/to/clip.mp4
# optional: attach a robot logs zip as supporting evidence
python3 ai_analysis.py /path/to/clip.mp4 /path/to/robot-logs.zip
```

The optional logs zip is parsed with stdlib `zipfile` only (tail-biased, size-capped; api/server logs preferred). A missing or unreadable zip does not fail analysis — the video alone is used.
