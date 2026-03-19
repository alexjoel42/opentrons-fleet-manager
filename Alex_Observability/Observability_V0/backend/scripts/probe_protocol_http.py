#!/usr/bin/env python3
"""Probe protocol endpoints. Usage: python probe_protocol_http.py IP PROTOCOL_ID [filename.py]"""
import sys
from urllib.parse import quote
import httpx

ip = sys.argv[1]
pid = sys.argv[2]
filename = sys.argv[3] if len(sys.argv) > 3 else None
port = 31950
base = f"http://{ip}:{port}"

paths = [
    f"protocols/{pid}",
    f"protocols/{pid}/",
    f"protocols/{pid}/files",
    f"protocols/{pid}/download",
    f"protocols/{pid}/content",
]
if filename:
    paths.extend([
        f"protocols/{pid}/files/{quote(filename, safe='')}",
        f"protocols/{pid}/files/{filename}",
    ])


r = httpx.get(f"{base}/{paths[0]}", timeout=10)
print(r.status_code, paths[0])
print(r.text)
