"""Local tempo / key / beat detection (librosa for v0.1 → madmom later).

Kept intentionally light: BPM + beat times from ``librosa.beat.beat_track`` and a
Krumhansl-Schmuckler key estimate from the mean chroma vector. Downbeats are
approximated as every fourth beat (assume 4/4) until madmom lands (see
DECISIONS.md → Engine roadmap).
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

# Krumhansl-Schmuckler key profiles.
_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def estimate_key(y: np.ndarray, sr: int) -> Optional[str]:
    import librosa

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = chroma.mean(axis=1)
    if not np.any(profile):
        return None

    best_score = -np.inf
    best_label: Optional[str] = None
    for i in range(12):
        rotated = np.roll(profile, -i)
        for mode, template in (("major", _MAJOR), ("minor", _MINOR)):
            score = float(np.corrcoef(rotated, template)[0, 1])
            if score > best_score:
                best_score = score
                best_label = f"{_PITCHES[i]} {mode}"
    return best_label


def detect_features(y: np.ndarray, sr: int) -> dict[str, Any]:
    import librosa

    y = np.ascontiguousarray(y, dtype=np.float32)

    # NOTE: analysis runs at the native sample rate on purpose. Downsampling to
    # librosa's canonical 22.05 kHz is ~2-4x faster but was measured to change
    # BPM/beat output on real songs (tempo-octave flips, beat drift) — not an
    # acceptable trade for the beat grid. Revisit with the madmom upgrade.
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beats, sr=sr)
    beat_list = [round(float(t), 4) for t in beat_times]
    downbeats = beat_list[::4]  # 4/4 assumption for v0.1

    bpm_val = float(np.atleast_1d(tempo)[0]) if tempo is not None else None

    try:
        key = estimate_key(y, sr)
    except Exception:
        key = None

    return {
        "bpm": round(bpm_val, 2) if bpm_val else None,
        "key": key,
        "beatTimes": beat_list,
        "downbeatTimes": downbeats,
    }
