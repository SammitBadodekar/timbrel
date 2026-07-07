import { useCallback, useEffect, useState } from 'react'
import {
  isPlaylistReadable,
  SPOTIFY_REDIRECT_URIS,
  type SpotifyConnection,
  type SpotifyPlaylist,
  type SpotifyTrack
} from '@timbrel/core'
import { formatTime } from '../lib/format'
import { STAGE_LABELS, type JobUi } from '../types'

const DISCONNECTED: SpotifyConnection = {
  connected: false,
  displayName: null,
  userId: null,
  clientId: null
}

interface SpotifyImportProps {
  onBack: () => void
  /** Open an imported (separated) song in the studio. */
  onOpenSong: (songId: string) => void
}

/** What the track pane is currently showing. */
type Selection = { kind: 'liked' } | { kind: 'playlist'; playlist: SpotifyPlaylist }

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error:\s*/, '')
}

function SpotifyImport({ onBack, onOpenSong }: SpotifyImportProps): React.JSX.Element {
  // null = still checking the stored session on mount.
  const [conn, setConn] = useState<SpotifyConnection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True when the user wants to (re-)enter their Client ID even though one is set.
  const [editingClientId, setEditingClientId] = useState(false)

  // Import state, keyed by the song id the main process returns per track.
  const [trackSong, setTrackSong] = useState<Record<string, string>>({})
  const [jobs, setJobs] = useState<Record<string, JobUi>>({})
  const [doneSongs, setDoneSongs] = useState<Record<string, true>>({})

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

  // Import progress streams over the same channel as local separation, keyed by
  // song id. (App.tsx also listens — refreshing the library on `done`.)
  useEffect(() => {
    return window.timbrel.onSeparationEvent((event) => {
      if (event.type === 'progress') {
        setJobs((j) => ({
          ...j,
          [event.songId]: { stage: event.stage, progress: event.progress, message: event.message }
        }))
      } else if (event.type === 'done') {
        setJobs((j) => {
          const next = { ...j }
          delete next[event.songId]
          return next
        })
        setDoneSongs((d) => ({ ...d, [event.songId]: true }))
      } else if (event.type === 'error' && event.songId) {
        setJobs((j) => ({
          ...j,
          [event.songId!]: { stage: 'queued', progress: 0, error: event.message }
        }))
      }
    })
  }, [])

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

  const handleSaveClientId = useCallback(async (clientId: string) => {
    setError(null)
    try {
      const s = await window.timbrel.spotifySetClientId(clientId)
      setConn(s)
      setEditingClientId(false)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    await window.timbrel.spotifyDisconnect()
    // Keep the configured client_id — only the session is cleared.
    setConn((c) => ({ ...DISCONNECTED, clientId: c?.clientId ?? null }))
    setPlaylists(null)
    setSelection(null)
    setTracks(null)
  }, [])

  /**
   * Queue every track in the current view. The main process serializes the
   * downloads + separations (one at a time) and mirrors the tracks into a
   * local playlist named after the Spotify one.
   */
  const handleImportAll = useCallback(async (list: SpotifyTrack[], playlistName: string) => {
    setError(null)
    // Optimistic: every untouched track flips to "queued" the instant the
    // click lands; the batch result then fills in the real song ids.
    setTrackSong((m) => {
      const next = { ...m }
      for (const t of list) if (!(t.id in next)) next[t.id] = ''
      return next
    })
    try {
      const results = await window.timbrel.spotifyImportTracks(list, playlistName)
      const song: Record<string, string> = {}
      const done: Record<string, true> = {}
      const queued: string[] = []
      results.forEach((r, i) => {
        if (!r.ok) return
        song[list[i].id] = r.songId
        if (r.alreadyExists) done[r.songId] = true
        else queued.push(r.songId)
      })
      setTrackSong((m) => ({ ...m, ...song }))
      setDoneSongs((d) => ({ ...d, ...done }))
      // Don't clobber a job that's already streaming progress.
      setJobs((j) => {
        const next = { ...j }
        for (const id of queued) if (!next[id]) next[id] = { stage: 'queued', progress: 0 }
        return next
      })
    } catch (e) {
      setError(errMsg(e))
      setTrackSong((m) => {
        const next = { ...m }
        for (const t of list) if (next[t.id] === '') delete next[t.id]
        return next
      })
    }
  }, [])

  const handleImport = useCallback(async (track: SpotifyTrack) => {
    setError(null)
    // Optimistic: show "queued" the instant the click lands.
    setTrackSong((m) => (m[track.id] ? m : { ...m, [track.id]: '' }))
    try {
      const result = await window.timbrel.spotifyImportTrack(track)
      if (!result.ok) {
        setError(errMsg(result.error))
        setTrackSong((m) => {
          const next = { ...m }
          delete next[track.id]
          return next
        })
        return
      }
      setTrackSong((m) => ({ ...m, [track.id]: result.songId }))
      if (result.alreadyExists) {
        setDoneSongs((d) => ({ ...d, [result.songId]: true }))
      } else {
        setJobs((j) => ({ ...j, [result.songId]: { stage: 'queued', progress: 0 } }))
      }
    } catch (e) {
      setError(errMsg(e))
      setTrackSong((m) => {
        const next = { ...m }
        delete next[track.id]
        return next
      })
    }
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
      ) : !conn.clientId || editingClientId ? (
        <SetupScreen
          currentClientId={conn.clientId}
          canCancel={!!conn.clientId}
          onCancel={() => setEditingClientId(false)}
          onSave={handleSaveClientId}
        />
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
          <button
            onClick={() => setEditingClientId(true)}
            className="mt-1 text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-text"
          >
            Use a different Client ID
          </button>
        </Centered>
      ) : selection ? (
        <TrackList
          title={selection.kind === 'liked' ? 'Liked Songs' : selection.playlist.name}
          tracks={tracks}
          trackSong={trackSong}
          jobs={jobs}
          doneSongs={doneSongs}
          onImport={handleImport}
          onImportAll={(list) =>
            void handleImportAll(
              list,
              selection.kind === 'liked' ? 'Liked Songs' : selection.playlist.name
            )
          }
          onOpenSong={onOpenSong}
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

/**
 * One-time BYO setup: the user registers their own free Spotify app and pastes
 * its Client ID. Spotify only grants "extended quota" to registered companies
 * (250k+ MAUs), so a shared app would cap Timbrel at a handful of users — a
 * personal app has no such cap and is fully within Spotify's terms.
 */
function SetupScreen({
  currentClientId,
  canCancel,
  onCancel,
  onSave
}: {
  currentClientId: string | null
  canCancel: boolean
  onCancel: () => void
  onSave: (clientId: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(currentClientId ?? '')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text)
    setCopied(text)
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1200)
  }

  const submit = async (): Promise<void> => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await onSave(value.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4">
      <div>
        <p className="text-lg font-medium">Connect Spotify with your own app</p>
        <p className="mt-1 text-sm text-muted">
          Spotify requires each app to be registered. Creating your own free app takes about two
          minutes, has no user limit, and keeps everything under your account — Timbrel never sees a
          password and only reads metadata.
        </p>
      </div>

      <ol className="space-y-4 text-sm">
        <li className="flex gap-3">
          <StepNum>1</StepNum>
          <div className="flex-1">
            <p>
              Open the Spotify Developer Dashboard and log in, then click{' '}
              <span className="font-medium text-text">Create app</span>.
            </p>
            <button
              onClick={() => void window.timbrel.spotifyOpenDashboard()}
              className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-text"
            >
              Open Spotify Dashboard ↗
            </button>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNum>2</StepNum>
          <div className="flex-1">
            <p>
              Name it anything (e.g. “Timbrel”). Under{' '}
              <span className="font-medium text-text">which API/SDKs are you planning to use</span>,
              tick <span className="font-medium text-text">Web API</span>.
            </p>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNum>3</StepNum>
          <div className="flex-1">
            <p>
              Add <span className="font-medium text-text">all three</span> Redirect URIs below (they
              must match exactly), then Save:
            </p>
            <div className="mt-2 space-y-1.5">
              {SPOTIFY_REDIRECT_URIS.map((uri) => (
                <div
                  key={uri}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5"
                >
                  <code className="flex-1 truncate font-mono text-xs text-text">{uri}</code>
                  <button
                    onClick={() => copy(uri)}
                    className="shrink-0 text-xs text-muted hover:text-accent"
                  >
                    {copied === uri ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNum>4</StepNum>
          <div className="flex-1">
            <p>
              Open the app’s <span className="font-medium text-text">Settings</span>, copy the{' '}
              <span className="font-medium text-text">Client ID</span>, and paste it here:
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                placeholder="e.g. 3a9…f1c"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
              />
              <button
                onClick={() => void submit()}
                disabled={!value.trim() || saving}
                className="shrink-0 rounded-lg bg-[#1db954] px-4 py-2 text-sm font-semibold text-black hover:bg-[#1ed760] disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {canCancel && (
                <button
                  onClick={onCancel}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-text"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </li>
      </ol>
    </div>
  )
}

function StepNum({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text">
      {children}
    </span>
  )
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
  trackSong,
  jobs,
  doneSongs,
  onImport,
  onImportAll,
  onOpenSong,
  onBack
}: {
  title: string
  tracks: SpotifyTrack[] | null
  trackSong: Record<string, string>
  jobs: Record<string, JobUi>
  doneSongs: Record<string, true>
  onImport: (track: SpotifyTrack) => void
  onImportAll: (tracks: SpotifyTrack[]) => void
  onOpenSong: (songId: string) => void
  onBack: () => void
}): React.JSX.Element {
  // Tracks that "Import all" would still act on: untouched, or errored (retry).
  // Pending clicks, running jobs and finished imports are left alone.
  const remaining = (tracks ?? []).filter((t) => {
    const songId = trackSong[t.id]
    if (songId === undefined) return true
    if (songId === '') return false
    if (doneSongs[songId]) return false
    const job = jobs[songId]
    return !job || !!job.error
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-text"
        >
          ← Playlists
        </button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
        {tracks && tracks.length > 0 && (
          <button
            onClick={() => onImportAll(tracks)}
            disabled={remaining.length === 0}
            className="shrink-0 rounded-full bg-[#1db954] px-4 py-1.5 text-xs font-semibold text-black hover:bg-[#1ed760] disabled:opacity-60"
          >
            {remaining.length === 0 ? 'All imported ✓' : `Import all · ${remaining.length}`}
          </button>
        )}
      </div>

      <div className="mb-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-muted">
        Import finds each track on YouTube, downloads the audio, and separates it into stems
        locally. “Import all” queues every track one-by-one and collects them into a local playlist
        named “{title}”.
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
          {tracks.map((t, i) => {
            const songId = trackSong[t.id]
            const job = songId ? jobs[songId] : undefined
            const isDone = !!songId && doneSongs[songId]
            const pending = songId === '' // click landed, awaiting the songId
            return (
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
                <div className="flex w-40 shrink-0 justify-end">
                  <ImportControl
                    isDone={isDone}
                    pending={pending}
                    job={job}
                    onImport={() => onImport(t)}
                    onOpen={() => songId && onOpenSong(songId)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ImportControl({
  isDone,
  pending,
  job,
  onImport,
  onOpen
}: {
  isDone: boolean
  pending: boolean
  job: JobUi | undefined
  onImport: () => void
  onOpen: () => void
}): React.JSX.Element {
  if (isDone) {
    return (
      <button
        onClick={onOpen}
        className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20"
      >
        Open in studio ↗
      </button>
    )
  }

  if (job?.error) {
    return (
      <button
        onClick={onImport}
        title={job.error}
        className="rounded-full border border-stem-vocals/50 px-3 py-1 text-xs font-medium text-stem-vocals hover:bg-stem-vocals/10"
      >
        Retry
      </button>
    )
  }

  if (pending || job) {
    const stage = job ? STAGE_LABELS[job.stage] : 'Queued'
    const pct = job && job.progress > 0 ? Math.round(job.progress * 100) : null
    return (
      <div className="flex w-full flex-col items-end gap-1">
        <span className="text-[11px] text-muted">
          {stage}
          {pct != null ? ` ${pct}%` : ''}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: pct != null ? `${pct}%` : '15%' }}
          />
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={onImport}
      className="rounded-full bg-[#1db954] px-3 py-1 text-xs font-semibold text-black hover:bg-[#1ed760]"
    >
      Import
    </button>
  )
}

export default SpotifyImport
