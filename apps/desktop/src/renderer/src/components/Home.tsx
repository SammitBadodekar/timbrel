import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaylistSummary, YtCandidate } from '@timbrel/core'
import type { SongSummary } from '@shared/ipc'
import type { JobUi } from '../types'
import { OutputButton } from './AudioOutput'
import PlaylistCard, { NewPlaylistCard } from './PlaylistCard'
import TrackRow from './TrackRow'
import SearchResults from './SearchResults'
import AddToPlaylistMenu from './AddToPlaylistMenu'
import ConfirmDialog from './ConfirmDialog'

interface HomeProps {
  onOpenSong: (songId: string) => void
  onOpenPlaylist: (playlistId: string) => void
}

const AUDIO_EXT = /\.(mp3|m4a|wav|flac|ogg|oga|aac|aiff|aif)$/i

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error:\s*/, '')
}

/**
 * Home — the single entry point (v0.6): an omnibox that searches YouTube or
 * takes a dropped/added file, a shelf of playlists, and the full track list with
 * multi-select. Replaces the old separate Library + Search screens.
 */
function Home({ onOpenSong, onOpenPlaylist }: HomeProps): React.JSX.Element {
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [jobs, setJobs] = useState<Record<string, JobUi>>({})
  const [busy, setBusy] = useState(false)

  // Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<YtCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [videoSong, setVideoSong] = useState<Record<string, string>>({})
  const [doneSongs, setDoneSongs] = useState<Record<string, true>>({})

  // Multi-select + dialogs
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [addTarget, setAddTarget] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(
    null
  )
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [newName, setNewName] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const refreshSongs = useCallback(async () => setSongs(await window.timbrel.listSongs()), [])
  const refreshPlaylists = useCallback(
    async () => setPlaylists(await window.timbrel.listPlaylists()),
    []
  )

  // Initial load — fetch inline so state is set in the async callback, never
  // synchronously in the effect body.
  useEffect(() => {
    void window.timbrel.listSongs().then(setSongs)
    void window.timbrel.listPlaylists().then(setPlaylists)
  }, [])

  // Single subscription to the import/separation stream drives every job row.
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
        void refreshSongs()
        void refreshPlaylists()
      } else if (event.type === 'error' && event.songId) {
        setJobs((j) => ({
          ...j,
          [event.songId!]: { stage: 'queued', progress: 0, error: event.message }
        }))
      }
    })
  }, [refreshSongs, refreshPlaylists])

  // Escape clears an active selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && selection.size > 0) setSelection(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const flashToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600)
  }

  // --- Import ---------------------------------------------------------------
  const startLocalImport = useCallback(
    async (filePath: string) => {
      setBusy(true)
      try {
        const result = await window.timbrel.startSeparation({ filePath })
        if (!result.ok) {
          window.alert(`Could not start separation: ${result.error}`)
          return
        }
        if (result.alreadyExists) {
          onOpenSong(result.songId)
          return
        }
        setJobs((j) => ({ ...j, [result.songId]: { stage: 'queued', progress: 0 } }))
        await refreshSongs()
      } finally {
        setBusy(false)
      }
    },
    [onOpenSong, refreshSongs]
  )

  const handleAddFile = useCallback(async () => {
    const filePath = await window.timbrel.pickAudioFile()
    if (filePath) await startLocalImport(filePath)
  }, [startLocalImport])

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setResults(null)
    try {
      setResults(await window.timbrel.youtubeSearch(q))
    } catch (e) {
      setSearchError(errMsg(e))
    } finally {
      setSearching(false)
    }
  }, [query])

  const clearSearch = (): void => {
    setQuery('')
    setResults(null)
    setSearchError(null)
    setSearching(false)
  }

  const handleImport = useCallback(
    async (video: YtCandidate) => {
      setSearchError(null)
      setVideoSong((m) => (m[video.id] ? m : { ...m, [video.id]: '' }))
      try {
        const result = await window.timbrel.youtubeImport(video)
        if (!result.ok) {
          setSearchError(errMsg(result.error))
          setVideoSong((m) => {
            const next = { ...m }
            delete next[video.id]
            return next
          })
          return
        }
        setVideoSong((m) => ({ ...m, [video.id]: result.songId }))
        if (result.alreadyExists) {
          setDoneSongs((d) => ({ ...d, [result.songId]: true }))
        } else {
          setJobs((j) => ({ ...j, [result.songId]: { stage: 'queued', progress: 0 } }))
          // The row now exists in the library (inserted at import start), so
          // pull it in — clearing search then shows it mid-processing.
          await refreshSongs()
        }
      } catch (e) {
        setSearchError(errMsg(e))
        setVideoSong((m) => {
          const next = { ...m }
          delete next[video.id]
          return next
        })
      }
    },
    [refreshSongs]
  )

  // --- Drag & drop a file anywhere on Home ----------------------------------
  const dropDepth = useRef(0)
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    dropDepth.current = 0
    setDragOver(false)
    for (const file of Array.from(e.dataTransfer.files)) {
      const path = window.timbrel.pathForFile(file)
      if (path && AUDIO_EXT.test(path)) void startLocalImport(path)
    }
  }

  // --- Selection + delete ---------------------------------------------------
  const toggleSelect = (id: string): void =>
    setSelection((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const deleteSongs = (ids: string[]): void => {
    const many = ids.length > 1
    setConfirm({
      title: many ? `Delete ${ids.length} tracks?` : 'Delete this track?',
      body: `This permanently removes ${
        many ? 'their' : 'its'
      } audio and stems from disk. ${many ? 'They are' : "It's"} also removed from any playlists — the playlists themselves stay.`,
      run: () => {
        void (async () => {
          await Promise.all(ids.map((id) => window.timbrel.deleteSong(id)))
          setSelection(new Set())
          setConfirm(null)
          await refreshSongs()
          await refreshPlaylists()
        })()
      }
    })
  }

  const deletePlaylist = (pl: { id: string; name: string }): void =>
    setConfirm({
      title: `Delete "${pl.name}"?`,
      body: 'This deletes the playlist only. Every track in it stays in your library.',
      run: () => {
        void (async () => {
          await window.timbrel.deletePlaylist(pl.id)
          setConfirm(null)
          await refreshPlaylists()
        })()
      }
    })

  const createPlaylist = async (): Promise<void> => {
    const name = newName.trim()
    setCreatingPlaylist(false)
    setNewName('')
    if (!name) return
    const pl = await window.timbrel.createPlaylist(name)
    await refreshPlaylists()
    onOpenPlaylist(pl.id)
  }

  const searchActive = results !== null || searching
  const selectionActive = selection.size > 0

  // Select-all operates over the separated (selectable) tracks only.
  const selectableIds = songs.filter((s) => s.separated).map((s) => s.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selection.has(id))
  const toggleSelectAll = (): void => setSelection(allSelected ? new Set() : new Set(selectableIds))

  return (
    <div
      className="h-full overflow-y-auto"
      onDragEnter={(e) => {
        e.preventDefault()
        dropDepth.current += 1
        setDragOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dropDepth.current -= 1
        if (dropDepth.current <= 0) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {/* Top bar */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-charcoal">
              {/* mini stem-bars mark — same artwork as the app icon (build/icon.svg) */}
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.9" y="5" width="2" height="6" rx="1" fill="var(--color-stem-vocals)" />
                <rect x="5.3" y="3.75" width="2" height="8.5" rx="1" fill="var(--color-stem-drums)" />
                <rect x="8.7" y="2.5" width="2" height="11" rx="1" fill="var(--color-stem-bass)" />
                <rect x="12.1" y="3.5" width="2" height="9" rx="1" fill="var(--color-stem-guitar)" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">Timbrel</span>
          </div>
          <OutputButton />
        </div>

        {/* Omnibox */}
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface py-2 pl-5 pr-2 shadow-[0_10px_24px_-16px_rgba(4,69,144,0.35)] focus-within:border-accent">
            <svg
              width="17"
              height="17"
              viewBox="0 0 16 16"
              fill="none"
              className="shrink-0"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" stroke="#93979f" strokeWidth="1.6" />
              <path d="M10.5 10.5L14 14" stroke="#93979f" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
                else if (e.key === 'Escape' && searchActive) clearSearch()
              }}
              autoFocus
              placeholder="Search any song on YouTube…"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fog"
            />
            {searchActive && (
              <button
                onClick={clearSearch}
                className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
                title="Clear search"
              >
                ✕
              </button>
            )}
            <button
              onClick={() => void handleSearch()}
              disabled={!query.trim() || searching}
              className="shrink-0 rounded-full bg-charcoal px-5 py-2.5 text-sm font-medium text-white hover:bg-charcoal-hover disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <p className="mt-3 text-center text-[13px] text-fog">
            …or drop an audio file anywhere ·{' '}
            <button
              onClick={() => void handleAddFile()}
              disabled={busy}
              className="font-semibold text-accent hover:underline disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Add a file'}
            </button>
          </p>
        </div>

        {searchError && (
          <div className="mx-auto mt-5 flex max-w-2xl items-center justify-between rounded-2xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger">
            <span>{searchError}</span>
            <button
              onClick={() => setSearchError(null)}
              className="ml-3 shrink-0 opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {searchActive ? (
          /* ---- Search results ---- */
          <section className="mt-8">
            {searching && !results ? (
              <p className="py-10 text-center text-sm text-muted">Searching YouTube…</p>
            ) : results && results.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                No results — try different words.
              </p>
            ) : (
              results && (
                <SearchResults
                  results={results}
                  videoSong={videoSong}
                  jobs={jobs}
                  doneSongs={doneSongs}
                  onImport={handleImport}
                  onOpenSong={onOpenSong}
                />
              )
            )}
          </section>
        ) : (
          /* ---- Home: playlists shelf + track list ---- */
          <>
            <section className="mt-10">
              <h2 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-fog">
                Playlists {playlists.length > 0 && `· ${playlists.length}`}
              </h2>
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                {playlists.map((pl) => (
                  <PlaylistCard
                    key={pl.id}
                    playlist={pl}
                    onOpen={() => onOpenPlaylist(pl.id)}
                    onDelete={() => deletePlaylist({ id: pl.id, name: pl.name })}
                    onChanged={() => void refreshPlaylists()}
                  />
                ))}
                {creatingPlaylist ? (
                  <div className="flex min-h-[8rem] flex-col justify-center gap-2 rounded-3xl border-[1.5px] border-accent bg-surface p-4">
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void createPlaylist()
                        else if (e.key === 'Escape') {
                          setCreatingPlaylist(false)
                          setNewName('')
                        }
                      }}
                      onBlur={() => void createPlaylist()}
                      placeholder="Playlist name…"
                      className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
                    />
                    <span className="text-xs text-fog">Press ↵ to create</span>
                  </div>
                ) : (
                  <NewPlaylistCard onClick={() => setCreatingPlaylist(true)} />
                )}
              </div>
            </section>

            <section className="mt-9 pb-24">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fog">
                  All tracks {songs.length > 0 && `· ${songs.length}`}
                </h2>
                {selectableIds.length > 0 && (
                  <button
                    onClick={toggleSelectAll}
                    className="text-xs font-semibold text-muted hover:text-accent"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                )}
              </div>
              {songs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-3xl border border-border bg-surface py-16 text-center">
                  <p className="text-base font-semibold">No tracks yet</p>
                  <p className="max-w-sm text-sm text-muted">
                    Search a song above or drop an audio file to split it into vocals, drums, bass,
                    guitar, piano and other — all on-device.
                  </p>
                </div>
              ) : (
                <div className="rounded-3xl border border-border bg-surface p-1.5">
                  {songs.map((song) => (
                    <TrackRow
                      key={song.id}
                      variant="library"
                      song={song}
                      job={jobs[song.id]}
                      onOpen={() => onOpenSong(song.id)}
                      selectionActive={selectionActive}
                      selected={selection.has(song.id)}
                      onToggleSelect={() => toggleSelect(song.id)}
                      onAddToPlaylist={() => setAddTarget([song.id])}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Selection bulk bar */}
      {selectionActive && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <div className="animate-rise pointer-events-auto flex items-center gap-2.5 rounded-full border border-border bg-surface py-2 pl-5 pr-2.5 shadow-[var(--shadow-dock)]">
            <span className="text-sm font-semibold tabular-nums">{selection.size} selected</span>
            <button
              onClick={() => setAddTarget([...selection])}
              className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-muted hover:border-accent hover:text-text"
            >
              + Add to playlist
            </button>
            <button
              onClick={() => deleteSongs([...selection])}
              className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-danger hover:border-danger"
            >
              Delete
            </button>
            <button
              onClick={() => setSelection(new Set())}
              className="grid h-8 w-8 place-items-center rounded-full text-fog hover:bg-surface-2 hover:text-text"
              title="Clear selection"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <div className="animate-rise rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-dock)]">
            {toast}
          </div>
        </div>
      )}

      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-accent/5 backdrop-blur-[2px]">
          <div className="rounded-3xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-[var(--shadow-dock)]">
            <div className="text-3xl">🎵</div>
            <p className="mt-2 text-base font-semibold">Drop to add &amp; separate</p>
          </div>
        </div>
      )}

      {addTarget && (
        <AddToPlaylistMenu
          songIds={addTarget}
          playlists={playlists}
          onClose={() => setAddTarget(null)}
          onDone={(name) => {
            void refreshPlaylists()
            setSelection(new Set())
            flashToast(`Added to ${name}`)
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel="Delete"
          danger
          onConfirm={confirm.run}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

export default Home
