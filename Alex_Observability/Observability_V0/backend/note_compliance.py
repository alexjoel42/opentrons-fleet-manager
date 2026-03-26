"""Compliance-style note stamping: UTC timestamp prefix on each save."""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone

# Legacy: first line, optional 48-char U+2500 line, then body (still stripped on re-save).
_LEGACY_FIRST_LINE = re.compile(
    r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\] Recorded by: .+$",
)
_LEGACY_SEP = re.compile("^" + ("\u2500" * 48) + "$")

# New format: ``[YYYY-MM-DD HH:MM:SS UTC]:  `` at start of stored text.
_NEW_PREFIX = re.compile(
    r"^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\]: \s*",
)


def strip_compliance_header(text: str) -> str:
    """Remove a previously stamped prefix so re-saves do not stack headers."""
    if not text or not text.strip():
        return ""
    s = text.strip()

    m = _NEW_PREFIX.match(s)
    if m:
        return s[m.end() :].lstrip("\n")

    lines = s.splitlines()
    if not lines:
        return ""
    if _LEGACY_FIRST_LINE.match(lines[0].strip()):
        rest = lines[1:]
        if rest and _LEGACY_SEP.match(rest[0].strip()):
            rest = rest[1:]
        return "\n".join(rest).lstrip("\n")
    return s


def stamp_note_body(body: str, _author: str) -> str:
    """Prepend ``[UTC time]:  `` before user text. ``_author`` is kept for call-site compatibility."""
    rest = strip_compliance_header(body)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    if not rest:
        return f"[{ts}]:  "
    return f"[{ts}]:  {rest}"


def local_operator_name_from_request(request: object | None) -> str:
    """Resolve display name for local (non-JWT) note APIs."""
    if request is not None:
        try:
            h = getattr(request, "headers", None)
            if h is not None:
                for key in ("X-Notes-Operator", "X-Operator-Name"):
                    v = h.get(key)
                    if v and str(v).strip():
                        return str(v).strip()[:500]
        except Exception:
            pass
    return (os.environ.get("NOTES_OPERATOR_NAME") or "Operator").strip()[:500] or "Operator"
