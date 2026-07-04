/**
 * Time-synced lyrics from LRCLIB (lrclib.net) — open, free, no API key. We try
 * the exact `/api/get` (track + artist + duration) first, then fall back to the
 * fuzzy `/api/search`. Parsing/lookup is in `@timbrel/core` (`lyrics.ts`); this
 * only does the network + shape-mapping. Best-effort: returns null on any miss.
 */
import { parseLrc, type Lyrics } from '@timbrel/core'

const LRCLIB_BASE = 'https://lrclib.net/api'
// LRCLIB asks clients to identify themselves.
const UA = 'Timbrel (https://github.com/timbrel/timbrel)'

interface LrclibRecord {
  duration?: number | null
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

function toLyrics(rec: LrclibRecord): Lyrics | null {
  if (rec.instrumental) return null
  if (rec.syncedLyrics) {
    const lines = parseLrc(rec.syncedLyrics)
    if (lines.length) return { lines, synced: true, source: 'LRCLIB' }
  }
  if (rec.plainLyrics) {
    const lines = rec.plainLyrics.split(/\r?\n/).map((text) => ({ timeSec: 0, text }))
    return { lines, synced: false, source: 'LRCLIB' }
  }
  return null
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Best-effort synced lyrics for a track. Prefers synced over plain. */
export async function fetchLyrics(input: {
  title: string
  artist: string | null
  durationSec: number | null
}): Promise<Lyrics | null> {
  const { title, artist, durationSec } = input

  // 1) Exact match — needs both artist and title.
  if (artist) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist })
    if (durationSec != null) params.set('duration', String(Math.round(durationSec)))
    const exact = (await getJson(`${LRCLIB_BASE}/get?${params}`)) as LrclibRecord | null
    if (exact) {
      const lyrics = toLyrics(exact)
      if (lyrics) return lyrics
    }
  }

  // 2) Fuzzy search — pick the closest-duration result that has synced lyrics.
  const q = [artist, title].filter(Boolean).join(' ')
  const results = (await getJson(`${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`)) as
    | LrclibRecord[]
    | null
  if (!Array.isArray(results) || results.length === 0) return null

  const synced = results.filter((r) => r.syncedLyrics)
  const pool = synced.length ? synced : results
  const best =
    durationSec != null
      ? pool.reduce((a, b) =>
          Math.abs((b.duration ?? 0) - durationSec) < Math.abs((a.duration ?? 0) - durationSec)
            ? b
            : a
        )
      : pool[0]
  return toLyrics(best)
}
