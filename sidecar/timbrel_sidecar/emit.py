"""Line-delimited JSON event emitter (sidecar -> Electron).

The protocol lives on the process's *original* stdout. Because Torch / Demucs /
librosa are chatty and may print to stdout, we capture the real stdout as our
private protocol channel and redirect ``sys.stdout`` to stderr so nothing can
corrupt the JSON stream.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any, Optional

_lock = threading.Lock()
_channel = sys.stdout


def bind_channel() -> None:
    """Capture the real stdout for the protocol and mute library stdout noise."""
    global _channel
    _channel = sys.stdout
    sys.stdout = sys.stderr


def emit(obj: dict[str, Any]) -> None:
    line = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    with _lock:
        _channel.write(line + "\n")
        _channel.flush()


def ready(version: str, device: str) -> None:
    emit({"event": "ready", "version": version, "device": device})


def progress(
    job_id: str, stage: str, value: float, message: Optional[str] = None
) -> None:
    obj: dict[str, Any] = {
        "event": "progress",
        "jobId": job_id,
        "stage": stage,
        "progress": round(max(0.0, min(1.0, float(value))), 4),
    }
    if message:
        obj["message"] = message
    emit(obj)


def stem(job_id: str, kind: str, path: str) -> None:
    emit({"event": "stem", "jobId": job_id, "kind": kind, "path": path})


def done(
    job_id: str, stems: dict[str, str], features: dict[str, Any], duration: float
) -> None:
    emit(
        {
            "event": "done",
            "jobId": job_id,
            "stems": stems,
            "features": features,
            "durationSec": round(float(duration), 3),
        }
    )


def error(message: Any, job_id: Optional[str] = None, fatal: bool = False) -> None:
    obj: dict[str, Any] = {"event": "error", "message": str(message), "fatal": fatal}
    if job_id:
        obj["jobId"] = job_id
    emit(obj)


def log(level: str, message: Any) -> None:
    emit({"event": "log", "level": level, "message": str(message)})
