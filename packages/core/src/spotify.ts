/**
 * Spotify import vocabulary (v0.3). Metadata only — Spotify's API cannot return
 * audio (see DECISIONS.md → Audio acquisition); actual audio is fetched from
 * YouTube Music in a later slice. These types are the normalized shapes the app
 * uses, mapped from Spotify's raw API responses in the main process.
 */

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

/** Where users register their own Spotify app to get a `client_id` (BYO). */
export const SPOTIFY_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

/**
 * Loopback ports we try in order for the OAuth redirect (first free one wins).
 * Spotify requires the *exact* redirect URI to be registered, so the user must
 * add **all** of `SPOTIFY_REDIRECT_URIS` to their app. IP literal is required —
 * `localhost` is disallowed; HTTP is permitted for loopback. Single source of
 * truth shared by the auth flow (main) and the setup screen (renderer).
 */
export const SPOTIFY_REDIRECT_PORTS = [8888, 8889, 8890] as const;

export function spotifyRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

export const SPOTIFY_REDIRECT_URIS: string[] =
  SPOTIFY_REDIRECT_PORTS.map(spotifyRedirectUri);

/**
 * Whether we hold a valid Spotify session, and who it belongs to. `clientId` is
 * the user's own registered-app id (BYO) — null until they complete setup; the
 * UI shows the setup screen while it's null.
 */
export interface SpotifyConnection {
  connected: boolean;
  /** The account's display name (or id) once connected; null otherwise. */
  displayName: string | null;
  /** The account's Spotify user id — used to tell owned playlists from followed. */
  userId: string | null;
  /** The user's configured Spotify `client_id`, or null if not set up yet. */
  clientId: string | null;
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
