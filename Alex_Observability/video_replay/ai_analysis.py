"""Gemini AI analysis of robot error videos.

This module is dependency-isolated on purpose: it imports only google-genai and
the standard library. It runs OFF the robot inside the Slack analyzer service
(see slack_error_analyzer_api.py), so google-genai and its heavy transitive
dependencies (pydantic, anyio, httpx, ...) never touch the robot-server
environment.
"""
import os
import textwrap
import time
import zipfile

from google import genai
from google.genai import errors, types

# Logs are collected tail-first (errors happen at the end of a run) and capped so
# a single noisy run can't blow up the request. api/server logs carry the most
# signal for protocol errors, so they're read first.
_LOG_PRIORITY = ("api", "server", "serial", "touchscreen", "weston")
_MAX_CHARS_PER_LOG = 20000
_MAX_CHARS_TOTAL = 60000

# Gemini periodically returns 503 UNAVAILABLE ("high demand") on generate_content.
# The video is already uploaded by then, so we just retry the model call rather
# than redoing the upload, backing off exponentially: 3s, 6s, 12s.
_GENERATE_MAX_ATTEMPTS = 4
_GENERATE_RETRY_BASE_SLEEP = 3  # seconds; doubled each retry


def _extract_logs(logs_path: str | None) -> str | None:
    """Pull the tail of each .log file out of a get_logs zip as one text blob.

    Uses only stdlib zipfile to keep this module dependency-isolated. Returns
    None (and never raises) if the zip is missing/unreadable or has no logs, so
    a bad logs archive can't break analysis.
    """
    if not logs_path or not os.path.exists(logs_path):
        return None

    def rank(name: str) -> int:
        base = os.path.basename(name).lower()
        for i, key in enumerate(_LOG_PRIORITY):
            if key in base:
                return i
        return len(_LOG_PRIORITY)

    chunks: list[str] = []
    total = 0
    try:
        with zipfile.ZipFile(logs_path) as zf:
            names = sorted(
                (n for n in zf.namelist() if n.lower().endswith(".log")),
                key=rank,
            )
            for name in names:
                if total >= _MAX_CHARS_TOTAL:
                    break
                data = zf.read(name).decode("utf-8", errors="replace")
                if len(data) > _MAX_CHARS_PER_LOG:
                    data = "...[earlier lines truncated]...\n" + data[-_MAX_CHARS_PER_LOG:]
                block = f"===== {os.path.basename(name)} =====\n{data}\n"
                block = block[: _MAX_CHARS_TOTAL - total]
                chunks.append(block)
                total += len(block)
    except Exception:  # noqa: BLE001 - a bad zip must never break analysis
        return None

    return "".join(chunks) if chunks else None


