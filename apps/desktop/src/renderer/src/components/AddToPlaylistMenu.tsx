import { useEffect, useState } from 'react'
import type { PlaylistSummary } from '@timbrel/core'

interface AddToPlaylistMenuProps {
  /** The songs to add (one for a per-row action, many from the selection bar). */
  songIds: string[]
  playlists: PlaylistSummary[]
  onClose: () => void
  /** Called after a successful add/create so the caller can refresh + toast. */
  onDone: (playlistName: string) => void
}

/**
 * A small modal for filing songs into a playlist — pick an existing one or
 * create a new one on the spot. Used both by the per-row "+ Playlist" hover
 * action and the multi-select bulk bar.
 */
function AddToPlaylistMenu({
  songIds,
  playlists,
  onClose,
  onDone
}: AddToPlaylistMenuProps): React.JSX.Element {
  const [creating, setCreating] = useState(playlists.length === 0)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addToExisting = async (pl: PlaylistSummary): Promise<void> => {
    setBusy(true)
    await window.timbrel.addSongsToPlaylist(pl.id, songIds)
    onDone(pl.name)
    onClose()
  }

  const createAndAdd = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const pl = await window.timbrel.createPlaylist(trimmed)
    await window.timbrel.addSongsToPlaylist(pl.id, songIds)
    onDone(pl.name)
    onClose()
  }

  const count = songIds.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop flex max-h-[70vh] w-[400px] flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-dock)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">
            Add {count === 1 ? 'track' : `${count} tracks`} to…
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {playlists.length > 0 && (
            <div className="flex flex-col gap-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  disabled={busy}
                  onClick={() => void addToExisting(pl)}
                  className="flex items-center justify-between rounded-2xl px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="truncate text-sm font-medium">{pl.name}</span>
                  <span className="ml-3 shrink-0 text-xs text-fog">{pl.trackCount} tracks</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          {creating ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createAndAdd()
                }}
                placeholder="New playlist name…"
                className="min-w-0 flex-1 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                onClick={() => void createAndAdd()}
                disabled={!name.trim() || busy}
                className="shrink-0 rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-white hover:bg-charcoal-hover disabled:opacity-50"
              >
                Create
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-surface-2"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-wash-powder text-base leading-none text-charcoal">
                +
              </span>
              New playlist
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AddToPlaylistMenu
