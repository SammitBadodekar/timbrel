import { useEffect, useRef } from 'react'
import { activeLyricIndex } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'

/**
 * Synced-lyrics side panel. The current line is highlighted off the transport
 * clock — but we subscribe to the *active line index* (a number), so this panel
 * only re-renders when the highlighted line changes, not every RAF frame.
 */
function Lyrics({ onClose }: { onClose: () => void }): React.JSX.Element {
  const lyrics = useStudioStore((s) => s.lyrics)
  const loading = useStudioStore((s) => s.lyricsLoading)
  const activeIndex = useStudioStore((s) => {
    const ly = s.lyrics
    return ly && ly.synced ? activeLyricIndex(ly.lines, s.currentTime) : -1
  })

  const activeRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface/40">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Lyrics</span>
          {lyrics && (
            <span className="text-[10px] uppercase tracking-wide text-muted">
              {lyrics.synced ? 'synced' : 'plain'} · {lyrics.source}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-text"
          title="Hide lyrics"
          aria-label="Hide lyrics"
        >
          ✕
        </button>
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
          <ul className="space-y-1.5">
            {lyrics.lines.map((line, i) => {
              const active = lyrics.synced && i === activeIndex
              return (
                <li
                  key={i}
                  ref={active ? activeRef : undefined}
                  onClick={() => {
                    if (lyrics.synced) useStudioStore.getState().seek(line.timeSec)
                  }}
                  className={`text-sm leading-snug transition-colors ${
                    lyrics.synced ? 'cursor-pointer' : ''
                  } ${
                    active
                      ? 'font-semibold text-text'
                      : lyrics.synced
                        ? 'text-muted hover:text-text'
                        : 'text-muted'
                  }`}
                >
                  {line.text || ' '}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

export default Lyrics