def analyze_video(
    video_path: str, api_key: str, logs_path: str | None = None
) -> str | None:
    """Upload a video to Gemini and return a structured error analysis.

    If ``logs_path`` points to a get_logs zip, the robot's text logs are attached
    as supporting evidence alongside the clip.
    """
    client = genai.Client(api_key=api_key)
    video_file = client.files.upload(file=video_path)

    while video_file.state == types.FileState.PROCESSING:
        time.sleep(2)
        video_file = client.files.get(name=video_file.name)

    if video_file.state != types.FileState.ACTIVE:
        raise RuntimeError(
            f"Video file failed to process: state={video_file.state}, "
            f"error={getattr(video_file, 'error', None)}"
        )

    system_prompt = textwrap.dedent("""
        Purpose
        You are an expert AI Video Analyst specializing in laboratory automation and
        robotic liquid handling systems. Your objective is to review top-down video
        clips of an automated liquid handling deck, identify the operational error or
        run abortion, and briefly describe what went wrong.

        Deck Layout Reference
        The deck is a 4x3 grid of 12 slots. Rows are named with letters A-D and
        columns are named with numbers 1-3, so every slot has a coordinate of the
        form <letter><number>, ranging from A1 to D3 (A1, A2, A3, B1, B2, B3, C1,
        C2, C3, D1, D2, D3). Row A is at the back of the deck (farthest from the
        operator), row D is at the front (nearest the operator); column 1 is on the
        left and column 3 is on the right. Because the video is top-down, use this
        coordinate system to locate deck elements. Always refer to a location by its
        specific slot coordinate (e.g., "slot A1", "slot D3") instead of vague
        directions like "top right" or "the left side".

        Output Format
        Respond with exactly two short parts and nothing else:

        **Error:** 2-3 sentences describing what went wrong. Name the error, the
        deck elements involved (e.g., tip racks, well plates, troughs) and their
        specific slot coordinate, and the robot's relevant behavior.

        **Suggested Fix:** 1-2 sentences suggesting how to resolve the underlying
        issue so normal automated operation can resume.

        Guidelines
        Objective & Technical: Use precise laboratory and robotics terminology
        (e.g., robotic gantry, deck slot coordinates like A1-D3, pipetting head,
        optical/physical error boundary, flush and locked).

        Concise: Keep the total response to a few sentences. Do not describe human
        intervention, do not add extra sections, and avoid dense blocks of text.

        No Speculation: Base your analysis on the visual evidence in the video
        clip, focusing on spatial orientation, alignment, and physical
        interactions. Robot text logs (api/server/serial logs) may also be
        attached; use them as supporting evidence to corroborate and precisely
        name the error, but treat the video as the primary source for spatial and
        physical detail and do not invent details absent from both.

        Example Reference (Few-Shot Grounding)
        **Error:** Tip Rack Misalignment. The robot's gantry moved toward the purple
        pipette tip rack in slot B1, detected a spacing/alignment issue (or reached an
        optical/physical error boundary), and returned to its resting position because
        the tip box was not properly seated in its deck slot.

        **Suggested Fix:** Re-seat the tip box in slot B1 so it sits flush and locked
        in its deck slot, allowing the pipetting head to align accurately with the
        tips.
        """).strip()

    user_prompt = textwrap.dedent("""
        Analyze the attached top-down video clip of the automated liquid handling
        deck. Identify the point where the protocol run stalls, aborts, or otherwise
        deviates from normal automated operation.

        Respond with the "Error" and "Suggested Fix" parts exactly as defined in the
        system instructions: 2-3 sentences on what went wrong followed by a brief
        suggested fix. Keep it concise and do not add any other sections.
        """).strip()

    contents: list[object] = [video_file]
    logs_text = _extract_logs(logs_path)
    if logs_text:
        contents.append(
            "Robot text logs (most recent lines) captured around the incident, "
            "provided as supporting evidence:\n\n" + logs_text
        )
    contents.append(user_prompt)

    for attempt in range(1, _GENERATE_MAX_ATTEMPTS + 1):
        try:
            response = client.models.generate_content(
                model="gemini-3.5-flash",
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2,
                ),
            )
            return response.text
        except errors.ServerError as exc:
            # 5xx (e.g. 503 UNAVAILABLE "high demand") is transient. The video is
            # already uploaded, so retry only the model call after a short pause.
            if attempt == _GENERATE_MAX_ATTEMPTS:
                raise
            sleep_s = _GENERATE_RETRY_BASE_SLEEP * 2 ** (attempt - 1)
            print(
                f"Gemini generate_content failed ({exc}); "
                f"retrying in {sleep_s}s "
                f"(attempt {attempt}/{_GENERATE_MAX_ATTEMPTS})"
            )
            time.sleep(sleep_s)

    return None


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print(
            "usage: python -m abr_testing.automation.ai_analysis "
            "<video_path> [logs_zip]",
            file=sys.stderr,
        )
        sys.exit(2)
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY environment variable is not set", file=sys.stderr)
        sys.exit(2)
    logs_arg = sys.argv[2] if len(sys.argv) > 2 else None
    result = analyze_video(sys.argv[1], key, logs_arg)
    if not result:
        print("No analysis returned", file=sys.stderr)
        sys.exit(1)
    print(result)