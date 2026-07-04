import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** SHA-256 of a file, streamed so large audio files don't blow up memory. */
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Stable, filesystem-friendly song id derived from a content hash. */
export function songIdFromHash(hash: string): string {
  return hash.slice(0, 20)
}

/**
 * Stable song id for a Spotify import — derived from the track's ISRC (a track's
 * globally-unique recording code) when present, else its Spotify id. Ensures the
 * same track is never re-downloaded or re-separated (DECISIONS.md → Storage).
 * The `sp` prefix distinguishes imports from content-hash upload ids on disk.
 */
export function songIdFromSpotify(track: { isrc: string | null; spotifyId: string }): string {
  const seed = track.isrc ? `isrc:${track.isrc}` : `spid:${track.spotifyId}`
  return 'sp' + createHash('sha256').update(seed).digest('hex').slice(0, 18)
}

/**
 * Stable song id for a direct YouTube download — derived from the video id so
 * the same video is never re-downloaded or re-separated. The `yt` prefix
 * distinguishes imports from content-hash upload ids on disk.
 */
export function songIdFromYoutube(youtubeId: string): string {
  return 'yt' + createHash('sha256').update(`yt:${youtubeId}`).digest('hex').slice(0, 18)
}
