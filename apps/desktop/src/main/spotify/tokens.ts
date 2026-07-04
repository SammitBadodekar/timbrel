/**
 * Persists the per-user Spotify session to `spotify.json` in app-data. This is
 * the *real* on-device secret (the `refresh_token` grants read access to the
 * user's library) — the shared client_id is not. OS-keychain hardening is a
 * v0.4 TODO; for now it lives beside the SQLite index, local-only.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, rm } from 'node:fs/promises'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms at which `accessToken` expires. */
  expiresAt: number
  displayName: string | null
  /** Spotify user id — lets the UI distinguish owned playlists from followed ones. */
  userId: string | null
}

function tokenPath(): string {
  return join(app.getPath('userData'), 'spotify.json')
}

export async function readTokens(): Promise<StoredTokens | null> {
  try {
    return JSON.parse(await readFile(tokenPath(), 'utf8')) as StoredTokens
  } catch {
    return null
  }
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  await writeFile(tokenPath(), JSON.stringify(tokens), 'utf8')
}

export async function clearTokens(): Promise<void> {
  await rm(tokenPath(), { force: true })
}
