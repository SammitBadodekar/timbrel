import type { YtCandidate } from '@timbrel/core'
import type { JobUi } from '../types'
import { formatTime } from '../lib/format'
import { jobProgress, IMPORT_ETA_LABEL } from '../lib/jobProgress'

interface SearchResultsProps {
  results: YtCandidate[]
  /** videoId → songId once an import has started (''=pending id). */
  videoSong: Record<string, string>
  jobs: Record<string, JobUi>
  doneSongs: Record<string, true>
  onImport: (video: YtCandidate) => void
  onOpenSong: (songId: string) => void
}

function ImportControl({
  songId,
  job,
  isDone,
  onImport,
  onOpen
}: {
  songId: string | undefined
  job: JobUi | undefined
  isDone: boolean
  onImport: () => void
  onOpen: () => void
}): React.JSX.Element {
  if (isDone) {
    return (
      <button
        onClick={onOpen}
        className="rounded-full border border-accent/50 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
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
        className="rounded-full border border-danger/50 px-3.5 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
      >
        Retry
      </button>
    )
  }
  const pending = songId === ''
  if (pending || job) {
    const { fraction, step, stepCount, label } = job
      ? jobProgress(job)
      : { fraction: 0.04, step: 1, stepCount: 5, label: 'Preparing' }
    return (
      <div className="flex w-56 flex-col gap-1.5">
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate font-semibold text-muted">
            {label}
            <span className="font-medium text-fog">
              {' '}
              · {step}/{stepCount}
            </span>
          </span>
          <span className="shrink-0 whitespace-nowrap font-medium text-fog">
            {IMPORT_ETA_LABEL}
          </span>
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
  return (
    <button
      onClick={onImport}
      className="rounded-full bg-charcoal px-4 py-1.5 text-xs font-semibold text-white hover:bg-charcoal-hover"
    >
      Download
    </button>
  )
}

/** The YouTube search results list — thumbnail, title, and an import control. */
function SearchResults({
  results,
  videoSong,
  jobs,
  doneSongs,
  onImport,
  onOpenSong
}: SearchResultsProps): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {results.map((r) => {
        const songId = videoSong[r.id]
        const job = songId ? jobs[songId] : undefined
        const isDone = !!songId && doneSongs[songId]
        return (
          <li
            key={r.id}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-2"
          >
            <div className="h-11 w-[74px] shrink-0 overflow-hidden rounded-xl bg-surface-2">
              {r.thumbnailUrl && (
                <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{r.title}</div>
              <div className="truncate text-xs text-muted">
                {r.channel ?? 'YouTube'}
                {r.durationSec != null ? ` · ${formatTime(r.durationSec)}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 justify-end">
              <ImportControl
                songId={songId}
                job={job}
                isDone={isDone}
                onImport={() => onImport(r)}
                onOpen={() => songId && onOpenSong(songId)}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default SearchResults
