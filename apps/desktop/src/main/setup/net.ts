/**
 * Download + archive helpers for the first-run installer (setup/index.ts).
 * Plain node:https (follows redirects) and the platform `tar` — bsdtar ships
 * on Windows 10+, macOS and Linux, and auto-detects zip/tar.gz/tar.xz.
 */
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { get as httpsGet } from 'node:https'

/**
 * Download `url` to `dest`. `onProgress` receives (receivedBytes, totalBytes);
 * `totalBytes` is 0 when the server doesn't send a Content-Length.
 */
export function download(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        // Location may be relative (e.g. ffmpeg.martin-riedl.de) — resolve it.
        const next = new URL(res.headers.location, url).toString()
        download(next, dest, onProgress).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`download failed (HTTP ${status}) for ${url}`))
        return
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let received = 0
      const file = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress(received, total)
      })
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
      file.on('error', reject)
      // pipe() doesn't forward source errors — without this a connection drop
      // mid-download leaves the promise pending forever.
      res.on('error', reject)
    })
    request.on('error', reject)
  })
}

/** Extract any tar/zip archive with the platform `tar` (bsdtar auto-detects). */
export function extractArchive(archive: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xf', archive, '-C', destDir], (err) => (err ? reject(err) : resolve()))
  })
}

/** Depth-first search for a file named `name` under `dir`; null if absent. */
export async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findFile(path, name)
      if (found) return found
    }
  }
  return null
}
