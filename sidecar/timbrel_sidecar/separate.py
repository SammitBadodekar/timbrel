"""Demucs ``htdemucs_6s`` separation → six FLAC stems, with progress events.

Uses demucs 4.0.1's low-level API (`get_model` / `apply_model` / `save_audio`)
— the packaged release has no `demucs.api` module. Follows demucs' own
normalize-before / denormalize-after recipe from `demucs.separate`.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from . import emit
from .features import detect_features

# Canonical display order (matches @timbrel/core STEM_KINDS).
STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"]

# Mirror of @timbrel/core peaks.ts PEAK_BUCKETS.
PEAK_BUCKETS = 2000


def _compute_peaks(tensor, buckets: int = PEAK_BUCKETS) -> list[float]:
    """Bucketed max-|sample| envelope of a (channels, frames) tensor.

    Mirrors @timbrel/core `computePeaks` — same bucket boundaries and JS
    `Math.round` semantics — so a sidecar-written peaks.json is interchangeable
    with the renderer's fallback computation.
    """
    import numpy as np

    env = np.abs(tensor.numpy()).max(axis=0)
    frames = env.shape[0]
    if frames == 0:
        return [0.0] * buckets

    step = frames / buckets
    starts = (np.arange(buckets) * step).astype(np.int64)
    ends = np.empty(buckets, dtype=np.int64)
    ends[:-1] = (np.arange(1, buckets) * step).astype(np.int64)
    ends[-1] = frames

    peaks = np.maximum.reduceat(env, starts).astype(np.float64)
    peaks[ends <= starts] = 0.0  # empty bucket (only when frames < buckets)
    peaks = np.minimum(peaks, 1.0)
    peaks = np.floor(peaks * 1000 + 0.5) / 1000  # JS Math.round half-up
    return peaks.tolist()


def _write_peaks_file(sources, name_to_index, names, samplerate, output_dir) -> None:
    """Write peaks.json next to project.json so even the first studio open of a
    fresh import reads cached peaks instead of re-scanning decoded stems."""
    import json

    frames = int(sources.shape[-1])
    peaks = {
        "version": 1,
        "buckets": PEAK_BUCKETS,
        "durationSec": frames / float(samplerate),
        "stems": {n: _compute_peaks(sources[name_to_index[n]]) for n in names},
    }
    with open(os.path.join(output_dir, "peaks.json"), "w") as f:
        json.dump(peaks, f, separators=(",", ":"))


def resolve_device(requested: Optional[str]) -> str:
    """Pick the compute device. Apple Silicon → MPS, NVIDIA → CUDA, else CPU."""
    import torch

    if requested and requested != "auto":
        return requested
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _load_model(model_name: str, device: str):
    from demucs.pretrained import get_model

    model = get_model(model_name)
    model.eval()
    model.to(device)
    return model


def _read_audio(path: str, model):
    from demucs.audio import AudioFile

    return AudioFile(path).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    )


def _save_flac(tensor, path: str, samplerate: int) -> None:
    """Write a (channels, samples) float tensor to 24-bit FLAC via libsndfile.

    Avoids torchaudio's save path, which in 2.11+ requires torchcodec + ffmpeg.
    """
    import numpy as np
    import soundfile as sf

    data = np.clip(tensor.cpu().numpy().T, -1.0, 1.0)  # → (samples, channels)
    sf.write(path, data, samplerate, subtype="PCM_24", format="FLAC")


def run_separation(req: dict[str, Any]) -> None:
    import torch
    from demucs.apply import apply_model

    job_id = req["jobId"]
    input_path = req["inputPath"]
    output_dir = req["outputDir"]
    model_name = req.get("model", "htdemucs_6s")
    device = resolve_device(req.get("device"))

    if not os.path.isfile(input_path):
        emit.error(f"input not found: {input_path}", job_id=job_id)
        return

    emit.progress(job_id, "loading-model", 0.0, f"Loading {model_name} on {device}")
    model = _load_model(model_name, device)

    emit.progress(job_id, "separating", 0.05, "Separating stems")
    wav = _read_audio(input_path, model)
    ref = wav.mean(0)
    normalized = (wav - ref.mean()) / (ref.std() + 1e-8)

    def apply_on(dev: str):
        with torch.no_grad():
            out = apply_model(
                model.to(dev),
                normalized[None].to(dev),
                device=dev,
                split=True,
                overlap=0.25,
                progress=False,
            )
        return out[0]

    try:
        sources = apply_on(device)
    except Exception as exc:  # MPS/CUDA can be flaky — fall back to CPU once.
        if device != "cpu":
            emit.log("warn", f"{device} separation failed ({exc}); retrying on cpu")
            device = "cpu"
            sources = apply_on(device)
        else:
            raise

    sources = (sources * ref.std() + ref.mean()).cpu()

    name_to_index = {name: i for i, name in enumerate(model.sources)}
    samplerate = model.samplerate
    stems_dir = os.path.join(output_dir, "stems")
    os.makedirs(stems_dir, exist_ok=True)

    no_features = {"bpm": None, "key": None, "beatTimes": [], "downbeatTimes": []}

    # Feature detection only needs the original mix, so it runs concurrently
    # with stem encoding (librosa/numpy release the GIL for the heavy parts).
    def detect() -> dict[str, Any]:
        try:
            mono = wav.mean(0).cpu().numpy()
            return detect_features(mono, samplerate)
        except Exception as exc:
            emit.log("warn", f"feature detection failed: {exc}")
            return no_features

    available = [name for name in STEM_ORDER if name in name_to_index]

    with ThreadPoolExecutor(max_workers=8) as pool:
        features_future = (
            pool.submit(detect) if req.get("detectFeatures", True) else None
        )
        peaks_future = pool.submit(
            _write_peaks_file, sources, name_to_index, available, samplerate, output_dir
        )
        stems_dir_futures = {
            pool.submit(
                _save_flac,
                sources[name_to_index[name]],
                os.path.join(stems_dir, f"{name}.flac"),
                samplerate,
            ): name
            for name in available
        }
        paths: dict[str, str] = {}
        for done_count, future in enumerate(as_completed(stems_dir_futures), 1):
            name = stems_dir_futures[future]
            future.result()  # re-raise encode errors
            out_path = os.path.join(stems_dir, f"{name}.flac")
            paths[name] = out_path
            emit.progress(
                job_id, "encoding", done_count / len(available), f"Encoded {name}"
            )
            emit.stem(job_id, name, out_path)

        try:
            peaks_future.result()
        except Exception as exc:  # peaks are a cache — never fail the job
            emit.log("warn", f"peaks generation failed: {exc}")

        if features_future is not None and not features_future.done():
            emit.progress(job_id, "detecting-features", 0.0, "Detecting tempo & key")
        features = features_future.result() if features_future else no_features

    duration = float(wav.shape[-1]) / float(samplerate)
    emit.done(job_id, paths, features, duration)
