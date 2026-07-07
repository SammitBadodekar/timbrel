/**
 * The CLI tools Timbrel shells out to — yt-dlp (search/download), ffmpeg and
 * ffprobe (yt-dlp post-processing, demucs decode, export encode). None can be
 * assumed on a user's machine, and a packaged GUI app doesn't see Homebrew's
 * PATH anyway, so they're downloaded on first run into `userData/tools`
 * (alongside the sidecar engine — see setup/index.ts) from:
 *
 *  - yt-dlp: its official GitHub releases (`latest`, one binary per platform).
 *  - ffmpeg/ffprobe, macOS: the static builds linked from ffmpeg.org
 *    (ffmpeg.martin-riedl.de), one zip per binary.
 *  - ffmpeg/ffprobe, Windows/Linux: BtbN/FFmpeg-Builds (the builds yt-dlp
 *    recommends), one archive containing both.
 */
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { download, extractArchive, findFile } from './net'

export function toolsDir(): string {
  return join(app.getPath('userData'), 'tools')
}

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

export function installedToolPath(name: 'ffmpeg' | 'ffprobe'): string {
  return join(toolsDir(), exe(name))
}

/**
 * The installed yt-dlp executable. On macOS this is the *onedir* build inside
 * `tools/yt-dlp-dir` — the single-file build re-extracts itself and gets
 * re-scanned by Gatekeeper on every spawn (~7 s before any work); the onedir
 * build pays that once at install and starts in ~0.2 s.
 */
export function ytDlpBinaryPath(): string {
  if (process.platform === 'darwin') return join(toolsDir(), 'yt-dlp-dir', 'yt-dlp_macos')
  return join(toolsDir(), exe('yt-dlp'))
}

/**
 * Resolve a tool executable: explicit env override → the first-run install →
 * bare name (PATH). The PATH fallback keeps dev working off brew installs.
 */
export function resolveTool(name: 'yt-dlp' | 'ffmpeg' | 'ffprobe', envVar?: string): string {
  const override = envVar && process.env[envVar]
  if (override) return override
  const installed = name === 'yt-dlp' ? ytDlpBinaryPath() : installedToolPath(name)
  return existsSync(installed) ? installed : name
}

/**
 * Environment for child processes that spawn tools by bare name — yt-dlp
 * invoking ffmpeg for audio extraction, demucs (inside the sidecar) invoking
 * ffmpeg/ffprobe to decode input audio. Prepends the tools dir to PATH.
 */
