"""Stdio dispatch loop: read one JSON request per line, handle, repeat."""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from . import __version__, emit


def _handle(req: dict[str, Any]) -> None:
    cmd = req.get("cmd")
    if cmd == "ping":
        emit.log("info", "pong")
    elif cmd == "separate":
        from .separate import run_separation

        run_separation(req)
    elif cmd == "cancel":
        # Cooperative cancellation is a v0.2 concern; v0.1 runs one job at a time.
        emit.log("warn", "cancel is not supported in v0.1")
    else:
        emit.error(f"unknown cmd: {cmd!r}", job_id=req.get("jobId"))


def main() -> int:
    emit.bind_channel()

    try:
        from .separate import resolve_device

        device = resolve_device(None)
    except Exception as exc:
        device = "cpu"
        emit.log("warn", f"device detection failed, assuming cpu: {exc}")

    emit.ready(__version__, device)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            emit.error(f"malformed request json: {exc}")
            continue

        try:
            _handle(req)
        except Exception as exc:  # never let one bad job kill the sidecar
            emit.error(str(exc), job_id=req.get("jobId"))
            emit.log("error", traceback.format_exc())

    return 0
