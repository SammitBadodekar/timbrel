/**
 * Playlists — user-made collections of songs (v0.6). A playlist is an ordered
 * practice setlist that can also seed the desktop playback queue. Membership
 * is a many-to-many join (`playlist_songs`), so deleting a
 * playlist never deletes the songs inside it, and deleting a song simply drops
 * it from any playlists it was in.
 */

export interface Playlist {
  id: string;
  name: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601 — bumped on rename and on membership changes. */
  updatedAt: string;
}

/** One tile of a playlist's mosaic cover — enough to draw artwork or a fallback. */
export interface PlaylistCover {
  id: string;
  title: string;
  /** YouTube thumbnail URL, or null (→ pastel-monogram fallback). */
  thumbnailUrl: string | null;
}

/**
 * A playlist plus the derived fields the library shelf needs: how many songs it
 * holds, their combined duration, and up to four member songs to build the
 * mosaic cover (real artwork when known, monogram otherwise).
 */
export interface PlaylistSummary extends Playlist {
  trackCount: number;
  /** Sum of member durations, or null when none are known yet. */
  durationSec: number | null;
  /** Up to four members (first by order) for the cover mosaic. */
  coverSongs: PlaylistCover[];
}
