import { useEffect, useRef, useState } from 'react'
import type { PlaylistCover, PlaylistSummary } from '@timbrel/core'
import SongArt from './SongArt'

/** Minutes label for a playlist's total duration. */
function durationLabel(pl: PlaylistSummary): string {
  if (!pl.durationSec) return pl.trackCount === 1 ? '1 track' : `${pl.trackCount} tracks`
  const mins = Math.max(1, Math.round(pl.durationSec / 60))
  const tracks = pl.trackCount === 1 ? '1 track' : `${pl.trackCount} tracks`
  return `${tracks} · ${mins} min`
}

/** The 2×2 mosaic built from up to four member songs' artwork. */
function MosaicCover({ songs }: { songs: PlaylistCover[] }): React.JSX.Element {
  const tiles = Array.from({ length: 4 }, (_, i) => songs[i])
  return (
    <div className="grid aspect-[1.5/1] grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl">
      {tiles.map((s, i) =>
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
          <div key={`empty-${i}`} className="bg-surface-2" />
        )
      )}
    </div>
  )
}

interface PlaylistCardProps {
  playlist: PlaylistSummary
  onOpen: () => void
  onPlay: () => void
  onDelete: () => void
  /** Refresh the shelf after an inline rename. */
  onChanged: () => void
}

function PlaylistCard({
  playlist,
  onOpen,
  onPlay,
  onDelete,
  onChanged
}: PlaylistCardProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(playlist.name)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  // When a click outside the ⋯ menu dismisses it, swallow the click that would
  // otherwise also open the card.
  const swallowClick = useRef(false)

  // Close the ⋯ menu on any outside click. A `fixed inset-0` overlay would be
  // trapped by the card's hover transform (transforms create a containing block
  // for fixed descendants), so it can't cover the viewport — use the document.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (menuWrapRef.current?.contains(target)) return
      setMenuOpen(false)
      // Only swallow when the dismiss click lands on the card (which then fires
      // the card's own onClick); an outside click has no card click to swallow.
      if (cardRef.current?.contains(target)) {
        swallowClick.current = true
        window.setTimeout(() => (swallowClick.current = false), 0)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const commitRename = async (): Promise<void> => {
    const name = draft.trim()
    setRenaming(false)
    if (name && name !== playlist.name) {
      await window.timbrel.renamePlaylist(playlist.id, name)
      onChanged()
    } else {
      setDraft(playlist.name)
    }
  }

  // Any click on the card opens it — except one that just dismissed the menu, or
  // while the title is being renamed. Interactive controls stop propagation.
  const handleCardClick = (): void => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (!renaming) onOpen()
  }

  return (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !renaming) onOpen()
      }}
      aria-label={`Open playlist ${playlist.name}`}
      className="animate-pop group relative cursor-pointer rounded-3xl border border-border bg-surface p-3 transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
    >
      <MosaicCover songs={playlist.coverSongs} />

      <button
        onClick={(event) => {
          event.stopPropagation()
          onPlay()
        }}
        disabled={playlist.trackCount === 0}
        className="absolute bottom-[4.25rem] right-5 grid h-11 w-11 place-items-center rounded-full bg-charcoal pl-0.5 text-base text-white opacity-0 shadow-[var(--shadow-card)] transition-all hover:scale-105 hover:bg-charcoal-hover disabled:hidden group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`Play playlist ${playlist.name}`}
        title="Play playlist"
      >
        ▶
      </button>

      {/* ⋯ menu */}
      <div ref={menuWrapRef} className="absolute right-4 top-4">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className={`grid h-7 w-7 place-items-center rounded-full border border-border bg-surface/90 text-sm font-bold text-muted backdrop-blur transition-opacity hover:text-text group-hover:opacity-100 ${
            menuOpen ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Playlist options"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-[var(--shadow-dock)]">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                setDraft(playlist.name)
                setRenaming(true)
              }}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-surface-2"
            >
              Rename
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                onDelete()
              }}
              className="block w-full px-4 py-2 text-left text-sm text-danger hover:bg-surface-2"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="px-1 pb-1 pt-3">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              else if (e.key === 'Escape') {
                setRenaming(false)
                setDraft(playlist.name)
              }
            }}
            onBlur={() => void commitRename()}
            className="w-full rounded-lg border border-accent bg-surface-2 px-2 py-1 text-sm font-semibold outline-none"
          />
        ) : (
          <div className="truncate text-sm font-semibold">{playlist.name}</div>
        )}
        <div className="mt-0.5 truncate text-xs tabular-nums text-fog">
          {durationLabel(playlist)}
        </div>
      </div>
    </div>
  )
}

/** The dashed "start a new playlist" tile that closes the shelf. */
export function NewPlaylistCard({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-3xl border-[1.5px] border-dashed border-black/15 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-lg font-medium text-charcoal">
        +
      </span>
      New playlist
    </button>
  )
}

export default PlaylistCard