export function envWithTools(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${toolsDir()}${delimiter}${process.env.PATH ?? ''}` }
}

export function areToolsInstalled(): boolean {
  if (!app.isPackaged) return true
  return (
    existsSync(ytDlpBinaryPath()) &&
    (['ffmpeg', 'ffprobe'] as const).every((t) => existsSync(installedToolPath(t)))
  )
}

export type SetupStage = 'downloading' | 'extracting'

/** One installable unit of the first-run setup, shown as its own progress step. */
export interface SetupItem {
  /** Short human label — "audio engine", "YouTube downloader"… */
  label: string
  /** Rough download size shown in the UI; also scales indeterminate progress. */
  approxMB: number
  installed(): boolean
  install(onProgress: (progress: number, stage: SetupStage) => void): Promise<void>
}

/** progress fraction from byte counts, estimating via approxMB when the
 *  server sends no Content-Length (never claims done until it is). */
function fraction(received: number, total: number, approxMB: number): number {
  if (total) return received / total
  return Math.min(received / (approxMB * 1024 * 1024), 0.95)
}

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/** One throwaway run so macOS's one-time scan of the fresh binary happens
 *  during setup, not on the user's first search. */
function warmUp(bin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--version'], (err) => (err ? reject(err) : resolve()))
  })
}

/** macOS: the onedir zip (see ytDlpBinaryPath for why not the onefile). */
function ytDlpItemMac(): SetupItem {
  const approxMB = 55
  return {
    label: 'YouTube downloader',
    approxMB,
    installed: () => existsSync(ytDlpBinaryPath()),
    async install(onProgress) {
      const dir = toolsDir()
      mkdirSync(dir, { recursive: true })
      const archive = join(dir, 'yt-dlp.zip')
      await download(`${YTDLP_RELEASE}/yt-dlp_macos.zip`, archive, (received, total) =>
        onProgress(fraction(received, total, approxMB), 'downloading')
      )
      onProgress(1, 'extracting')
      const unpack = join(dir, 'yt-dlp-dir')
      rmSync(unpack, { recursive: true, force: true })
      mkdirSync(unpack)
      await extractArchive(archive, unpack)
      rmSync(archive, { force: true })
      chmodSync(ytDlpBinaryPath(), 0o755)
      // Retire the slow onefile binary from installs made before this existed.
      rmSync(join(dir, 'yt-dlp'), { force: true })
      await warmUp(ytDlpBinaryPath())
    }
  }
}

/** Windows/Linux: the single-file official binary. */
function ytDlpItemOneFile(): SetupItem {
  const win = process.platform === 'win32'
  const approxMB = win ? 20 : 40
  return {
    label: 'YouTube downloader',
    approxMB,
    installed: () => existsSync(ytDlpBinaryPath()),
    async install(onProgress) {
      mkdirSync(toolsDir(), { recursive: true })
      const dest = ytDlpBinaryPath()
      // Download beside the final path, then rename: `installed()` checks for
      // the final path, so an interrupted download must never squat on it.
      const partial = `${dest}.download`
      await download(
        `${YTDLP_RELEASE}/${win ? 'yt-dlp.exe' : 'yt-dlp_linux'}`,
        partial,
        (received, total) => onProgress(fraction(received, total, approxMB), 'downloading')
      )
      if (!win) chmodSync(partial, 0o755)
      renameSync(partial, dest)
    }
  }
}

function ytDlpItem(): SetupItem {
  return process.platform === 'darwin' ? ytDlpItemMac() : ytDlpItemOneFile()
}

/** macOS: one static zip per binary, extracted straight into the tools dir. */
function ffmpegItemMac(): SetupItem {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const base = `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release`
  const halves: Array<'ffmpeg' | 'ffprobe'> = ['ffmpeg', 'ffprobe']
  return {
    label: 'audio converter',
    approxMB: 60,
    installed: () => halves.every((name) => existsSync(installedToolPath(name))),
    async install(onProgress) {
      const dir = toolsDir()
      mkdirSync(dir, { recursive: true })
      for (const [i, name] of halves.entries()) {
        const archive = join(dir, `${name}.zip`)
        // Each half owns half the bar: ffmpeg 0→0.5, ffprobe 0.5→1.
        await download(`${base}/${name}.zip`, archive, (received, total) =>
          onProgress(i / 2 + fraction(received, total, 30) / 2, 'downloading')
        )
        onProgress((i + 1) / 2, 'extracting')
        await extractArchive(archive, dir)
        rmSync(archive, { force: true })
        chmodSync(installedToolPath(name), 0o755)
      }
    }
  }
}

/** Windows/Linux: one BtbN archive containing bin/ffmpeg + bin/ffprobe. */
function ffmpegItemBtbn(): SetupItem {
  const win = process.platform === 'win32'
  const asset = win
    ? 'ffmpeg-master-latest-win64-gpl.zip'
    : 'ffmpeg-master-latest-linux64-gpl.tar.xz'
  const approxMB = win ? 165 : 125
  return {
    label: 'audio converter',
    approxMB,
    installed: () =>
      existsSync(installedToolPath('ffmpeg')) && existsSync(installedToolPath('ffprobe')),
    async install(onProgress) {
      const dir = toolsDir()
      const unpack = join(dir, 'ffmpeg-unpack')
      mkdirSync(unpack, { recursive: true })
      const archive = join(dir, asset)
      await download(
        `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${asset}`,
        archive,
        (received, total) => onProgress(fraction(received, total, approxMB), 'downloading')
      )
      onProgress(1, 'extracting')
      await extractArchive(archive, unpack)
      rmSync(archive, { force: true })
      for (const name of ['ffmpeg', 'ffprobe'] as const) {
        const found = await findFile(unpack, exe(name))
        if (!found) throw new Error(`${exe(name)} missing from the ffmpeg archive`)
        renameSync(found, installedToolPath(name))
        if (!win) chmodSync(installedToolPath(name), 0o755)
      }
      rmSync(unpack, { recursive: true, force: true })
    }
  }
}

export function toolSetupItems(): SetupItem[] {
  return [ytDlpItem(), process.platform === 'darwin' ? ffmpegItemMac() : ffmpegItemBtbn()]
}

/**
 * yt-dlp rots as YouTube changes; the standalone binary self-updates in place
 * with `-U`. Fire-and-forget on each launch once installed (never blocks).
 */
export function updateYtDlpInBackground(): void {
  const bin = ytDlpBinaryPath()
  if (!existsSync(bin)) return
  try {
    spawn(bin, ['-U'], { stdio: 'ignore' }).on('error', () => {})
  } catch {
    // best-effort only
  }
}
