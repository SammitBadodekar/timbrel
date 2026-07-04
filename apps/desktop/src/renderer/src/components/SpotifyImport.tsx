import { useCallback, useEffect, useState } from 'react'
import {
  isPlaylistReadable,
  type SpotifyConnection,
  type SpotifyPlaylist,
  type SpotifyTrack
} from '@timbrel/core'
import { formatTime } from '../lib/format'

const DISCONNECTED: SpotifyConnection = { connected: false, displayName: null, userId: null }

interface SpotifyImportProps {
  onBack: () => void
}

/** What the track pane is currently showing. */
type Selection = { kind: 'liked' } | { kind: 'playlist'; playlist: SpotifyPlaylist }

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error:\s*/, '')
}

function SpotifyImport({ onBack }: SpotifyImportProps): React.JSX.Element {
  // null = still checking the stored session on mount.
  const [conn, setConn] = useState<SpotifyConnection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPlaylists = useCallback(async () => {
    try {
      setPlaylists(await window.timbrel.spotifyPlaylists())
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    let alive = true
    window.timbrel
      .spotifyStatus()
      .then((s) => {
        if (!alive) return
        setConn(s)
        if (s.connected) void loadPlaylists()
      })
      .catch((e) => {
        if (alive) setConn(DISCONNECTED)
        if (alive) setError(errMsg(e))
      })
    return () => {
      alive = false
    }
  }, [loadPlaylists])

  const handleConnect = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      const s = await window.timbrel.spotifyConnect()
      setConn(s)
      await loadPlaylists()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setConnecting(false)
    }
  }, [loadPlaylists])

  const handleDisconnect = useCallback(async () => {
    await window.timbrel.spotifyDisconnect()
    setConn(DISCONNECTED)
    setPlaylists(null)
    setSelection(null)
    setTracks(null)
  }, [])

  const openSelection = useCallback(
    async (sel: Selection) => {
      // Spotify 403s tracks for playlists the user only follows — explain up front.
      if (sel.kind === 'playlist' && !isPlaylistReadable(sel.playlist, conn?.userId ?? null)) {
        setError(
          `"${sel.playlist.name}" is owned by ${sel.playlist.owner ?? 'someone else'} — Spotify only lets Timbrel import playlists you own or collaborate on.`
        )
        return
      }
      setSelection(sel)
      setTracks(null)
      setError(null)
      try {
        const list =
          sel.kind === 'liked'
            ? await window.timbrel.spotifyLikedTracks()
            : await window.timbrel.spotifyPlaylistTracks(sel.playlist.id)
        setTracks(list)
      } catch (e) {
        setError(errMsg(e))
      }
    },
    [conn]
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-text"
          >
            ← Library
          </button>
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Import</div>
            <h1 className="text-2xl font-semibold">Spotify</h1>
          </div>
        </div>
        {conn?.connected && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">
              {conn.displayName ? `Connected as ${conn.displayName}` : 'Connected'}
            </span>
            <button
              onClick={handleDisconnect}
              className="rounded-full border border-border px-3 py-1.5 text-muted hover:border-accent hover:text-text"
            >
              Disconnect
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-stem-vocals/40 bg-stem-vocals/10 px-4 py-2.5 text-sm text-stem-vocals">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-3 shrink-0 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {conn === null ? (
        <Centered>
          <p className="text-sm text-muted">Checking Spotify…</p>
        </Centered>
      ) : !conn.connected ? (
        <Centered>
          <p className="text-lg font-medium">Connect your Spotify</p>
          <p className="max-w-sm text-center text-sm text-muted">
            Browse your playlists and liked songs. Timbrel only reads metadata — nothing is posted
            and no password is shared.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="mt-2 rounded-full bg-[#1db954] px-6 py-2.5 text-sm font-semibold text-black hover:bg-[#1ed760] disabled:opacity-60"
          >
            {connecting ? 'Waiting for your browser…' : 'Connect Spotify'}
          </button>
          {connecting && (
            <p className="text-xs text-muted">
              Approve access in the browser tab that just opened.
            </p>
          )}
        </Centered>
      ) : selection ? (
        <TrackList
          title={selection.kind === 'liked' ? 'Liked Songs' : selection.playlist.name}
          tracks={tracks}
          onBack={() => {
            setSelection(null)
            setTracks(null)
          }}
        />
      ) : (
        <PlaylistList playlists={playlists} userId={conn.userId} onOpen={openSelection} />
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3">{children}</div>
}

function PlaylistList({
  playlists,
  userId,
  onOpen
}: {
  playlists: SpotifyPlaylist[] | null
  userId: string | null
  onOpen: (sel: Selection) => void
}): React.JSX.Element {
  if (playlists === null) {
    return (
      <Centered>
        <p className="text-sm text-muted">Loading your playlists…</p>
      </Centered>
    )
  }
  return (
    <ul className="space-y-2 overflow-y-auto">
      <li>
        <button
          onClick={() => onOpen({ kind: 'liked' })}
          className="flex w-full items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 text-left hover:border-accent"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4508a0] to-[#8f74ff] text-lg">
            ♥
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">Liked Songs</div>
            <div className="text-xs text-muted">Your saved tracks</div>
          </div>
        </button>
      </li>
      {playlists.map((p) => {
        const readable = isPlaylistReadable(p, userId)
        const owned = !!userId && p.ownerId === userId
        return (
          <li key={p.id}>
            <button
              onClick={() => onOpen({ kind: 'playlist', playlist: p })}
              className={`flex w-full items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 text-left hover:border-accent ${
                readable ? '' : 'opacity-55'
              }`}
            >
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-lg bg-surface-2" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted">
                  {owned ? 'by you' : `by ${p.owner ?? 'Spotify'}`}
                  {p.collaborative ? ' · collaborative' : ''}
                </div>
              </div>
              {!readable && (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                  Followed
                </span>
              )}
            </button>
          </li>
        )
      })}
      {playlists.length === 0 && (
        <li className="py-8 text-center text-sm text-muted">No playlists found.</li>
      )}
    </ul>
  )
}

function TrackList({
  title,
  tracks,
  onBack
}: {
  title: string
  tracks: SpotifyTrack[] | null
  onBack: () => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-text"
        >
          ← Playlists
        </button>
        <h2 className="truncate text-lg font-semibold">{title}</h2>
      </div>

      <div className="mb-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-muted">
        Browsing metadata only. Downloading &amp; separating Spotify tracks arrives in the next
        update.
      </div>

      {tracks === null ? (
        <Centered>
          <p className="text-sm text-muted">Loading tracks…</p>
        </Centered>
      ) : tracks.length === 0 ? (
        <Centered>
          <p className="text-sm text-muted">No tracks here.</p>
        </Centered>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {tracks.map((t, i) => (
            <li
              key={`${t.id}-${i}`}
              className="flex items-center gap-4 rounded-xl px-3 py-2 hover:bg-surface"
            >
              <span className="w-6 shrink-0 text-right text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted">
                  {t.artists.join(', ') || 'Unknown artist'}
                  {t.album ? ` · ${t.album}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {t.durationSec != null ? formatTime(t.durationSec) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SpotifyImport
