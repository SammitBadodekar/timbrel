import { useEffect, useRef, useState } from 'react'
import { STEM_COLORS, type StemKind } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'
import StemRow from './StemRow'
import Waveform from './Waveform'
import ExportPanel from './ExportPanel'
import Lyrics from './Lyrics'
import TransportDock from './TransportDock'
import StudioSkeleton from './StudioSkeleton'
import { OutputButton } from './AudioOutput'

interface StudioProps {
  songId: string
  onBack: () => void
}

/** Gutter (channel-strip) width in px — must match `StemRow`'s `w-40` so the
 *  playhead overlay lines up with the start of the waveform lanes. */
const GUTTER = 160
/** Height of the interactive loop ruler above the lanes (px). */
const RULER_H = 22
/** Pixel radius around a loop edge that grabs the resize handle. */
const HANDLE_PX = 6
/** Below this, a drag on the ruler is treated as a click (clears the loop). */
const MIN_LOOP_SEC = 0.15
const NO_PEAKS: number[] = []

/** Pixels the pointer must travel before a ruler press counts as a drag (vs a
 *  click) — keeps a stray click from wiping an existing loop. */
const DRAG_SLOP_PX = 3

/** How the current pointer drag on the loop ruler mutates the region. `create`
 *  holds off until the pointer actually moves, so a click never destroys the
 *  existing loop; `id` is minted once the drag begins. */
type LoopDrag =
  | { mode: 'create'; anchorSec: number; anchorClientX: number; id: string | null }
  | { mode: 'move'; grabOffsetSec: number; widthSec: number }
  | { mode: 'resize-start' }
  | { mode: 'resize-end' }

/**
 * The moving parts that update every RAF frame live in leaf components so the
 * (large) `Studio` shell only re-renders on real user actions — it never
 * subscribes to `currentTime`. (The transport scrubber lives in `TransportDock`.)
 */
function Playhead({ variant }: { variant: 'ruler' | 'lane' }): React.JSX.Element {
  const x = useStudioStore((s) => (s.duration > 0 ? (s.currentTime / s.duration) * s.laneW : 0))
  return variant === 'ruler' ? (
    <div
      className="pointer-events-none absolute top-0 w-px bg-text"
      style={{ height: RULER_H, transform: `translateX(${x}px)` }}
    />
  ) : (
    <div
      className="absolute w-px bg-text/80"
      style={{ top: 0, bottom: 0, transform: `translateX(${x}px)` }}
    />
  )
}

/**
 * One lane's waveform. Subscribes to only its own peaks + solo state, so a
 * fader drag or solo toggle re-renders the affected lanes — never the whole
 * Studio shell (which deliberately does not subscribe to `controls`/`peaks`).
 */
function LaneWaveform({ kind }: { kind: StemKind }): React.JSX.Element {
  const peaks = useStudioStore((s) => s.peaks[kind] ?? NO_PEAKS)
  const soloed = useStudioStore((s) => s.controls[kind].soloed)
  const anySolo = useStudioStore((s) => s.stemKinds.some((k) => s.controls[k].soloed))
  return <Waveform peaks={peaks} color={STEM_COLORS[kind]} dimmed={anySolo && !soloed} />
}

/**
 * The loop-region highlight (ruler band / full-height lane band). A loop drag
 * streams `setLoop` at pointer-move rate, so these subscribe to `loop` in a
 * leaf instead of re-rendering the Studio shell per move.
 */
function LoopBand({ variant }: { variant: 'ruler' | 'lane' }): React.JSX.Element | null {
  const loop = useStudioStore((s) => s.loop)
  const duration = useStudioStore((s) => s.duration)
  const laneW = useStudioStore((s) => s.laneW)
  if (!loop || duration <= 0) return null
  const left = (loop.startSec / duration) * laneW
  const width = Math.max(1, (loop.endSec / duration) * laneW - left)
  if (variant === 'ruler') {
    return (
      <div
        className="absolute inset-y-0 border-x"
        style={{
          left,
          width,
          background: loop.enabled ? 'rgba(0,105,224,0.22)' : 'rgba(120,130,145,0.14)',
          borderColor: loop.enabled ? 'var(--color-accent)' : 'var(--color-border)'
        }}
      />
    )
  }
  return (
    <div
      className="absolute inset-y-0"
      style={{
        left,
        width,
        background: loop.enabled ? 'rgba(0,105,224,0.06)' : 'rgba(120,130,145,0.05)',
        borderLeft: `1px solid ${loop.enabled ? 'rgba(0,105,224,0.4)' : 'rgba(120,130,145,0.25)'}`,
        borderRight: `1px solid ${loop.enabled ? 'rgba(0,105,224,0.4)' : 'rgba(120,130,145,0.25)'}`
      }}
    />
  )
}

