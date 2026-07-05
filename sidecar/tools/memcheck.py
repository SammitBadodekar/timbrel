"""Regression check: the sidecar must return to baseline memory between jobs.

Torch's caching allocator holds freed MPS/CUDA memory forever, so before
separation moved into a per-job worker process the sidecar idled at 2-5 GB
after one import. This spawns the real sidecar, runs two separations on a
synthetic 30 s clip, and fails if the settled footprint drifts above baseline.

Hardware-dependent by nature — run manually, not in CI:

    .venv/bin/python tools/memcheck.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time

SIDECAR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTLE_SEC = 15
ALLOWED_GROWTH_MB = 250  # settled footprint may exceed baseline by this much


def _footprint_mb(pid: int) -> float:
    """phys_footprint (Activity Monitor's number — includes Metal/MPS memory).

    Falls back to RSS where /usr/bin/footprint doesn't exist (non-macOS);
    RSS misses driver memory but still catches CPU-side retention.
    """
    if sys.platform == "darwin":
        out = subprocess.run(
            ["/usr/bin/footprint", str(pid)], capture_output=True, text=True
        ).stdout
        for line in out.splitlines():
            if "Footprint:" in line:
                val, unit = line.split("Footprint:")[1].split()[:2]
                return float(val) * {"KB": 1 / 1024, "MB": 1.0, "GB": 1024.0}.get(unit, 0)
    out = subprocess.run(
        ["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True
    ).stdout.strip()
    return int(out) / 1024 if out else -1.0


def _make_fixture(path: str) -> None:
    """30 s stereo clip: a chord plus 120 bpm noise bursts (beats to detect)."""
    import numpy as np
    import soundfile as sf

    sr = 44100
    t = np.arange(sr * 30) / sr
    sig = sum(0.15 * np.sin(2 * np.pi * f * t) for f in (110.0, 220.0, 330.0))
    rng = np.random.default_rng(42)
    for b in np.arange(0, 30, 0.5):
        i, n = int(b * sr), int(0.05 * sr)
        burst = rng.normal(0, 0.3, min(n, len(t) - i))
        sig[i : i + len(burst)] += burst * np.linspace(1, 0, len(burst))
    sig = np.clip(sig, -1, 1).astype(np.float32)
    sf.write(path, np.stack([sig, sig * 0.9], axis=1), sr)


def main() -> int:
    workdir = tempfile.mkdtemp(prefix="timbrel-memcheck-")
    fixture = os.path.join(workdir, "fixture.wav")
    _make_fixture(fixture)

    proc = subprocess.Popen(
        [sys.executable, "-m", "timbrel_sidecar"],
        cwd=SIDECAR_DIR,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    peak = 0.0
    sampling = True

    def sampler() -> None:
        nonlocal peak
        while sampling and proc.poll() is None:
            kids = subprocess.run(
                ["pgrep", "-P", str(proc.pid)], capture_output=True, text=True
            ).stdout.split()
            pids = [proc.pid] + [int(k) for k in kids]
            peak = max(peak, sum(max(_footprint_mb(p), 0) for p in pids))
            time.sleep(1.0)

    threading.Thread(target=sampler, daemon=True).start()

    def wait_for(name: str, timeout: float = 600) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError("sidecar died")
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("event") == "error":
                raise RuntimeError(f"sidecar error: {obj.get('message')}")
            if obj.get("event") == name:
                return obj
        raise TimeoutError(f"no {name} within {timeout}s")

    wait_for("ready")
    time.sleep(2)
    baseline = _footprint_mb(proc.pid)
    print(f"baseline footprint: {baseline:6.0f} MB")

    failed = False
    for job in (1, 2):
        peak = 0.0
        req = {
            "cmd": "separate",
            "jobId": f"memcheck-{job}",
            "inputPath": fixture,
            "outputDir": os.path.join(workdir, f"job{job}"),
        }
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()
        wait_for("done")
        time.sleep(SETTLE_SEC)
        settled = _footprint_mb(proc.pid)
        ok = settled <= baseline + ALLOWED_GROWTH_MB
        failed |= not ok
        print(
            f"job {job}: peak {peak:6.0f} MB   settled(+{SETTLE_SEC}s) {settled:6.0f} MB   "
            f"{'OK' if ok else f'FAIL (> baseline + {ALLOWED_GROWTH_MB} MB)'}"
        )

    proc.stdin.close()
    proc.wait(timeout=30)
    print("FAIL" if failed else "PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
