import { useCallback, useEffect, useState } from 'react'
import type { YtCandidate } from '@timbrel/core'
import { formatTime } from '../lib/format'
import { STAGE_LABELS, type JobUi } from '../types'

interface SearchProps {
  onBack: () => void
  /** Open an imported (separated) song in the studio. */
  onOpenSong: (songId: string) => void
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error:\s*/, '')
}

/** Search any song on YouTube, download it, and separate it into stems. */
function Search({ onBack, onOpenSong }: SearchProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<YtCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Import state, keyed by the song id the main process returns per video.
  const [videoSong, setVideoSong] = useState<Record<string, string>>({})
  const [jobs, setJobs] = useState<Record<string, JobUi>>({})
  const [doneSongs, setDoneSongs] = useState<Record<string, true>>({})

  // Download+separation progress streams over the shared event channel, keyed by
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

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    setResults(null)
    try {
      setResults(await window.timbrel.youtubeSearch(q))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleImport = useCallback(async (video: YtCandidate) => {
    setError(null)
    setVideoSong((m) => (m[video.id] ? m : { ...m, [video.id]: '' }))
    try {
      const result = await window.timbrel.youtubeImport(video)
      if (!result.ok) {
        setError(errMsg(result.error))
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
      }
    } catch (e) {
      setError(errMsg(e))
      setVideoSong((m) => {
        const next = { ...m }
        delete next[video.id]
        return next
      })
    }
  }, [])

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <header className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-text"
        >
          ← Library
        </button>
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Add music</div>
          <h1 className="text-2xl font-semibold">Search &amp; download</h1>
        </div>
      </header>

      <div className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSearch()
          }}
          autoFocus
          placeholder="Search any song — artist and title…"
          className="min-w-0 flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
        />
        <button
          onClick={() => void handleSearch()}
          disabled={!query.trim() || searching}
          className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

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

      {results === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted">
            {searching ? 'Searching YouTube…' : 'Search for a song to download and separate.'}
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">No results — try different words.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {results.map((r) => {
            const songId = videoSong[r.id]
            const job = songId ? jobs[songId] : undefined
            const isDone = !!songId && doneSongs[songId]
            const pending = songId === ''
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface"
              >
                <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {r.thumbnailUrl && (
                    <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="truncate text-xs text-muted">
                    {r.channel ?? 'YouTube'}
                    {r.durationSec != null ? ` · ${formatTime(r.durationSec)}` : ''}
                  </div>
                </div>
                <div className="flex w-40 shrink-0 justify-end">
                  <ImportControl
                    isDone={isDone}
                    pending={pending}
                    job={job}
                    onImport={() => handleImport(r)}
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
      className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black hover:opacity-90"
    >
      Download
    </button>
  )
}

export default Search
