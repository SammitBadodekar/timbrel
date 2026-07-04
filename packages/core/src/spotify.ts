/**
 * Spotify import vocabulary (v0.3). Metadata only — Spotify's API cannot return
 * audio (see DECISIONS.md → Audio acquisition); actual audio is fetched from
 * YouTube Music in a later slice. These types are the normalized shapes the app
 * uses, mapped from Spotify's raw API responses in the main process.
 */

/**
 * The shared, public `client_id` shipped with Timbrel (Exportify model).
 * Safe to be public: PKCE means no client *secret* is ever shipped. See
 * DECISIONS.md for why we accept the Extended-Quota-Mode review this implies.
 */
export const SPOTIFY_CLIENT_ID = "935b5e17f08b4141bb18f64f8c7372a1";

/**
 * Read-only scopes — browse the user's own playlists + liked songs.
 * `playlist-read-collaborative` lets us read playlists the user collaborates on;
 * Spotify's API only returns tracks for playlists the user OWNS or COLLABORATES
 * on — merely-followed / editorial playlists 403 regardless of scope.
 */
export const SPOTIFY_SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative"
];

export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

/** Whether we hold a valid Spotify session, and who it belongs to. */
export interface SpotifyConnection {
  connected: boolean;
  /** The account's display name (or id) once connected; null otherwise. */
  displayName: string | null;
  /** The account's Spotify user id — used to tell owned playlists from followed. */
  userId: string | null;
}

/** A playlist in the user's library, trimmed to what the browser UI shows. */
export interface SpotifyPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Owner's display name (for the subtitle). */
  owner: string | null;
  /** Owner's Spotify user id — compare to the session `userId` to test ownership. */
  ownerId: string | null;
  /** Whether the playlist allows collaborators (accessible to a collaborator). */
  collaborative: boolean;
}

/**
 * Whether the app can read a playlist's tracks: Spotify only serves tracks for
 * playlists the user owns or collaborates on (else 403). Followed / editorial
 * playlists are not importable.
 */
export function isPlaylistReadable(
  playlist: SpotifyPlaylist,
  userId: string | null
): boolean {
  return playlist.collaborative || (!!userId && playlist.ownerId === userId);
}

/**
 * A track's metadata. `isrc` + `artists` feed the YouTube-Music match in the
 * download slice; `id` becomes the Spotify `AudioSource.spotifyId`.
 */
export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  album: string | null;
  durationSec: number | null;
  isrc: string | null;
  imageUrl: string | null;
}
