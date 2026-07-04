/**
 * End-to-end check of the direct-search + lyrics pivot, exercising the REAL core
 * code (packages/core) against LIVE yt-dlp + LRCLIB. Mirrors what
 * main/youtube/ytdlp.ts (search) and main/lyrics/lrclib.ts (fetch) do.
 *
 *   npx tsx scratchpad/verify-search-lyrics.mts
 */
import { spawn } from 'node:child_process'
import {
  parseTrackFromYouTube,
  parseLrc,
  activeLyricIndex,
  type YtCandidate
} from '../packages/core/src/index.ts'

const UA = 'Timbrel (verify)'

function searchYouTube(query: string, limit = 6): Promise<YtCandidate[]> {
  const args = [
    '--no-warnings',
    '--flat-playlist',
    '--print',
    '%(id)s\t%(title)s\t%(duration)s\t%(channel)s\t%(thumbnails.0.url)s',
    `ytsearch${limit}:${query}`
  ]
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout.on('data', (c) => (out += c.toString()))
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}`))
      const cell = (v: string | undefined): string | null => (v && v !== 'NA' ? v : null)
      resolve(
        out
          .split('\n')
          .map((l) => l.trim())
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

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return res.ok ? res.json() : null
}

async function fetchLyrics(title: string, artist: string | null, durationSec: number | null) {
  if (artist) {
    const p = new URLSearchParams({ track_name: title, artist_name: artist })
    if (durationSec != null) p.set('duration', String(Math.round(durationSec)))
    const exact = await getJson(`https://lrclib.net/api/get?${p}`)
    if (exact?.syncedLyrics) return { synced: true, lrc: exact.syncedLyrics as string }
  }
  const q = [artist, title].filter(Boolean).join(' ')
  const results = await getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`)
  const hit = Array.isArray(results) ? results.find((r) => r.syncedLyrics) : null
  return hit ? { synced: true, lrc: hit.syncedLyrics as string } : null
}

// --- A. Title parsing on real, noisy YouTube titles -------------------------
console.log('=== A. parseTrackFromYouTube ===')
const titles: [string, string | null][] = [
  ['Tame Impala - The Less I Know The Better (Official Video)', 'Tame Impala'],
  ['Coldplay - Yellow (Official Video)', 'Coldplay'],
  ['Blinding Lights', 'The Weeknd - Topic'],
  ['Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams', 'Daft Punk']
]
for (const [t, ch] of titles) {
  const parsed = parseTrackFromYouTube(t, ch)
  console.log(`  "${t}" [${ch}]\n    → artist="${parsed.artist}" title="${parsed.title}"`)
}

// --- B. Live search → C. Live lyrics for the top result ---------------------
const query = 'tame impala the less i know the better'
console.log(`\n=== B. searchYouTube("${query}") ===`)
const results = await searchYouTube(query)
for (const r of results.slice(0, 4)) {
  console.log(
    `  ${r.id} | ${r.durationSec}s | ${r.title} — ${r.channel} | thumb:${r.thumbnailUrl ? 'yes' : 'no'}`
  )
}

const top = results[0]
const parsed = parseTrackFromYouTube(top.title, top.channel)
console.log(`\n=== C. lyrics for top result → artist="${parsed.artist}" title="${parsed.title}" ===`)
const ly = await fetchLyrics(parsed.title, parsed.artist, top.durationSec)
if (!ly) {
  console.log('  NO LYRICS')
} else {
  const lines = parseLrc(ly.lrc)
  console.log(`  synced lines: ${lines.length}`)
  console.log('  first 4:', lines.slice(0, 4).map((l) => `[${l.timeSec.toFixed(1)}s] ${l.text}`))
  for (const t of [30, 60, 120]) {
    const i = activeLyricIndex(lines, t)
    console.log(`  active @ ${t}s → [${i}] "${i >= 0 ? lines[i].text : '(before first)'}"`)
  }
}