function Studio({ songId, onBack }: StudioProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const loopDrag = useRef<LoopDrag | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)

  // Deliberately NOT subscribed here: `controls`, `peaks`, `loop`, `tempoKey`,
  // `currentTime`. Those change at pointer-drag / RAF rate and live in leaf
  // components (LaneWaveform, LoopBand, LoopControls, TempoKeyControls,
  // Playhead) so continuous gestures never re-render this shell.
  const loading = useStudioStore((s) => s.loading)
  const error = useStudioStore((s) => s.error)
  const project = useStudioStore((s) => s.project)
  const stemKinds = useStudioStore((s) => s.stemKinds)
  const playing = useStudioStore((s) => s.playing)
  const duration = useStudioStore((s) => s.duration)
  const exportOpen = useStudioStore((s) => s.exportOpen)

  // Load the song into the store on mount; dispose (flush save + tear down the
  // engine) on unmount. StrictMode's double-invoke is handled by the store's
  // load token.
  useEffect(() => {
    void useStudioStore.getState().load(songId)
    return () => useStudioStore.getState().dispose()
  }, [songId])

  // 60fps transport clock: the store's `tick` reflects the engine clock and
  // drives loop-wrap / end-of-song. Only runs while the transport moves —
  // paused/stopped, the clock is static (seeks write the store directly), so
  // the tab fully idles.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      useStudioStore.getState().tick()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Measure the lane region for the playhead overlay. Resize events outpace
  // frames while the window edge is dragged — coalesce to one per frame.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const update = (): void =>
      useStudioStore.getState().setLaneSize(el.clientWidth, el.clientHeight)
    update()
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [loading, stemKinds.length])

  const seekFromLane = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    useStudioStore.getState().seek(((e.clientX - rect.left) / rect.width) * duration)
  }

  // --- Loop ruler drag: create / move / resize a single region --------------
  const timeFromRulerX = (clientX: number): number => {
    const rect = rulerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const ratio = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(1, ratio)) * duration
  }

  const onRulerPointerMove = (e: PointerEvent): void => {
    const drag = loopDrag.current
    if (!drag) return
    const t = timeFromRulerX(e.clientX)
    const { setLoop } = useStudioStore.getState()
    if (drag.mode === 'create') {
      // Wait for real movement before minting a region (so a click is a no-op).
      if (drag.id === null) {
        if (Math.abs(e.clientX - drag.anchorClientX) < DRAG_SLOP_PX) return
        drag.id = crypto.randomUUID()
      }
      setLoop({
        id: drag.id,
        startSec: Math.min(drag.anchorSec, t),
        endSec: Math.max(drag.anchorSec, t),
        enabled: true
      })
      return
    }
    setLoop((l) => {
      if (!l) return l
      switch (drag.mode) {
        case 'resize-start':
          return { ...l, startSec: Math.min(t, l.endSec) }
        case 'resize-end':
          return { ...l, endSec: Math.max(t, l.startSec) }
        case 'move': {
          const start = Math.max(0, Math.min(t - drag.grabOffsetSec, duration - drag.widthSec))
          return { ...l, startSec: start, endSec: start + drag.widthSec }
        }
        default:
          return l
      }
    })
  }

  const onRulerPointerUp = (): void => {
    window.removeEventListener('pointermove', onRulerPointerMove)
    // A too-short region means it was really a click — clear the loop.
    useStudioStore.getState().setLoop((l) => (l && l.endSec - l.startSec < MIN_LOOP_SEC ? null : l))
    loopDrag.current = null
  }

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (duration === 0) return
    e.preventDefault()
    const rect = rulerRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const t = timeFromRulerX(e.clientX)

    const create: LoopDrag = { mode: 'create', anchorSec: t, anchorClientX: e.clientX, id: null }
    const current = useStudioStore.getState().loop
    if (current) {
      const startX = (current.startSec / duration) * rect.width
      const endX = (current.endSec / duration) * rect.width
      if (Math.abs(px - startX) <= HANDLE_PX) loopDrag.current = { mode: 'resize-start' }
      else if (Math.abs(px - endX) <= HANDLE_PX) loopDrag.current = { mode: 'resize-end' }
      else if (px > startX && px < endX)
        loopDrag.current = {
          mode: 'move',
          grabOffsetSec: t - current.startSec,
          widthSec: current.endSec - current.startSec
        }
      else loopDrag.current = create
    } else {
      loopDrag.current = create
    }

    window.addEventListener('pointermove', onRulerPointerMove)
    window.addEventListener('pointerup', onRulerPointerUp, { once: true })
  }

  const features = project?.features

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={onBack}
          className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted hover:border-accent hover:text-text"
        >
          ← Library
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-base font-semibold">{project?.title ?? 'Loading…'}</h1>
          {project?.title && features && (
            <span className="shrink-0 text-sm text-muted">
              {(project.source.type === 'youtube' && project.source.channel) || ''}
            </span>
          )}
        </div>
        {features && (
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            {features.bpm != null && (
              <span className="rounded-full bg-wash-powder px-2.5 py-1 text-xs font-semibold tabular-nums text-charcoal">
                {Math.round(features.bpm)} BPM
              </span>
            )}
            {features.key && (
              <span className="rounded-full bg-wash-lavender px-2.5 py-1 text-xs font-semibold text-charcoal">
                {features.key}
              </span>
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={() => setLyricsOpen((v) => !v)}
            className="rounded-full border px-3.5 py-2 text-sm font-medium transition-colors"
            style={{
              background: lyricsOpen ? 'var(--color-charcoal)' : 'var(--color-surface)',
              borderColor: lyricsOpen ? 'var(--color-charcoal)' : 'var(--color-border)',
              color: lyricsOpen ? '#fff' : 'var(--color-muted)'
            }}
            title="Show synced lyrics"
          >
            Lyrics
          </button>
          <OutputButton />
          <button
            onClick={() => useStudioStore.getState().openExport()}
            className="rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-white hover:bg-charcoal-hover"
            title="Export stems, mixdown, minus-one, or a click track"
          >
            Export
          </button>
        </div>
      </header>

      {loading && <StudioSkeleton />}
      {error && <div className="p-6 text-sm text-danger">{error}</div>}

      {!loading && !error && (
        <>
          {/* Lanes = the hero, in one rounded card (+ optional lyrics panel). */}
          <div className="flex min-h-0 flex-1 gap-4 px-5 pb-2">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border bg-surface">
              <div className="flex-1 overflow-y-auto">
                <div className="relative min-h-full">
                  {/* Loop ruler — drag to create, grab an edge to resize, body to move. */}
                  <div
                    className="absolute top-0 z-10 flex items-center justify-end px-2 text-[10px] font-semibold uppercase tracking-wide text-fog"
                    style={{ left: 0, width: GUTTER, height: RULER_H }}
                  >
                    Loop
                  </div>
                  <div
                    ref={rulerRef}
                    onPointerDown={onRulerPointerDown}
                    className="absolute top-0 z-10 cursor-pointer border-b border-l border-border bg-surface-2"
                    style={{ left: GUTTER, right: 0, height: RULER_H }}
                    title="Drag to set a loop region"
                  >
                    <LoopBand variant="ruler" />
                    <Playhead variant="ruler" />
                  </div>

                  <div style={{ paddingTop: RULER_H }}>
                    {stemKinds.map((kind) => (
                      <div
                        key={kind}
                        className="animate-rise flex items-stretch border-b border-border/70 last:border-b-0"
                      >
                        <StemRow kind={kind} />
                        <div
                          className="relative h-20 flex-1 cursor-pointer border-l border-border bg-surface-2/50"
                          onClick={seekFromLane}
                        >
                          <LaneWaveform kind={kind} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Loop band + playhead, spanning only the lane column. Offset
                      by the lane's 1px left border so the playhead lines up
                      exactly with the waveform pixels (and the ruler playhead,
                      which sits inside the ruler's matching border). */}
                  <div
                    ref={overlayRef}
                    className="pointer-events-none absolute"
                    style={{ top: RULER_H, bottom: 0, left: GUTTER + 1, right: 0 }}
                  >
                    <LoopBand variant="lane" />
                    <Playhead variant="lane" />
                  </div>
                </div>
              </div>
            </div>
            {lyricsOpen && <Lyrics onClose={() => setLyricsOpen(false)} />}
          </div>

          {/* Bottom HUD dock — everything rhythmic lives here. */}
          <div className="shrink-0 px-5 pb-5 pt-1">
            <TransportDock />
          </div>

          {exportOpen && <ExportPanel />}
        </>
      )}
    </div>
  )
}

export default Studio
