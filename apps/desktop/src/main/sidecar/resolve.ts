/**
 * Resolves how to launch the stem-separation sidecar.
 *
 *  - **Dev:** spawn `python -m timbrel_sidecar` from the repo's `sidecar/` folder
 *    (override the interpreter with `TIMBREL_SIDECAR_PY`, the folder with
 *    `TIMBREL_SIDECAR_DIR`).
 *  - **Prod:** run the PyInstaller-frozen binary, downloaded and unpacked on
 *    first run so the installer itself stays small (DECISIONS.md → Stem engine).
 */
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, existsSync, chmodSync, rmSync, writeFileSync } from 'node:fs'
import { download, extractArchive } from '../setup/net'
import type { SetupItem } from '../setup/tools'
import { __sidecarVersion } from './version'

export interface SidecarLaunch {
  command: string
  args: string[]
  cwd?: string
}

// Frozen builds are published by .github/workflows/release-sidecar.yml under
// the `sidecar-v*` tags, one tar.gz per platform (see platformAsset below).
const RELEASE_BASE =
  process.env.TIMBREL_SIDECAR_URL ??
  `https://github.com/SammitBadodekar/timbrel/releases/download/sidecar-v${__sidecarVersion}`

function platformAsset(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const os =
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  return `timbrel-sidecar-${os}-${arch}.tar.gz`
}

function devDir(): string {
  return process.env.TIMBREL_SIDECAR_DIR ?? join(app.getAppPath(), '..', '..', 'sidecar')
}

function installDir(): string {
  return join(app.getPath('userData'), 'sidecar')
}

function installMarker(): string {
  return join(installDir(), `.installed-${__sidecarVersion}`)
}

export function frozenBinaryPath(): string {
  const base = join(installDir(), 'timbrel-sidecar', 'timbrel-sidecar')
  return process.platform === 'win32' ? `${base}.exe` : base
}

export function isSidecarInstalled(): boolean {
  if (!app.isPackaged) return true
  return existsSync(installMarker()) && existsSync(frozenBinaryPath())
}

/** Dev interpreter: explicit override → the sidecar's `.venv` → system python3. */
function devPython(): string {
  if (process.env.TIMBREL_SIDECAR_PY) return process.env.TIMBREL_SIDECAR_PY
  const venvPython =
    process.platform === 'win32'
      ? join(devDir(), '.venv', 'Scripts', 'python.exe')
      : join(devDir(), '.venv', 'bin', 'python')
  return existsSync(venvPython) ? venvPython : 'python3'
}

export function resolveSidecar(): SidecarLaunch {
  if (!app.isPackaged) {
    return { command: devPython(), args: ['-m', 'timbrel_sidecar'], cwd: devDir() }
  }
  return { command: frozenBinaryPath(), args: [] }
}

/** The frozen engine as a first-run setup step (setup/index.ts runs it). */
export function sidecarSetupItem(): SetupItem {
  const approxMB = 200
  return {
    label: 'audio engine',
    approxMB,
    installed: isSidecarInstalled,
    async install(onProgress) {
      const dir = installDir()
      mkdirSync(dir, { recursive: true })
      const archive = join(dir, 'sidecar.tar.gz')

      await download(`${RELEASE_BASE}/${platformAsset()}`, archive, (received, total) =>
        onProgress(total ? received / total : 0, 'downloading')
      )

      onProgress(1, 'extracting')
      await extractArchive(archive, dir)
      rmSync(archive, { force: true })

      if (process.platform !== 'win32') chmodSync(frozenBinaryPath(), 0o755)
      writeFileSync(installMarker(), new Date().toISOString())
    }
  }
}
