/**
 * Turning a YouTube search result into a clean `{ title, artist }` for the
 * library record and for lyric lookup. Video titles are noisy
 * ("Artist - Song (Official Video) [4K]"), so we strip the common decorations
 * and split on the first " - ". Pure and testable.
 */

/** Parenthetical/bracketed decorations we drop from a video title. */
const NOISE =
  /\s*[([](?:official\s*)?(?:music\s*)?(?:lyric|lyrics|audio|video|visualizer|visualiser|hd|4k|mv|m\/v|remaster(?:ed)?|explicit|hq)[^)\]]*[)\]]/gi;

/** Trailing "| Some Channel" or "| Official" garbage after a pipe. */
const TRAILING_PIPE = /\s*\|\s*[^|]*$/;

function clean(s: string): string {
  return s
    .replace(NOISE, "")
    .replace(TRAILING_PIPE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strip YouTube Music's "- Topic" suffix from an auto-generated channel name. */
function channelArtist(channel: string | null): string | null {
  if (!channel) return null;
  const stripped = channel.replace(/\s*-\s*topic\s*$/i, "").trim();
  return stripped || null;
}

/**
 * Best-effort `{ title, artist }` from a YouTube video title + channel.
 * "Tame Impala - The Less I Know The Better (Official Video)" →
 * `{ artist: "Tame Impala", title: "The Less I Know The Better" }`.
 */
export function parseTrackFromYouTube(
  videoTitle: string,
  channel: string | null
): { title: string; artist: string | null } {
  const cleaned = clean(videoTitle);

  // "Artist - Title" is the dominant convention; split on the first dash.
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    return { artist: clean(dash[1] ?? "") || channelArtist(channel), title: clean(dash[2] ?? "") };
  }

  // No dash — fall back to the channel (minus "- Topic") as the artist.
  return { artist: channelArtist(channel), title: cleaned || videoTitle.trim() };
}
