import type { SongSummary } from '@shared/ipc'
import { STAGE_LABELS, type JobUi } from '../types'
import { formatTime } from '../lib/format'

interface LibraryProps {
  songs: SongSummary[]
  jobs: Record<string, JobUi>
  busy: boolean
  onUpload: () => void
  onOpen: (songId: string) => void
}

function Library({ songs, jobs, busy, onUpload, onOpen }: LibraryProps): React.JSX.Element {
  const jobEntries = Object.entries(jobs)

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            Timbrel
          </div>
          <h1 className="text-2xl font-semibold">Library</h1>
        </div>
        <button
          onClick={onUpload}
          disabled={busy}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Working…' : '+ Add track'}
        </button>
      </header>

      {jobEntries.length > 0 && (
        <section className="mb-8 space-y-3">
          {jobEntries.map(([songId, job]) => (
            <div key={songId} className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-medium">{songId}</span>
                <span className={job.error ? 'text-stem-vocals' : 'text-muted'}>
                  {job.error ? job.error : STAGE_LABELS[job.stage]}
                </span>
              </div>
              {!job.error && (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round(job.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {songs.length === 0 && jobEntries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-lg font-medium">No tracks yet</p>
          <p className="max-w-sm text-sm text-muted">
            Add an audio file to split it into vocals, drums, bass, guitar, piano and
            other — all on-device.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {songs.map((song) => (
            <li key={song.id}>
              <button
                onClick={() => song.separated && onOpen(song.id)}
                disabled={!song.separated}
                className="flex w-full items-center gap-4 rounded-2xl border border-border bg-surface px-4 py-3 text-left hover:border-accent disabled:cursor-default disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{song.title}</div>
                  <div className="text-xs text-muted">
                    {song.artist ?? 'Unknown artist'}
                    {song.bpm ? ` · ${Math.round(song.bpm)} BPM` : ''}
                    {song.key ? ` · ${song.key}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {song.separated
                    ? song.durationSec
                      ? formatTime(song.durationSec)
                      : 'Ready'
                    : 'Processing…'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Library
