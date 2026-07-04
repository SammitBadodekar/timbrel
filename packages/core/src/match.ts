/**
 * Matching a Spotify track to a YouTube (Music) source. Spotify's API cannot
 * return audio (see DECISIONS.md → Audio acquisition), so each imported track is
 * matched to a YouTube video and downloaded with `yt-dlp` in the main process.
 *
 * This module is the *pure, testable* half: it builds the search query and
 * scores candidate results. The actual `yt-dlp` invocation lives in
 * `apps/desktop/src/main/spotify/download.ts`.
 */
import type { SpotifyTrack } from "./spotify.js";

/** A YouTube search result, trimmed to what a flat (metadata-only) search returns. */
export interface YtCandidate {
  /** YouTube video id. */
  id: string;
  title: string;
  /** Duration in seconds, or null if the search didn't report it. */
  durationSec: number | null;
  /** Uploading channel — `"<Artist> - Topic"` marks YouTube Music's official audio. */
  channel: string | null;
  /** Thumbnail URL for the search UI (ignored by scoring). */
  thumbnailUrl?: string | null;
}

/**
 * The query we search YouTube with: `"<primary artist> <title>"`. Matching
 * spotDL/ViMusic, we keep it simple — the artist + track name surfaces the
 * official "- Topic" upload; scoring picks the right one from the candidates.
 */
export function buildYtSearchQuery(track: SpotifyTrack): string {
  const artist = track.artists[0] ?? "";
  return [artist, track.name].filter(Boolean).join(" ").trim();
}

/**
 * Words that almost always signal a *wrong* match (a live take, a remix, a
 * lyric video re-upload, …). Penalized in the title unless the wanted track
 * genuinely has that word in its name (e.g. a song literally called "Live").
 */
const BAD_WORDS = [
  "live",
  "cover",
  "remix",
  "reaction",
  "instrumental",
  "karaoke",
  "sped up",
  "slowed",
  "nightcore",
  "8d audio",
  "reverb"
];

/**
 * Score a candidate against the wanted track; higher is better. Duration
 * proximity is the strongest signal (a full song is a fixed length); the
 * "- Topic" channel and title/artist overlap refine it.
 */
export function scoreYtCandidate(candidate: YtCandidate, track: SpotifyTrack): number {
  let score = 0;
  const title = candidate.title.toLowerCase();
  const channel = (candidate.channel ?? "").toLowerCase();
  const wantName = track.name.toLowerCase();
  const wantArtist = (track.artists[0] ?? "").toLowerCase();

  // Duration proximity — the single most reliable signal.
  if (track.durationSec != null && candidate.durationSec != null) {
    const diff = Math.abs(candidate.durationSec - track.durationSec);
    if (diff <= 2) score += 50;
    else if (diff <= 5) score += 35;
    else if (diff <= 10) score += 15;
    else if (diff <= 20) score += 0;
    else score -= 40; // wildly different length ⇒ compilation / wrong track
  }

  // "<Artist> - Topic" is YouTube Music's auto-generated official-audio channel.
  if (channel.includes("- topic") || channel.endsWith("topic")) score += 25;
  if (wantArtist && channel.includes(wantArtist)) score += 15;

  // The title should name the track (and ideally the artist).
  if (title.includes(wantName)) score += 15;
  if (wantArtist && title.includes(wantArtist)) score += 8;
  if (title.includes("official audio") || title.includes("official video")) score += 6;

  // Penalize obvious non-matches, unless the wanted track itself has that word.
  for (const word of BAD_WORDS) {
    if (title.includes(word) && !wantName.includes(word)) score -= 20;
  }

  return score;
}

/**
 * Pick the best candidate, or null if none clears a minimum bar (a wall of
 * negative scores means every result is a live/remix/wrong-length dud, and
 * downloading it would be worse than reporting "no match").
 */
export function pickBestYtCandidate(
  candidates: YtCandidate[],
  track: SpotifyTrack
): YtCandidate | null {
  let best: YtCandidate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const score = scoreYtCandidate(candidate, track);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best && bestScore > -20 ? best : null;
}
