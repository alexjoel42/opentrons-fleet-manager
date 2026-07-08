# Video Replay Monitor

A **headless run monitor** for Opentrons robots: watches one or more robots over their HTTP API (port **31950**), records the live HLS camera feed into a rolling buffer with **ffmpeg**, and saves the last N seconds of footage (default 2 minutes) as an `.mp4` plus a `.json` metadata file when a run enters error recovery, fails, or reports a command error. Optionally sends Slack or webhook notifications and pulls robot logs via SSH.

Designed to run unattended (e.g. as a systemd service on a Raspberry Pi).

---

## Architecture

```
  monitor.py (main thread)
       |
       +-- RobotWatcher thread (per robot) --HTTP :31950-->  Opentrons robot(s)
       |         |
       |         +-- ffmpeg  <-- HLS http://<ip>:31950/hls/stream.m3u8
       |         +-- read_robot_logs.get_logs (SSH, on error)
       |
       +-- clips/ + recordings/ under --storage-directory
```

- **monitor.py**: Loads `config.yaml`, spawns one `RobotWatcher` thread per robot, supervises shutdown on SIGINT/SIGTERM.
- **RobotWatcher**: Polls `/runs` for the current run; starts/stops `Recorder` based on run status; evaluates error triggers; saves clips and notifies.
- **Recorder**: Uses ffmpeg segment muxer to maintain a rolling `.ts` buffer; on trigger, concatenates recent segments into an `.mp4`.
- **read_robot_logs.py**: Downloads a robot log `.zip` over SSH (expects `{storage_dir}/robot_key`).

**Main flows**

1. **Run starts**: Begin recording HLS feed; optionally notify Slack/webhook.
2. **Error / recovery / failure**: Save pre-error clip + metadata; fetch robot logs; notify; prune old incident folders.
3. **Run ends**: Stop recording and clean up buffer for that run.

---

## How to run

**Prerequisites:** Python 3.8+, **ffmpeg** on `PATH`, network access to robot(s) on port 31950. For log collection: SSH key at `{storage_directory}/robot_key`.

From **video_replay**:

### One-time setup

```bash
make setup
source .venv/bin/activate
```

### Configure storage

Create a storage directory with `config.yaml` (gitignored — do not commit tokens or keys):

```
/path/to/storage/
  config.yaml
  robot_key          # SSH private key for log download (optional)
  clips/             # saved incident folders (created automatically)
  recordings/        # rolling ffmpeg segments (created automatically)
```

Example `config.yaml`:

```yaml
poll_interval_seconds: 3.0
opentrons_version: "2"
output_dir: ./clips
work_dir: ./recordings

clip:
  pre_error_seconds: 120
  post_error_seconds: 10
  segment_seconds: 10
  buffer_seconds: 180
  cooldown_seconds: 60
  max_clips: 5

triggers:
  on_error_recovery: true
  on_failed: true
  on_command_error: true

notify:
  enabled: true
  type: slack          # slack | webhook | none
  token_file: ./slack_token.txt
  channel: robot-alerts
  upload_clip: true

robots:
  - name: flex-01
    ip: 198.51.100.73
    slack_channel: ""   # optional override; falls back to notify.channel
```

### Run the monitor

```bash
python3 monitor.py --storage-directory /path/to/storage
```

Optional flags: `--config config.yaml` (default), `--verbose` (debug logging).

| Command            | Description                              |
|--------------------|------------------------------------------|
| `make setup`       | Create `.venv` and install requirements  |
| `make lint`        | Ruff (Python)                            |
| `make lint-fix`    | Auto-fix lint where possible             |
| `make format-fix`  | Lint-fix + Ruff format                   |
| `make help`        | List Make targets                        |

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

## Notifications

| `notify.type` | Behavior |
|---------------|----------|
| `none`        | Clips saved locally only |
| `slack`       | Bot message + optional file upload (clip + logs) via `slack_sdk` |
| `webhook`     | POST to Slack Incoming Webhook or generic JSON endpoint (no file upload) |

Slack token: set `token_file` (plain `xoxb-...` file) or `token_ini` (abr-style `[DEFAULT] slack_token = ...`). Per-robot overrides: `slack_channel`, `slack_username`, `config_ini`.

---

## Future ideas

- Make `read_robot_logs` path and SSH key location configurable (currently tied to storage dir).
- systemd unit file and Pi deployment doc (mirror Observability V0).
- Fix stream-down backoff (`STREAM_DOWN_AFTER_FAILURES`) and remove debug `print` in `_handle_run`.
- Health endpoint or metrics for “last poll / last clip” per robot.
