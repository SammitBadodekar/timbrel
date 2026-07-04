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
