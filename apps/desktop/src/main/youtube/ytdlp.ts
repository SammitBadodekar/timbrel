/**
 * The YouTube acquisition layer: search + download via `yt-dlp`. This is the
 * primary way audio enters Timbrel (ViMusic-style direct search — see
 * DECISIONS.md). Spotify import (parked) reuses the download half.
 *
 *  - **Dev:** `yt-dlp` from PATH (override with `TIMBREL_YTDLP`).
 *  - **Prod:** a self-updating `yt-dlp` unpacked into resources — same
 *    download-on-first-run shape as the sidecar/ffmpeg (v0.4 packaging TODO);
 *    for now prod also falls back to PATH.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { YtCandidate } from '@timbrel/core'

/** Resolve the yt-dlp executable: explicit override → bundled → PATH. */
export function resolveYtDlp(): string {
  if (process.env.TIMBREL_YTDLP) return process.env.TIMBREL_YTDLP
  // TODO(v0.4): ship yt-dlp in resources and self-update on first run.
  const bundled = join(
    process.resourcesPath ?? '',
    'yt-dlp',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  )
  if (app.isPackaged && existsSync(bundled)) return bundled
  return 'yt-dlp'
}

function ytError(err: NodeJS.ErrnoException): Error {
  return new Error(
    err.code === 'ENOENT'
      ? 'yt-dlp was not found. Install it (e.g. `brew install yt-dlp`) or set TIMBREL_YTDLP.'
      : `yt-dlp failed to start: ${err.message}`
  )
}

/**
 * Session cache of search results. A yt-dlp spawn is a Python cold start
 * (hundreds of ms) before any network happens, so repeat searches — retyping,
 * going back to a previous query — resolve instantly instead of re-paying it.
 */
const searchCache = new Map<string, YtCandidate[]>()
const SEARCH_CACHE_MAX = 50

/**
 * Search YouTube for `query` and return up to `limit` candidates (metadata
 * only — a *flat* search, so it's fast and still reports duration/thumbnail).
 */
export async function searchYouTube(query: string, limit = 10): Promise<YtCandidate[]> {
  const cacheKey = `${limit}:${query.toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  const results = await runSearch(query, limit)
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }
  searchCache.set(cacheKey, results)
  return results
}

function runSearch(query: string, limit: number): Promise<YtCandidate[]> {
  // Tab-separated so `|`/`-` in titles can't break field parsing.
  const args = [
    '--no-warnings',
    '--flat-playlist',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnails.0.url)s',
    `ytsearch${limit}:${query}`
  ]
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveYtDlp(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (c: Buffer) => (out += c.toString()))
    proc.stderr.on('data', (c: Buffer) => (err += c.toString()))
    proc.on('error', (e) => reject(ytError(e as NodeJS.ErrnoException)))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `yt-dlp search failed (exit ${code})`))
        return
      }
      const cell = (v: string | undefined): string | null => (v && v !== 'NA' ? v : null)
      resolve(
        out
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [id, title, duration, channel, thumb] = line.split('\t')
            const dur = duration && duration !== 'NA' ? Number(duration) : NaN
            return {
              id: id ?? '',
              title: title ?? '',
              durationSec: Number.isFinite(dur) ? dur : null,
              channel: cell(channel),
              thumbnailUrl: cell(thumb)
            }
          })
          .filter((c) => c.id)
      )
    })
  })
}

/**
 * Download a YouTube video's audio, extracted to `original.m4a` in `destDir`
 * (m4a keeps the pipeline uniform with local uploads; demucs decodes it via
 * ffmpeg). `onProgress` receives 0..1 as the download streams. Resolves with the
 * final file path.
 */
export function downloadYtAudio(
  youtubeId: string,
  destDir: string,
  onProgress: (progress: number) => void
): Promise<string> {
  const destPath = join(destDir, 'original.m4a')
  const args = [
    '--no-warnings',
    '--no-playlist',
    '-f',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'm4a',
    '-o',
    join(destDir, 'original.%(ext)s'),
    // Machine-readable progress; only the download phase emits these lines.
    '--newline',
    '--progress-template',
    'download:TIMBREL_PROG %(progress._percent_str)s',
    `https://www.youtube.com/watch?v=${youtubeId}`
  ]
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveYtDlp(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const m = line.match(/TIMBREL_PROG\s+([\d.]+)%/)
        if (m) onProgress(Math.min(1, Number(m[1]) / 100))
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
    proc.on('error', (e) => reject(ytError(e as NodeJS.ErrnoException)))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `yt-dlp download failed (exit ${code})`))
        return
      }
      if (!existsSync(destPath)) {
        reject(new Error('yt-dlp finished but produced no audio file.'))
        return
      }
      resolve(destPath)
    })
  })
}
