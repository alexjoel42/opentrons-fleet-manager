"""One-off end-to-end test of the real error-trigger path.

Instead of calling the Slack notifier directly, this drives the same functions
that fire when a real error is detected:

    RobotWatcher._maybe_trigger(run)  ->  _save_and_notify(...)
        -> clip into the incident folder
        -> fetch_robot_logs(...)      (abr-testing get_logs -> .zip)
        -> notifier.notify(...)       (Slack message + uploads in a thread)

For the clip it reuses the newest existing video (copied into the new incident
folder so the folder is self-contained). If no clip exists yet, it records a few
seconds from the live stream instead (needs an active run on the robot).

Run:  ./venv/bin/python _test_slack.py [ROBOT_NAME]
      (defaults to the first robot in config.yaml)
"""
import glob
import os
import shutil
import sys
import threading
import time

from monitor import (
    load_config,
    build_robot_notifier,
    RobotWatcher,
    RunState,
)

cfg = load_config("config.yaml")

# Pick the robot: by name from argv, else the first one in config.yaml.
wanted = sys.argv[1] if len(sys.argv) > 1 else None
robot = next((r for r in cfg.robots if r.name == wanted), None) if wanted else cfg.robots[0]
if robot is None:
    raise SystemExit(f"robot {wanted!r} not found in config.yaml")

cfg.clip.post_error_seconds = 0  # don't wait for a post-error tail in the test

notifier = build_robot_notifier(robot, cfg)
print("robot:", robot.name, robot.ip)
print("notifier:", type(notifier).__name__, "| channel_id:", getattr(notifier, "channel_id", None))

stop_event = threading.Event()
watcher = RobotWatcher(robot, cfg, stop_event, notifier)
watcher.run_state = RunState(run_id="LIVE-SLACK-TEST-0001")

# Source a clip without waiting for a real error.
latest_clip = max(glob.glob(os.path.join(cfg.output_dir, "**", "*.mp4"), recursive=True),
                  key=os.path.getmtime, default=None)
if latest_clip:
    print("reusing latest clip:", latest_clip)

    # Copy the existing clip into the incident folder _save_and_notify creates.
    def _reuse_clip(output_dir, run_id, reason, drop_active=True, base_name=None):
        dest = os.path.join(output_dir, (base_name or "clip") + ".mp4")
        shutil.copy(latest_clip, dest)
        return dest

    watcher.recorder.extract_clip = _reuse_clip
else:
    prebuffer = min(cfg.clip.pre_error_seconds, 3 * cfg.clip.segment_seconds)
    print(f"no existing clip found; recording ~{prebuffer}s live (needs an active run)…")
    watcher.recorder.start()
    time.sleep(prebuffer)
    # fall through to the real extract_clip (recorder is stopped in _save_and_notify)

# Synthesize the run payload the API returns when it enters error recovery,
# then fire the exact trigger path used in production.
fake_run = {
    "id": watcher.run_state.run_id,
    "status": "awaiting-recovery",
    "hasEverEnteredErrorRecovery": True,
    "errors": [
        {
            "id": "test-error-1",
            "errorType": "TestError",
            "detail": "Synthetic error from _test_slack.py",
        }
    ],
}
print("triggering _maybe_trigger(...) -> _save_and_notify(...)")
watcher._maybe_trigger(fake_run)
print("done")
