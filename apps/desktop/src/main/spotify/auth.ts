/**
 * Spotify Authorization Code + PKCE flow for a desktop app. We open the system
 * browser for consent and catch the redirect on a short-lived loopback HTTP
 * server (127.0.0.1). No client secret is involved — the PKCE verifier is the
 * proof. Tokens are stored locally and silently refreshed. See DECISIONS.md.
 */
import { shell } from 'electron'
import { createServer, type Server } from 'node:http'
import {
  SPOTIFY_AUTH_URL,
  SPOTIFY_TOKEN_URL,
  SPOTIFY_API_BASE,
  type SpotifyConnection
} from '@timbrel/core'
import { SCOPES, REDIRECT_PORTS, redirectUri, AUTH_TIMEOUT_MS } from './config'
import { createVerifier, challengeFor, createState } from './pkce'
import { readTokens, writeTokens, clearTokens, type StoredTokens } from './tokens'
import { getClientId } from './clientId'

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

/** Guards against a second browser window if the user double-clicks Connect. */
let connecting: Promise<SpotifyConnection> | null = null

export async function status(): Promise<SpotifyConnection> {
  const clientId = await getClientId()
  // No client_id ⇒ the user hasn't done BYO setup; can't use any stored tokens.
  if (!clientId) return { connected: false, displayName: null, userId: null, clientId: null }

  const tokens = await readTokens()
  if (!tokens) return { connected: false, displayName: null, userId: null, clientId }

  // Backfill the user id for sessions stored before we captured it, so owned
  // playlists are recognized without forcing a reconnect.
  if (!tokens.userId) {
    try {
      const me = await fetchMe(await getAccessToken())
      if (me.id) {
        await writeTokens({
          ...tokens,
          userId: me.id,
          displayName: me.displayName ?? tokens.displayName
        })
        return {
          connected: true,
          displayName: me.displayName ?? tokens.displayName,
          userId: me.id,
          clientId
        }
      }
    } catch {
      // Network/refresh hiccup — report connected; ownership detection degrades gracefully.
    }
  }
  return { connected: true, displayName: tokens.displayName, userId: tokens.userId, clientId }
}

export async function disconnect(): Promise<void> {
  await clearTokens()
}

export function connect(): Promise<SpotifyConnection> {
  if (connecting) return connecting
  connecting = runAuthFlow().finally(() => {
    connecting = null
  })
  return connecting
}

async function runAuthFlow(): Promise<SpotifyConnection> {
  const clientId = await getClientId()
  if (!clientId) {
    throw new Error('Add your Spotify Client ID first (see setup).')
  }

  const verifier = createVerifier()
  const challenge = challengeFor(verifier)
  const state = createState()

  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/callback')) {
      res.writeHead(404)
      res.end()
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')

    // Ignore stray hits with neither code nor error — keep waiting for the real one.
    if (!error && !code) {
      res.writeHead(204)
      res.end()
      return
    }

    const stateOk = returnedState === state
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(resultPage(error ?? (stateOk ? null : 'state mismatch')))

    if (error) rejectCode(new Error(`Spotify authorization was denied (${error}).`))
    else if (!stateOk) rejectCode(new Error('Spotify authorization state mismatch.'))
    else resolveCode(code as string)
  })

  const port = await listenOnFreePort(server)
  const uri = redirectUri(port)

  const authUrl = new URL(SPOTIFY_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', uri)
  authUrl.searchParams.set('scope', SCOPES.join(' '))
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('state', state)

  const timeout = setTimeout(
    () => rejectCode(new Error('Timed out waiting for Spotify authorization.')),
    AUTH_TIMEOUT_MS
  )

  try {
    await shell.openExternal(authUrl.toString())
    const code = await codePromise
    const token = await exchangeCode(code, verifier, uri, clientId)
    const me = await fetchMe(token.access_token)
    const stored: StoredTokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? '',
      expiresAt: Date.now() + token.expires_in * 1000,
      displayName: me.displayName,
      userId: me.id
    }
    await writeTokens(stored)
    return { connected: true, displayName: me.displayName, userId: me.id, clientId }
  } finally {
    clearTimeout(timeout)
    server.close()
  }
}

/** Listen on the first available loopback port; throw if all are taken. */
function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const ports = [...REDIRECT_PORTS]
    const tryNext = (): void => {
      const port = ports.shift()
      if (port === undefined) {
        reject(
          new Error(
            `No free loopback port among ${REDIRECT_PORTS.join(', ')} for the Spotify redirect.`
          )
        )
        return
      }
      const onError = (): void => {
        server.removeListener('listening', onListening)
        tryNext()
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve(port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    }
    tryNext()
  })
}

async function exchangeCode(
  code: string,
  verifier: string,
  uri: string,
  clientId: string
): Promise<TokenResponse> {
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: uri,
      client_id: clientId,
      code_verifier: verifier
    })
  })
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as TokenResponse
}

/**
 * A valid access token, refreshing (1 min early) when stale. On refresh failure
 * (revoked/expired) the local session is cleared so the UI prompts a reconnect.
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await readTokens()
  if (!tokens) throw new Error('Not connected to Spotify.')
  if (Date.now() < tokens.expiresAt - 60 * 1000) return tokens.accessToken

  const clientId = await getClientId()
  if (!clientId) {
    await clearTokens()
    throw new Error('Spotify Client ID is not set — please reconnect.')
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: clientId
    })
  })
  if (!res.ok) {
    await clearTokens()
    throw new Error('Spotify session expired — please reconnect.')
  }
  const json = (await res.json()) as TokenResponse
  const next: StoredTokens = {
    accessToken: json.access_token,
    // Spotify may or may not rotate the refresh token; keep the old if omitted.
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
    displayName: tokens.displayName,
    userId: tokens.userId
  }
  await writeTokens(next)
  return next.accessToken
}

async function fetchMe(
  accessToken: string
): Promise<{ id: string | null; displayName: string | null }> {
  try {
    const res = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return { id: null, displayName: null }
    const me = (await res.json()) as { display_name?: string; id?: string }
    return { id: me.id ?? null, displayName: me.display_name ?? me.id ?? null }
  } catch {
    return { id: null, displayName: null }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function resultPage(error: string | null): string {
  const ok = !error
  const heading = ok ? 'Timbrel is connected ✓' : 'Authorization failed'
  const body = ok
    ? 'You can close this tab and return to Timbrel.'
    : `Spotify reported: ${escapeHtml(error)}. Close this tab and try again in Timbrel.`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Timbrel</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0b0d10;color:#e7eaee;
display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center}
.card{max-width:28rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#9aa0aa;margin:0}</style></head>
<body><div class="card"><h1>${heading}</h1><p>${body}</p></div></body></html>`
}
