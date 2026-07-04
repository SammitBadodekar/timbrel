/**
 * Persists the user's own Spotify `client_id` (BYO model — see DECISIONS.md →
 * Audio acquisition). Kept in `spotify-config.json`, separate from the token
 * store so disconnecting (which clears tokens) doesn't make the user re-enter
 * their id. The client_id is public by nature (PKCE ships no secret), so plain
 * JSON is fine — the `refresh_token` in `spotify.json` is the real secret.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { clearTokens } from './tokens'

function configPath(): string {
  return join(app.getPath('userData'), 'spotify-config.json')
}

/** The configured `client_id`, or null if the user hasn't set one up yet. */
export async function getClientId(): Promise<string | null> {
  try {
    const json = JSON.parse(await readFile(configPath(), 'utf8')) as { clientId?: string }
    return json.clientId?.trim() || null
  } catch {
    return null
  }
}

/**
 * Store the user's `client_id`. Changing it invalidates any existing session
 * (tokens were issued by a different app), so we clear the tokens on a change.
 */
export async function setClientId(clientId: string): Promise<void> {
  const trimmed = clientId.trim()
  if (!trimmed) throw new Error('Client ID cannot be empty.')
  const previous = await getClientId()
  await writeFile(configPath(), JSON.stringify({ clientId: trimmed }), 'utf8')
  if (previous && previous !== trimmed) await clearTokens()
}
