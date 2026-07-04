"""Demucs ``htdemucs_6s`` separation → six FLAC stems, with progress events.

Uses demucs 4.0.1's low-level API (`get_model` / `apply_model` / `save_audio`)
— the packaged release has no `demucs.api` module. Follows demucs' own
normalize-before / denormalize-after recipe from `demucs.separate`.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from . import emit
from .features import detect_features

# Canonical display order (matches @timbrel/core STEM_KINDS).
STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"]


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

    available = [name for name in STEM_ORDER if name in name_to_index]
    paths: dict[str, str] = {}
    for idx, name in enumerate(available):
        emit.progress(job_id, "encoding", idx / len(available), f"Encoding {name}")
        out_path = os.path.join(stems_dir, f"{name}.flac")
        _save_flac(sources[name_to_index[name]], out_path, samplerate)
        paths[name] = out_path
        emit.stem(job_id, name, out_path)

    duration = float(wav.shape[-1]) / float(samplerate)

    if req.get("detectFeatures", True):
        emit.progress(job_id, "detecting-features", 0.0, "Detecting tempo & key")
        try:
            mono = wav.mean(0).cpu().numpy()
            features = detect_features(mono, samplerate)
        except Exception as exc:
            emit.log("warn", f"feature detection failed: {exc}")
            features = {"bpm": None, "key": None, "beatTimes": [], "downbeatTimes": []}
    else:
        features = {"bpm": None, "key": None, "beatTimes": [], "downbeatTimes": []}

    emit.done(job_id, paths, features, duration)
