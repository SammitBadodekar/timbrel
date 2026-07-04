/**
 * End-to-end verification of the YT-match heuristic against LIVE yt-dlp,
 * exercising the real core scoring code (packages/core/src/match.ts) exactly the
 * way apps/desktop/src/main/spotify/download.ts does.
 *
 * Run from the repo root:  npx tsx scratchpad/verify-match.mts
 * Requires `yt-dlp` on PATH. Prints, per track, every scored candidate and the
 * pick — sanity-check that the right recording wins and meme/loop/live
 * re-uploads lose.
 */
import { spawn } from 'node:child_process'
import {
  buildYtSearchQuery,
  pickBestYtCandidate,
  scoreYtCandidate,
  type SpotifyTrack,
  type YtCandidate
} from '../packages/core/src/match.ts'

function search(track: SpotifyTrack): Promise<YtCandidate[]> {
  const args = [
    '--no-warnings',
    '--flat-playlist',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(channel)s',
    `ytsearch6:${buildYtSearchQuery(track)}`
  ]
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (c) => (out += c.toString()))
    proc.stderr.on('data', (c) => (err += c.toString()))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `exit ${code}`))
      resolve(
        out
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [id, title, duration, channel] = line.split('\t')
            const dur = duration && duration !== 'NA' ? Number(duration) : NaN
            return {
              id: id ?? '',
              title: title ?? '',
              durationSec: Number.isFinite(dur) ? dur : null,
              channel: channel && channel !== 'NA' ? channel : null
            }
          })
      )
    })
  })
}

const tracks: SpotifyTrack[] = [
  { id: '3AJwUDP919kvQ9QcozQPxg', name: 'Yellow', artists: ['Coldplay'], album: 'Parachutes', durationSec: 269, isrc: 'GBAYE0000578', imageUrl: null },
  { id: '69kOkLUCkxIZYexIgSG8rq', name: 'Get Lucky', artists: ['Daft Punk', 'Pharrell Williams'], album: 'Random Access Memories', durationSec: 369, isrc: null, imageUrl: null },
  { id: '0VjIjW4GlUZAMYd2vXMi3b', name: 'Blinding Lights', artists: ['The Weeknd'], album: 'After Hours', durationSec: 200, isrc: null, imageUrl: null }
]

for (const track of tracks) {
  console.log(`\n=== ${track.artists[0]} — ${track.name}  (want ~${track.durationSec}s) ===`)
  console.log(`    query: "${buildYtSearchQuery(track)}"`)
  const candidates = await search(track)
  const scored = candidates
    .map((c) => ({ c, score: scoreYtCandidate(c, track) }))
    .sort((a, b) => b.score - a.score)
  for (const { c, score } of scored) {
    console.log(`    [${String(score).padStart(4)}] ${c.durationSec ?? '?'}s  ${c.title}  — ${c.channel} (${c.id})`)
  }
  const best = pickBestYtCandidate(candidates, track)
  console.log(`  → PICK: ${best ? `${best.title} (${best.id}, ${best.durationSec}s)` : 'NO MATCH'}`)
}
