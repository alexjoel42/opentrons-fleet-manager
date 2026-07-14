"""Central Slack Events service: posts AI analysis of robot error videos.

A single off-robot HTTP service wired to the ABR Slack app via an Event
Subscription on POST /slack/events. When a robot uploads an error video into an
alert thread, Slack delivers a message event here; the service downloads the
video, runs Gemini analysis, and replies in the same thread.

Slack needs a 200 within ~3s, so the endpoint verifies + acks immediately and
does the slow download/LLM/post work in a background thread.

Env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, GEMINI_API_KEY,
ABR_ALERTS_CHANNEL_ID (optional; restrict to one channel).

Run: pipenv run uvicorn \\
    abr_testing.automation.slack_error_analyzer_api:app --host 0.0.0.0 --port 3000
Then expose the port to Slack over HTTPS and set the Request URL to
https://<your-host>/slack/events.
"""
import json
import os
import tempfile
import urllib.request
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, Request, Response
from slack_sdk import WebClient
from slack_sdk.signature import SignatureVerifier

from abr_testing.automation.ai_analysis import analyze_video

VIDEO_EXTENSIONS = ("mp4", "mov", "avi", "mkv")
ERROR_MARKER = "ended in error"  # must match slack.py:send_error_message
DOWNLOAD_TIMEOUT_S = 120

app = FastAPI()
_client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
_verifier = SignatureVerifier(os.environ["SLACK_SIGNING_SECRET"])
_alerts_channel = os.environ.get("ABR_ALERTS_CHANNEL_ID")
_processed_files: set = set()  # guard against Slack event retries; resets on restart


def _is_video(file_obj: dict) -> bool:
    name = (file_obj.get("name") or "").lower()
    filetype = (file_obj.get("filetype") or "").lower()
    return filetype in VIDEO_EXTENSIONS or name.endswith(
        tuple(f".{ext}" for ext in VIDEO_EXTENSIONS)
    )


def _thread_is_error(channel: str, thread_ts: str) -> bool:
    """True if the thread root is a robot error alert."""
    try:
        resp = _client.conversations_replies(channel=channel, ts=thread_ts, limit=1)
    except Exception as e:
        print(f"Could not fetch thread root {thread_ts}: {e}")
        return False
    messages = resp.get("messages", [])
    return bool(messages) and ERROR_MARKER in (messages[0].get("text") or "").lower()


def _download_file(file_obj: dict) -> Optional[str]:
    """Download a Slack file to a temp path using the bot token."""
    url = file_obj.get("url_private_download") or file_obj.get("url_private")
    if not url:
        return None
    suffix = os.path.splitext(file_obj.get("name") or "")[1] or ".mp4"
    token = os.environ["SLACK_BOT_TOKEN"]
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    fd, path = tempfile.mkstemp(suffix=suffix)
    with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp:
        with os.fdopen(fd, "wb") as f:
            f.write(resp.read())
    return path


def process_event(event: dict) -> None:
    """Download the error video, run AI analysis, and reply in-thread.

    Runs in a background thread so /slack/events can ack Slack within 3s.
    """
    files = event.get("files")
    channel = event.get("channel")
    thread_ts = event.get("thread_ts") or event.get("ts")
    if not files or not channel or not thread_ts:
        return
    if _alerts_channel and channel != _alerts_channel:
        return

    for file_obj in files:
        file_id = file_obj.get("id", "")
        if not _is_video(file_obj) or file_id in _processed_files:
            continue
        if not _thread_is_error(channel, thread_ts):
            continue
        _processed_files.add(file_id)

        video_path = None
        try:
            video_path = _download_file(file_obj)
            if not video_path:
                print(f"No download URL for file {file_id}")
                continue
            analysis = analyze_video(video_path, os.environ["GEMINI_API_KEY"])
        except Exception as e:
            print(f"AI analysis failed for file {file_id}: {e}")
            continue
        finally:
            if video_path:
                try:
                    os.remove(video_path)
                except OSError:
                    pass

        if not analysis:
            continue
        try:
            _client.chat_postMessage(
                channel=channel,
                thread_ts=thread_ts,
                text=f"*AI Video Analysis:*\n{analysis}",
            )
        except Exception as e:
            print(f"Failed to post analysis for file {file_id}: {e}")


@app.post("/slack/events")
async def slack_events(
    request: Request, background_tasks: BackgroundTasks
) -> Response:
    """Verify the Slack request, ack immediately, and offload heavy work."""
    body = await request.body()
    if not _verifier.is_valid_request(body, dict(request.headers)):
        return Response(status_code=401)

    payload = json.loads(body)
    if payload.get("type") == "url_verification":  # one-time Request URL handshake
        return Response(content=payload.get("challenge", ""), media_type="text/plain")

    event = payload.get("event", {})
    if event.get("type") == "message" and event.get("files"):
        background_tasks.add_task(process_event, event)
    return Response(status_code=200)
