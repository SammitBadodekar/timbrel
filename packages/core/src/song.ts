/**
 * Where a song's audio came from. Both variants converge on the same
 * separation pipeline; only acquisition differs.
 */
export type AudioSource =
  | { type: "local-upload"; originalFilename: string }
  | {
      type: "spotify";
      spotifyId: string;
      isrc: string | null;
      /** YouTube Music match used to actually fetch audio (v0.3). */
      youtubeId: string | null;
    };

/** Features detected locally in the Python sidecar (librosa → madmom later). */
export interface DetectedFeatures {
  /** Beats-per-minute, or null if detection failed. */
  bpm: number | null;
  /** Musical key, e.g. "A minor", or null. */
  key: string | null;
  /** Beat onset times in seconds (for the beat grid). */
  beatTimes: number[];
  /** Downbeat (bar-start) times in seconds. */
  downbeatTimes: number[];
}

export function emptyFeatures(): DetectedFeatures {
  return { bpm: null, key: null, beatTimes: [], downbeatTimes: [] };
}

/**
 * A song in the library. Heavy media lives on disk; this is the queryable
 * record mirrored into SQLite. `id` is stable and derived from the source
 * (content hash for uploads, Spotify id / ISRC for imports) so the same
 * track is never re-downloaded or re-separated.
 */
export interface Song {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  source: AudioSource;
  /** SHA-256 of the source audio for local-upload dedup; null for imports. */
  contentHash: string | null;
  features: DetectedFeatures;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601 when stems were produced, or null if not yet separated. */
  separatedAt: string | null;
}
