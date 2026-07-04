/** Static config for the Spotify OAuth (PKCE) flow. See DECISIONS.md → Spotify. */
import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from '@timbrel/core'

export const CLIENT_ID = SPOTIFY_CLIENT_ID
export const SCOPES = SPOTIFY_SCOPES

/**
 * Loopback ports we try in order; the first free one wins. Spotify requires the
 * *exact* redirect URI to be registered, so ALL of these must be added to the
 * app's "Redirect URIs" in the developer dashboard:
 *   http://127.0.0.1:8888/callback
 *   http://127.0.0.1:8889/callback
 *   http://127.0.0.1:8890/callback
 * (IP literal required — `localhost` is disallowed; HTTP allowed for loopback.)
 */
export const REDIRECT_PORTS = [8888, 8889, 8890]

export function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}/callback`
}

/** How long we wait for the user to complete the browser consent before aborting. */
export const AUTH_TIMEOUT_MS = 3 * 60 * 1000
