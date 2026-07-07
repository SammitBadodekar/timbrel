import { useCallback, useEffect, useState } from 'react'
import type { PlaylistSummary } from '@timbrel/core'
import type { PlaylistDetail as PlaylistDetailData, SongSummary } from '@shared/ipc'
import TrackRow from './TrackRow'
import SongArt from './SongArt'
import ConfirmDialog from './ConfirmDialog'
import AddToPlaylistMenu from './AddToPlaylistMenu'

interface PlaylistDetailProps {
  playlistId: string
  onBack: () => void
  onOpenSong: (songId: string) => void
}

function totalLabel(songs: SongSummary[]): string {
  const total = songs.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
  const tracks = songs.length === 1 ? '1 track' : `${songs.length} tracks`
  if (!total) return tracks
  return `${tracks} · ${Math.max(1, Math.round(total / 60))} min`
}

function PlaylistDetail({
  playlistId,
  onBack,
  onOpenSong
}: PlaylistDetailProps): React.JSX.Element {
  const [data, setData] = useState<PlaylistDetailData | null>(null)
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [addTarget, setAddTarget] = useState<string[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const d = await window.timbrel.getPlaylist(playlistId)
    setData(d)
    setSongs(d?.songs ?? [])
  }, [playlistId])

  // Load on mount / id change. Fetched inline (with a liveness guard) so state
  // is only set after the async result — never synchronously in the effect.
  useEffect(() => {
    let alive = true
    void window.timbrel.getPlaylist(playlistId).then((d) => {
      if (!alive) return
      setData(d)
      setSongs(d?.songs ?? [])
    })
    void window.timbrel.listPlaylists().then((p) => {
      if (alive) setPlaylists(p)
    })
    return () => {
      alive = false
    }
  }, [playlistId])

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

  const commitRename = async (): Promise<void> => {
    const name = draft.trim()
    setRenaming(false)
    if (data && name && name !== data.name) {
      await window.timbrel.renamePlaylist(playlistId, name)
      await refresh()
    }
  }

  const toggleSelect = (id: string): void =>
    setSelection((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const removeMany = async (ids: string[]): Promise<void> => {
    setSongs((s) => s.filter((x) => !ids.includes(x.id)))
    setSelection(new Set())
    await Promise.all(ids.map((id) => window.timbrel.removeSongFromPlaylist(playlistId, id)))
  }

  const onDrop = async (target: number): Promise<void> => {
    if (dragIndex === null || dragIndex === target) return
    const next = [...songs]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(target, 0, moved!)
    setSongs(next)
    setDragIndex(null)
    await window.timbrel.reorderPlaylist(
      playlistId,
      next.map((s) => s.id)
    )
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8 text-sm text-muted">Loading playlist…</div>
    )
  }

  const selectionActive = selection.size > 0
  const allSelected = songs.length > 0 && songs.every((s) => selection.has(s.id))

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-6 py-8">
      <button
        onClick={onBack}
        className="mb-6 w-fit rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted hover:border-accent hover:text-text"
      >
        ← Home
      </button>

      <header className="mb-8 flex items-end gap-5">
        <div className="grid h-28 w-40 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl shadow-[var(--shadow-card)]">
          {Array.from({ length: 4 }, (_, i) => data.songs[i]).map((s, i) =>
            s ? (
              <SongArt
                key={s.id}
                id={s.id}
                title={s.title}
                thumbnailUrl={s.thumbnailUrl}
                className="h-full w-full"
                monoClass="text-lg"
              />
            ) : (
              <div key={`e-${i}`} className="bg-surface-2" />
            )
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fog">Playlist</div>
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                else if (e.key === 'Escape') setRenaming(false)
              }}
              onBlur={() => void commitRename()}
              className="mt-1 w-full rounded-xl border border-accent bg-surface-2 px-3 py-1.5 text-3xl font-semibold outline-none"
            />
          ) : (
            <h1
              className="mt-1 cursor-text truncate text-3xl font-semibold tracking-tight"
              title="Click to rename"
              onClick={() => {
                setDraft(data.name)
                setRenaming(true)
              }}
            >
              {data.name}
            </h1>
          )}
          <div className="mt-1 text-sm tabular-nums text-muted">{totalLabel(songs)}</div>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="shrink-0 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted hover:border-danger hover:text-danger"
        >
          Delete
        </button>
      </header>

      {songs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-base font-semibold">No tracks in this playlist yet</p>
          <p className="max-w-sm text-sm text-muted">
            Back on Home, hover a track and hit <span className="font-semibold">+ Playlist</span> to
            add it here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fog">
              Tracks
            </span>
            <button
              onClick={() =>
                setSelection(allSelected ? new Set() : new Set(songs.map((s) => s.id)))
              }
              className="text-xs font-semibold text-muted hover:text-accent"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-col pb-24">
            {songs.map((song, i) => (
              <TrackRow
                key={song.id}
                variant="playlist"
                song={song}
                onOpen={() => onOpenSong(song.id)}
                onRemove={() => void removeMany([song.id])}
                selectionActive={selectionActive}
                selected={selection.has(song.id)}
                onToggleSelect={() => toggleSelect(song.id)}
                dragging={dragIndex === i}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void onDrop(i)}
                onDragEnd={() => setDragIndex(null)}
              />
            ))}
          </div>
        </>
      )}

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
              onClick={() => void removeMany([...selection])}
              className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-danger hover:border-danger"
            >
              Remove
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

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <div className="animate-rise rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-dock)]">
            {toast}
          </div>
        </div>
      )}

      {addTarget && (
        <AddToPlaylistMenu
          songIds={addTarget}
          playlists={playlists}
          onClose={() => setAddTarget(null)}
          onDone={(name) => {
            void window.timbrel.listPlaylists().then(setPlaylists)
            setSelection(new Set())
            flashToast(`Added to ${name}`)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${data.name}"?`}
          body="This deletes the playlist only. Every track in it stays in your library."
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            void (async () => {
              await window.timbrel.deletePlaylist(playlistId)
              onBack()
            })()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

export default PlaylistDetail
