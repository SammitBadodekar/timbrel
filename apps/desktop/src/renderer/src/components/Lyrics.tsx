import { useEffect, useRef, useState } from 'react'
import { activeLyricIndex, type Lyrics as LyricsData } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'
import TransportDock from './TransportDock'

/**
 * The scrolling line list, shared by the side panel and the full-screen modal.
 * The current line is highlighted off the transport clock — but the parent
 * subscribes to the *active line index* (a number), so a re-render happens only
 * when the highlighted line changes, not every RAF frame. `big` is the
 * karaoke-style full-screen variant.
 */
function LyricLines({
  lyrics,
  activeIndex,
  big = false
}: {
  lyrics: LyricsData
  activeIndex: number
  big?: boolean
}): React.JSX.Element {
  const activeRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  return (
    <ul className={big ? 'space-y-4 text-center' : 'space-y-1.5'}>
      {lyrics.lines.map((line, i) => {
        const active = lyrics.synced && i === activeIndex
        return (
          <li
            key={i}
            ref={active ? activeRef : undefined}
            onClick={() => {
              if (lyrics.synced) useStudioStore.getState().seek(line.timeSec)
            }}
            className={`leading-snug transition-colors ${lyrics.synced ? 'cursor-pointer' : ''} ${
              big ? 'text-2xl font-semibold' : 'text-sm'
            } ${
              active
                ? 'text-text'
                : lyrics.synced
                  ? big
                    ? 'text-fog hover:text-muted'
                    : 'text-muted hover:text-text'
                  : big
                    ? 'text-fog'
                    : 'text-muted'
            } ${big && !active ? 'opacity-60' : ''}`}
          >
            {line.text || ' '}
          </li>
        )
      })}
    </ul>
  )
}

/** The full-screen "just the lyrics" reader. */
function LyricsModal({
  lyrics,
  activeIndex,
  title,
  onClose
}: {
  lyrics: LyricsData
  activeIndex: number
  title: string | undefined
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="animate-rise fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold">{title ?? 'Lyrics'}</span>
          <span className="text-[10px] uppercase tracking-wide text-fog">
            {lyrics.synced ? 'synced' : 'plain'} · {lyrics.source}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted hover:border-accent hover:text-text"
          title="Exit full screen (Esc)"
        >
          Exit full screen
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 pb-[30vh] pt-[26vh]">
          <LyricLines lyrics={lyrics} activeIndex={activeIndex} big />
        </div>
      </div>

      {/* The transport HUD floats over the reader so you can play / seek / change
          tempo without leaving full screen. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
        <div className="pointer-events-auto">
          <TransportDock />
        </div>
      </div>
    </div>
  )
}

/**
 * Synced-lyrics side panel with a full-screen reader option.
 */
function Lyrics({ onClose }: { onClose: () => void }): React.JSX.Element {
  const lyrics = useStudioStore((s) => s.lyrics)
  const loading = useStudioStore((s) => s.lyricsLoading)
  const title = useStudioStore((s) => s.project?.title)
  const activeIndex = useStudioStore((s) => {
    const ly = s.lyrics
    return ly && ly.synced ? activeLyricIndex(ly.lines, s.currentTime) : -1
  })
  const [fullscreen, setFullscreen] = useState(false)

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Lyrics</span>
          {lyrics && (
            <span className="text-[10px] uppercase tracking-wide text-fog">
              {lyrics.synced ? 'synced' : 'plain'} · {lyrics.source}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lyrics && (
            <button
              onClick={() => setFullscreen(true)}
              className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
              title="Full screen"
              aria-label="Open lyrics full screen"
            >
              ⤢
            </button>
          )}
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
            title="Hide lyrics"
            aria-label="Hide lyrics"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="text-sm text-muted">Looking up lyrics…</p>
        ) : !lyrics ? (
          <p className="text-sm text-muted">
            No lyrics found for this track. They&apos;re matched by title, artist and length — a
            cleaner title helps.
          </p>
        ) : (
          <LyricLines lyrics={lyrics} activeIndex={activeIndex} />
        )}
      </div>

      {fullscreen && lyrics && (
        <LyricsModal
          lyrics={lyrics}
          activeIndex={activeIndex}
          title={title}
          onClose={() => setFullscreen(false)}
        />
      )}
    </aside>
  )
}

export default Lyrics
