/**
 * Time-synced lyrics (LRC). We fetch these from LRCLIB (open, no-auth) in the
 * main process; this module is the pure parse + lookup half so the studio can
 * highlight the current line off the transport clock. LRC format:
 *   [mm:ss.xx] Line text
 * A line may carry several timestamps; metadata tags ([ar:], [ti:], …) are
 * skipped. Blank-text lines are kept — they mark instrumental gaps.
 */

export interface LrcLine {
  /** Seconds from the start of the track. */
  timeSec: number;
  /** The lyric text (may be empty for a gap). */
  text: string;
}

/** Lyrics for a song, synced when timestamps are present. */
export interface Lyrics {
  lines: LrcLine[];
  /** True when the lines carry timestamps (LRC); false for plain text. */
  synced: boolean;
  /** Attribution/source label, e.g. "LRCLIB". */
  source: string;
}

const TIMESTAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parse an LRC string into time-sorted lines. Ignores metadata-only tags. */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const rawLine of lrc.split(/\r?\n/)) {
    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP.exec(rawLine)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const frac = match[3] ? Number(`0.${match[3]}`) : 0;
      stamps.push(min * 60 + sec + frac);
    }
    if (stamps.length === 0) continue; // metadata tag or untimed line
    const text = rawLine.replace(TIMESTAMP, "").trim();
    for (const timeSec of stamps) out.push({ timeSec, text });
  }
  out.sort((a, b) => a.timeSec - b.timeSec);
  return out;
}

/**
 * Index of the line active at time `t` (the last line whose timestamp is ≤ t),
 * or -1 before the first line. Binary search — called every animation frame.
 */
export function activeLyricIndex(lines: LrcLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midTime = lines[mid]?.timeSec ?? Infinity;
    if (midTime <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
