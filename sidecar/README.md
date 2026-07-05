# Timbrel sidecar

Frozen Python process that does the heavy lifting: **Demucs `htdemucs_6s`** stem
separation → six FLAC stems, plus local **BPM / key / beat** detection
(librosa). Electron spawns it as a child process and talks to it over stdio with
line-delimited JSON.

## Protocol

One JSON object per line.

- **Requests** (Electron → sidecar, on **stdin**): `separate`, `ping`, `cancel`.
- **Events** (sidecar → Electron, on **stdout**): `ready`, `progress`, `stem`,
  `done`, `error`, `log`.

The authoritative shapes live in TypeScript at
[`@timbrel/core/sidecar`](../packages/core/src/sidecar.ts) — keep the two in sync.
`stderr` is reserved for crash traces and library noise.

Example separate request:

```json
{"cmd":"separate","jobId":"j1","inputPath":"/abs/in.mp3","outputDir":"/abs/song-id","model":"htdemucs_6s","device":"auto","detectFeatures":true}
```

## Development

```sh
cd sidecar
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run it and paste a request on stdin:
python -m timbrel_sidecar
{"cmd":"separate","jobId":"j1","inputPath":"/path/song.mp3","outputDir":"/tmp/out","model":"htdemucs_6s"}
```

In dev the Electron app spawns `python -m timbrel_sidecar` from this folder (set
`TIMBREL_SIDECAR_PY=/path/to/python`); in production it downloads the frozen
binary on first run.

Each `separate` job runs in a spawned **worker process that exits when done** —
torch never returns its allocator caches (MPS/CUDA) or import footprint to the
OS, so an in-process job would leave the long-lived sidecar idling at a multi-GB
footprint. `tools/memcheck.py` guards this: it runs two separations against the
real sidecar and fails if the settled footprint drifts above baseline
(hardware-dependent — run manually, not in CI).

## Building the frozen binary

```sh
pip install -r requirements-dev.txt
pyinstaller timbrel-sidecar.spec        # → dist/timbrel-sidecar/
```

The spec `collect_all`s torch/demucs/librosa/soundfile. Expect per-platform
iteration during the v0.4 packaging pass. Build on each target OS (macOS arm64,
Windows x64, Linux x64); zip `dist/timbrel-sidecar/` and publish to GitHub
Releases for the first-run downloader to fetch.
