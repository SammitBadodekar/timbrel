"""Stdio dispatch loop: read one JSON request per line, handle, repeat."""

from __future__ import annotations

import json
import signal
import sys
import traceback
from typing import Any, Optional

from . import __version__, emit

# The in-flight separation worker, so a SIGTERM to the sidecar (Electron's
# dispose) takes the job down with it instead of orphaning a multi-GB process.
_worker: Optional[Any] = None


def _terminate_worker_and_exit(signum: int, _frame: Any) -> None:
    if _worker is not None and _worker.is_alive():
        _worker.terminate()
    sys.exit(128 + signum)


def _child_separate(req: dict[str, Any]) -> None:
    """Worker-process entry point (top-level so `spawn` can import it)."""
    emit.bind_channel()
    try:
        from .separate import run_separation

        run_separation(req)
    except Exception as exc:
        emit.error(str(exc), job_id=req.get("jobId"))
        emit.log("error", traceback.format_exc())


def _run_separation(req: dict[str, Any]) -> None:
    """Run a separation job in a worker process that exits when done.

    Torch never returns its allocator caches (MPS/CUDA) or import footprint to
    the OS, so an in-process job leaves this long-lived sidecar idling at a
    multi-GB footprint. A worker that exits gives every byte back, and a hard
    crash in torch/Metal kills only the worker, not the dispatch loop. The
    worker inherits our real stdout, so its protocol events stream to Electron
    directly; we stay quiet until it exits.
    """
    import multiprocessing as mp

    global _worker

    ctx = mp.get_context("spawn")  # fork is unsafe under torch/Metal
    proc = ctx.Process(target=_child_separate, args=(req,), daemon=True)
    proc.start()
    _worker = proc
    try:
        proc.join()
    finally:
        _worker = None
    if proc.exitcode != 0:
        emit.error(
            f"separation worker died with exit code {proc.exitcode}",
            job_id=req.get("jobId"),
        )


def _handle(req: dict[str, Any]) -> None:
    cmd = req.get("cmd")
    if cmd == "ping":
        emit.log("info", "pong")
    elif cmd == "separate":
        _run_separation(req)
    elif cmd == "cancel":
        # Cooperative cancellation is a v0.2 concern; v0.1 runs one job at a time.
        emit.log("warn", "cancel is not supported in v0.1")
    else:
        emit.error(f"unknown cmd: {cmd!r}", job_id=req.get("jobId"))


def main() -> int:
    emit.bind_channel()
    signal.signal(signal.SIGTERM, _terminate_worker_and_exit)
    signal.signal(signal.SIGINT, _terminate_worker_and_exit)

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
