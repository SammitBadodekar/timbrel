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
import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, existsSync, chmodSync, rmSync, writeFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { __sidecarVersion } from './version'

export interface SidecarLaunch {
  command: string
  args: string[]
  cwd?: string
}

// TODO(v0.4): point at the real GitHub Releases asset once the frozen builds ship.
const RELEASE_BASE =
  process.env.TIMBREL_SIDECAR_URL ??
  `https://github.com/timbrel/timbrel/releases/download/sidecar-v${__sidecarVersion}`

function platformAsset(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const os =
    process.platform === 'darwin'
      ? 'macos'
      : process.platform === 'win32'
        ? 'windows'
        : 'linux'
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

export type DownloadStage = 'downloading' | 'extracting'

/** Download + unpack the frozen sidecar on first run. No-op in dev. */
export async function ensureSidecar(
  onProgress: (progress: number, stage: DownloadStage) => void
): Promise<void> {
  if (!app.isPackaged || isSidecarInstalled()) return

  const dir = installDir()
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, 'sidecar.tar.gz')

  onProgress(0, 'downloading')
  await download(`${RELEASE_BASE}/${platformAsset()}`, archive, (p) =>
    onProgress(p, 'downloading')
  )

  onProgress(1, 'extracting')
  await extractTarGz(archive, dir)
  rmSync(archive, { force: true })

  if (process.platform !== 'win32') chmodSync(frozenBinaryPath(), 0o755)
  writeFileSync(installMarker(), new Date().toISOString())
}

function download(
  url: string,
  dest: string,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        download(res.headers.location, dest, onProgress).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`sidecar download failed (HTTP ${status})`))
        return
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let received = 0
      const file = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total) onProgress(received / total)
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
    })
    request.on('error', reject)
  })
}

/** Extract with the platform `tar` (bsdtar ships on Windows 10+, macOS, Linux). */
function extractTarGz(archive: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', destDir], (err) =>
      err ? reject(err) : resolve()
    )
  })
}
