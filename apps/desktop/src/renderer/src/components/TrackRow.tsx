import type { SongSummary } from '@shared/ipc'
import type { JobUi } from '../types'
import { formatTime } from '../lib/format'
import { jobProgress, IMPORT_ETA_LABEL } from '../lib/jobProgress'
import SongArt from './SongArt'

/** BPM + key as pastel chips — the "collectible" metadata treatment. */
function MetaChips({ song }: { song: SongSummary }): React.JSX.Element | null {
  if (song.bpm == null && song.key == null) return null
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      {song.bpm != null && (
        <span className="rounded-full bg-wash-powder px-2.5 py-1 text-xs font-semibold tabular-nums text-charcoal">
          {Math.round(song.bpm)} BPM
        </span>
      )}
      {song.key && (
        <span className="rounded-full bg-wash-lavender px-2.5 py-1 text-xs font-semibold text-charcoal">
          {song.key}
        </span>
      )}
    </div>
  )
}

/** The one continuous, forward-only import loader shown inside a busy row. */
function ImportLoader({ job }: { job: JobUi }): React.JSX.Element {
  if (job.error) {
    return (
      <span className="max-w-[16rem] truncate text-xs font-medium text-danger">{job.error}</span>
    )
  }
  const { fraction, step, stepCount, label } = jobProgress(job)
  return (
    <div className="flex w-60 shrink-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-semibold text-muted">
          {label}
          <span className="font-medium text-fog">
            {' '}
            · {step}/{stepCount}
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap font-medium text-fog">{IMPORT_ETA_LABEL}</span>
      </div>
      <div className="progress-shimmer h-1 overflow-hidden rounded-full bg-black/[0.07]">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}

/** The square multi-select checkbox, shared by both row variants. */
function SelectCheckbox({
  selected,
  onToggle
}: {
  selected: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={selected ? 'Deselect' : 'Select'}
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors ${
        selected
          ? 'border-charcoal bg-charcoal text-white'
          : 'border-black/20 bg-surface text-transparent hover:border-black/40'
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path
          d="M1.5 5.2l2.3 2.3 4.7-4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

interface LibraryRowProps {
  variant: 'library'
  song: SongSummary
  job?: JobUi
  onOpen: () => void
  selectionActive: boolean
  selected: boolean
  onToggleSelect: () => void
  onAddToPlaylist: () => void
}

interface PlaylistRowProps {
  variant: 'playlist'
  song: SongSummary
  onOpen: () => void
  onRemove: () => void
  selectionActive: boolean
  selected: boolean
  onToggleSelect: () => void
  dragging: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}

type TrackRowProps = LibraryRowProps | PlaylistRowProps

/** A single track as a list row, in either the library or a playlist detail. */
function TrackRow(props: TrackRowProps): React.JSX.Element {
  const { song } = props
  const separated = song.separated

  if (props.variant === 'library') {
    const { job, selected, selectionActive, onToggleSelect, onAddToPlaylist, onOpen } = props
    const busy = !separated
    return (
      <div
        className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors ${
          selected ? 'bg-accent/[0.06]' : 'hover:bg-surface-2'
        } ${busy ? '' : 'cursor-pointer'}`}
        onClick={() => {
          if (busy) return
          if (selectionActive) onToggleSelect()
          else onOpen()
        }}
      >
        {/* selection checkbox — always shown (separated rows) so nothing shifts
            on hover; a spacer keeps busy rows aligned with it. */}
        {busy ? (
          <span className="w-[18px] shrink-0" aria-hidden />
        ) : (
          <SelectCheckbox selected={selected} onToggle={onToggleSelect} />
        )}

        <SongArt
          id={song.id}
          title={song.title}
          thumbnailUrl={song.thumbnailUrl}
          className="h-10 w-10 shrink-0 rounded-[10px]"
        />

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{song.title}</div>
          <div className="truncate text-xs text-muted">{song.artist ?? 'Unknown artist'}</div>
        </div>

        {busy ? (
          job ? (
            <ImportLoader job={job} />
          ) : (
            <span className="text-xs font-medium text-fog">Processing…</span>
          )
        ) : (
          <>
            <MetaChips song={song} />
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddToPlaylist()
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-text"
            >
              + Playlist
            </button>
            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-fog">
              {song.durationSec != null ? formatTime(song.durationSec) : 'Ready'}
            </span>
          </>
        )}
      </div>
    )
  }

  // playlist variant
  const {
    onOpen,
    onRemove,
    selected,
    selectionActive,
    onToggleSelect,
    dragging,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd
  } = props
  return (
    <div
      draggable={!selectionActive}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={() => (selectionActive ? onToggleSelect() : onOpen())}
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors ${
        selected ? 'bg-accent/[0.06]' : 'hover:bg-surface-2'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <SelectCheckbox selected={selected} onToggle={onToggleSelect} />
      <span
        className="shrink-0 cursor-grab text-fog/70 transition-colors hover:text-fog active:cursor-grabbing"
        aria-hidden
        title="Drag to reorder"
      >
        ⠿
      </span>
      <SongArt
        id={song.id}
        title={song.title}
        thumbnailUrl={song.thumbnailUrl}
        className="h-10 w-10 shrink-0 rounded-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{song.title}</div>
        <div className="truncate text-xs text-muted">{song.artist ?? 'Unknown artist'}</div>
      </div>
      <MetaChips song={song} />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted hover:border-danger hover:text-danger"
        title="Remove from this playlist"
      >
        Remove
      </button>
      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-fog">
        {song.durationSec != null ? formatTime(song.durationSec) : 'Ready'}
      </span>
    </div>
  )
}

export default TrackRow
