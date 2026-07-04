/** Static config for the Spotify OAuth (PKCE) flow. The `client_id` is NOT here —
 *  it's user-provided (BYO) and read from the store; see `clientId.ts`. */
import { SPOTIFY_SCOPES, SPOTIFY_REDIRECT_PORTS, spotifyRedirectUri } from '@timbrel/core'

export const SCOPES = SPOTIFY_SCOPES

/**
 * Loopback ports we try in order; the first free one wins. Spotify requires the
 * *exact* redirect URI to be registered, so ALL of these must be added to the
 * user's app "Redirect URIs" (the setup screen shows them). Single source of
 * truth is `@timbrel/core` so main + renderer never drift.
 */
export const REDIRECT_PORTS = SPOTIFY_REDIRECT_PORTS

export function redirectUri(port: number): string {
  return spotifyRedirectUri(port)
}

/** How long we wait for the user to complete the browser consent before aborting. */
export const AUTH_TIMEOUT_MS = 3 * 60 * 1000
