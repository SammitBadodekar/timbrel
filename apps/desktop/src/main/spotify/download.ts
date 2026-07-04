/**
 * Spotify-specific YouTube matching (PARKED — the Spotify import path is no
 * longer wired into the UI; direct YouTube search replaced it, see DECISIONS.md).
 * The generic search/download live in `../youtube/ytdlp.ts`; this only adds the
 * "score a Spotify track against candidates" step the import used.
 */
import { buildYtSearchQuery, pickBestYtCandidate, type SpotifyTrack } from '@timbrel/core'
import { searchYouTube } from '../youtube/ytdlp'

/** Re-exported so the parked import code keeps a stable surface. */
export { resolveYtDlp, downloadYtAudio } from '../youtube/ytdlp'

/** The match we hand to the downloader. */
export interface YtMatch {
  youtubeId: string
  title: string
}

/** How many YouTube results to score before picking the best match. */
const SEARCH_COUNT = 6

/**
 * Search YouTube for a Spotify track and return the best-scoring match, or null
 * if nothing clears the bar.
 */
export async function matchYtTrack(track: SpotifyTrack): Promise<YtMatch | null> {
  const candidates = await searchYouTube(buildYtSearchQuery(track), SEARCH_COUNT)
  const best = pickBestYtCandidate(candidates, track)
  return best ? { youtubeId: best.id, title: best.title } : null
}
