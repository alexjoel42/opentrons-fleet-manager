# ABR Robot Monitoring + AI Video Analysis Flow

> Read this before touching `monitor.py`, `ai_analysis.py`, or the Slack/Gemini
> pieces. It explains how the whole pipeline fits together and where each piece
> runs.

## What it is

A headless service that watches Opentrons robots, records their camera feed, and
when a run hits an error it saves a video clip, pulls logs, posts everything to
Slack, and has **Gemini** analyze the clip and reply with a plain-English
diagnosis. It runs unattended as a **systemd service on a Raspberry Pi**.

## Where things run

- **`monitor.py`** — the long-running service on the Pi. Talks to robots over
  their HTTP API (port `31950`) and drives everything below.
- **`ai_analysis.py`** — the Gemini call. Deliberately **dependency-isolated**:
  it imports only `google-genai` + stdlib. It runs OFF the robot (inside the
  Slack analyzer path), so google-genai's heavy transitive deps never touch the
  robot-server environment. Do not add robot/abr imports here.

## The flow (per robot)

1. **Poll.** One `RobotWatcher` thread per robot polls `GET /runs` (~every 3s)
   for the current run. Main thread just supervises.
2. **Record.** While a run is active, `Recorder` uses `ffmpeg` to pull the
   robot's HLS feed (`http://<ip>:31950/hls/stream.m3u8`) into a rolling buffer
   of `.ts` segments, pruned to the last ~3 min.
3. **Detect.** `RunLifecycle` + `TriggerEvaluator` watch run status and fire an
   incident on: a new **command error**, entering **error recovery**
   (`awaiting-recovery*`), or a **failed** run. A cooldown prevents duplicate
   clips.
4. **Capture.** On an incident, `IncidentHandler.save_and_notify` keeps
   recording briefly (`post_error_seconds`), stops ffmpeg, concatenates the
   recent segments into one `.mp4`, and fetches the robot's full logs as a
   `.zip` via abr-testing's `get_logs`. Old incident folders are pruned to
   `max_clips`.
5. **Notify.** `SlackNotifier` posts a parent message to the configured Slack
   channel, then uploads the `.mp4` + logs `.zip` **into that thread**.
6. **Analyze.** In a background thread (so it never blocks polling),
   `_post_analysis` calls
   `ai_analysis.analyze_video(clip_path, GEMINI_API_KEY, log_zip)`.
   That uploads the clip to Gemini, waits for it to finish processing, and calls
   `gemini-3.5-flash` with a system prompt that makes it an expert lab-automation
   video analyst using the A1–D3 deck coordinate grid. The robot's text logs are
   pulled out of the `get_logs` zip with stdlib `zipfile` (`_extract_logs`:
   tail-biased, size-capped, api/server logs first) and attached as **supporting
   evidence** — the video stays the primary source. Gemini returns a short
   **Error** + **Suggested Fix**, which is posted back as a reply in the same
   Slack thread. If the logs zip is missing or unreadable, analysis proceeds on
   the video alone.

## Lifecycle Slack messages

Besides error clips, the monitor posts: `:rocket:` run started,
`:eyes:` entered error recovery (instant, before the clip),
`:tada:` run finished.

## Config & secrets

- Launched with `--storage-directory` (holds config, clips, recordings) and
  `--config` (defaults to `config.yaml`). Relative paths in the config resolve
  against the storage dir.
- The Slack bot token comes from `notify.token_ini` / `token_file` (shared) or a
  per-robot `config_ini`. Channels/usernames are per-robot with global fallbacks.
- **`GEMINI_API_KEY`** must be set in the service's environment. If it's absent,
  everything still works — AI analysis is simply skipped and logged.

## Guardrails when editing

- AI analysis must **never break alerting**: `_post_analysis` and log collection
  swallow their own exceptions on purpose. Keep that behavior.
- Keep `ai_analysis.py` free of heavy/robot dependencies (see isolation above).
- ffmpeg must be on PATH; the service exits at startup if it isn't.
