# PyInstaller spec for the Timbrel sidecar.
#
# Torch / Demucs / librosa / soundfile drag in native libs, data files and lazy
# imports that PyInstaller can't discover on its own, so we `collect_all` the
# heavy packages. This is a *starter* spec: expect to iterate per-platform during
# the v0.4 packaging pass (DECISIONS.md → Build sequence).
#
#   pyinstaller timbrel-sidecar.spec
#
# Produces dist/timbrel-sidecar/ (onedir) — zip it and publish to Releases; the
# Electron app downloads and unpacks it on first run.

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("demucs", "torch", "torchaudio", "librosa", "soundfile", "lazy_loader", "julius", "openunmix"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        # Optional/transitive packages may not all be present; skip cleanly.
        pass

block_cipher = None

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="timbrel-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="timbrel-sidecar",
)
