/**
 * A privileged `timbrel-media://` scheme that streams files from the library to
 * the sandboxed renderer. The renderer fetches these URLs and hands the bytes to
 * Web Audio's `decodeAudioData` (Chromium decodes FLAC natively), so we never
 * expose raw `file://` access.
 *
 *   timbrel-media://<songId>/<relative/path.flac>
 *
 * The renderer origin differs from this scheme (http://localhost in dev,
 * file:// in prod), so the response carries an explicit CORS header.
 */
import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join, normalize, sep, extname } from 'node:path'
import { libraryRoot } from './lib/paths'

export const MEDIA_SCHEME = 'timbrel-media'

const MIME_BY_EXT: Record<string, string> = {
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff'
}

/** Must run before `app.whenReady()`. */
export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Must run after `app.whenReady()`. */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    const songId = url.hostname
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')

    const root = normalize(join(libraryRoot(), songId))
    const filePath = normalize(join(root, rel))

    // Contain within the song folder — reject path traversal.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    if (!existsSync(filePath)) {
      return new Response('not found', { status: 404 })
    }

    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(statSync(filePath).size),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      }
    })
  })
}

export function mediaUrl(songId: string, rel: string): string {
  return `${MEDIA_SCHEME}://${songId}/${rel}`
}
