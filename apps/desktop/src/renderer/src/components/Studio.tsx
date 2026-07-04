import { useEffect, useRef, useState } from 'react'
import { STEM_COLORS, transposeKey } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'
import { formatTime } from '../lib/format'
import StemRow from './StemRow'
import Waveform from './Waveform'
import BeatGrid from './BeatGrid'
import ExportPanel from './ExportPanel'
import Lyrics from './Lyrics'

interface StudioProps {
  songId: string
  onBack: () => void
}

/** Gutter (channel-strip) width in px — must match `StemRow`'s `w-40` so the
 *  beat-grid / playhead overlay lines up with the start of the waveform lanes. */
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
 * The moving parts that update every RAF frame live in these leaf components so
 * the (large) `Studio` shell only re-renders on real user actions — it never
 * subscribes to `currentTime`.
 */
function TransportScrubber(): React.JSX.Element {
  const currentTime = useStudioStore((s) => s.currentTime)
  const duration = useStudioStore((s) => s.duration)
  return (
    <>
      <span className="w-12 text-right font-mono text-sm tabular-nums text-muted">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={currentTime}
        onChange={(e) => useStudioStore.getState().seek(Number(e.target.value))}
        className="flex-1 accent-accent"
        aria-label="Seek"
      />
      <span className="w-12 font-mono text-sm tabular-nums text-muted">{formatTime(duration)}</span>
    </>
  )
}

function Playhead({ variant }: { variant: 'ruler' | 'lane' }): React.JSX.Element {
  const x = useStudioStore((s) => (s.duration > 0 ? (s.currentTime / s.duration) * s.laneW : 0))
  return variant === 'ruler' ? (
    <div
      className="pointer-events-none absolute top-0 w-px bg-accent"
      style={{ height: RULER_H, transform: `translateX(${x}px)` }}
    />
  ) : (
    <div
      className="absolute w-px bg-accent"
      style={{ top: 0, bottom: 0, transform: `translateX(${x}px)` }}
    />
  )
}

function Studio({ songId, onBack }: StudioProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const loopDrag = useRef<LoopDrag | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)

  const loading = useStudioStore((s) => s.loading)
  const error = useStudioStore((s) => s.error)
  const project = useStudioStore((s) => s.project)
  const stemKinds = useStudioStore((s) => s.stemKinds)
  const controls = useStudioStore((s) => s.controls)
  const peaks = useStudioStore((s) => s.peaks)
  const playing = useStudioStore((s) => s.playing)
  const countingIn = useStudioStore((s) => s.countingIn)
  const duration = useStudioStore((s) => s.duration)
  const beatGridOffsetSec = useStudioStore((s) => s.beatGridOffsetSec)
  const tempoKey = useStudioStore((s) => s.tempoKey)
  const loop = useStudioStore((s) => s.loop)
  const metronome = useStudioStore((s) => s.metronome)
  const countIn = useStudioStore((s) => s.countIn)
  const exportOpen = useStudioStore((s) => s.exportOpen)
  const laneW = useStudioStore((s) => s.laneW)
  const laneH = useStudioStore((s) => s.laneH)

  // Load the song into the store on mount; dispose (flush save + tear down the
  // engine) on unmount. StrictMode's double-invoke is handled by the store's
  // load token.
  useEffect(() => {
    void useStudioStore.getState().load(songId)
    return () => useStudioStore.getState().dispose()
  }, [songId])

  // 60fps transport clock: the store's `tick` reflects the engine clock and
  // drives loop-wrap / end-of-song.
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      useStudioStore.getState().tick()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Measure the lane region for the overlay (grid + playhead).
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const update = (): void =>
      useStudioStore.getState().setLaneSize(el.clientWidth, el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, stemKinds.length])

  const seekFromLane = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    useStudioStore.getState().seek(((e.clientX - rect.left) / rect.width) * duration)
  }

  const nudge = (deltaSec: number): void => useStudioStore.getState().nudge(deltaSec)

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

  const onTempo = (ratio: number): void => useStudioStore.getState().setTempo(ratio)
  const onSemitones = (semitones: number): void => useStudioStore.getState().setSemitones(semitones)

  const anySolo = stemKinds.some((k) => controls[k].soloed)
  const features = project?.features
  const hasGrid = !!features && features.beatTimes.length > 0

  const loopStartX = loop && duration > 0 ? (loop.startSec / duration) * laneW : 0
  const loopEndX = loop && duration > 0 ? (loop.endSec / duration) * laneW : 0

  const tempoPct = Math.round((tempoKey.tempoRatio - 1) * 100)
  const effectiveBpm = features?.bpm ? Math.round(features.bpm * tempoKey.tempoRatio) : null
  const shiftedKey = transposeKey(features?.key ?? null, tempoKey.semitones)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-border px-6 py-4">
        <button
          onClick={onBack}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
        >
          ← Library
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{project?.title ?? 'Loading…'}</h1>
          {features && (
            <p className="text-xs text-muted">
              {features.bpm ? `${Math.round(features.bpm)} BPM` : 'BPM —'}
              {' · '}
              {features.key ?? 'Key —'}
            </p>
          )}
        </div>
      </header>

      {loading && <div className="p-6 text-sm text-muted">Decoding stems…</div>}
      {error && <div className="p-6 text-sm text-stem-vocals">{error}</div>}

      {!loading && !error && (
        <>
          <div className="flex items-center gap-4 border-b border-border px-6 py-4">
            <button
              onClick={() => void useStudioStore.getState().togglePlay()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white hover:bg-accent-hover"
              aria-label={countingIn ? 'Cancel count-in' : playing ? 'Pause' : 'Play'}
            >
              {countingIn ? '…' : playing ? '❚❚' : '▶'}
            </button>
            <TransportScrubber />

            {hasGrid && (
              <div className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted">
                <span className="mr-0.5">Grid</span>
                <button
                  onClick={() => nudge(-0.01)}
                  className="h-5 w-5 rounded-md border border-border leading-none hover:text-text"
                  title="Nudge grid earlier (−10 ms)"
                >
                  −
                </button>
                <span className="w-14 text-center font-mono tabular-nums text-text">
                  {beatGridOffsetSec >= 0 ? '+' : ''}
                  {Math.round(beatGridOffsetSec * 1000)} ms
                </span>
                <button
                  onClick={() => nudge(0.01)}
                  className="h-5 w-5 rounded-md border border-border leading-none hover:text-text"
                  title="Nudge grid later (+10 ms)"
                >
                  +
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
            <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5 text-xs">
              <span className="text-muted">Tempo</span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.01}
                value={tempoKey.tempoRatio}
                onChange={(e) => onTempo(Number(e.target.value))}
                className="w-32 accent-accent"
                aria-label="Tempo"
              />
              <span className="w-24 text-right font-mono tabular-nums text-text">
                {effectiveBpm !== null
                  ? `${effectiveBpm} BPM`
                  : `${Math.round(tempoKey.tempoRatio * 100)}%`}
                <span className="text-muted">
                  {' '}
                  ({tempoPct >= 0 ? '+' : ''}
                  {tempoPct}%)
                </span>
              </span>
              <button
                onClick={() => onTempo(1)}
                disabled={tempoKey.tempoRatio === 1}
                className="rounded-md px-1 text-muted hover:text-text disabled:opacity-30"
                title="Reset tempo"
              >
                ↺
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
              <span className="text-muted">Key</span>
              <button
                onClick={() => onSemitones(tempoKey.semitones - 1)}
                disabled={tempoKey.semitones <= -12}
                className="h-5 w-5 rounded-md border border-border leading-none hover:text-text disabled:opacity-30"
                title="Down a semitone"
              >
                −
              </button>
              <span className="w-10 text-center font-mono tabular-nums text-text">
                {tempoKey.semitones >= 0 ? '+' : ''}
                {tempoKey.semitones} st
              </span>
              <button
                onClick={() => onSemitones(tempoKey.semitones + 1)}
                disabled={tempoKey.semitones >= 12}
                className="h-5 w-5 rounded-md border border-border leading-none hover:text-text disabled:opacity-30"
                title="Up a semitone"
              >
                +
              </button>
              {tempoKey.semitones !== 0 && shiftedKey && (
                <span className="text-muted">→ {shiftedKey}</span>
              )}
              <button
                onClick={() => onSemitones(0)}
                disabled={tempoKey.semitones === 0}
                className="ml-0.5 rounded-md px-1 text-muted hover:text-text disabled:opacity-30"
                title="Reset key"
              >
                ↺
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
              <button
                onClick={() => useStudioStore.getState().toggleLoop()}
                disabled={!loop}
                className="rounded-md px-1.5 py-0.5 font-medium disabled:opacity-40"
                style={{
                  background: loop?.enabled ? 'var(--color-accent)' : 'transparent',
                  color: loop?.enabled ? '#fff' : undefined
                }}
                title="Toggle loop"
              >
                Loop
              </button>
              {loop ? (
                <>
                  <span className="font-mono tabular-nums text-text">
                    {formatTime(loop.startSec)}–{formatTime(loop.endSec)}
                  </span>
                  <button
                    onClick={() => useStudioStore.getState().clearLoop()}
                    className="h-5 w-5 rounded-md border border-border leading-none text-muted hover:text-text"
                    title="Clear loop"
                  >
                    ×
                  </button>
                </>
              ) : (
                <span className="text-muted">drag over the tracks</span>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
              <button
                onClick={() => useStudioStore.getState().toggleMetronome()}
                className="rounded-md px-1.5 py-0.5 font-medium"
                style={{
                  background: metronome ? 'var(--color-accent)' : 'transparent',
                  color: metronome ? '#fff' : undefined
                }}
                title="Metronome click on every beat"
              >
                Metronome
              </button>
              <button
                onClick={() => useStudioStore.getState().toggleCountIn()}
                className="rounded-md px-1.5 py-0.5 font-medium"
                style={{
                  background: countIn ? 'var(--color-accent)' : 'transparent',
                  color: countIn ? '#fff' : undefined
                }}
                title="Count in one bar before playback"
              >
                Count-in
              </button>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setLyricsOpen((v) => !v)}
                className="rounded-full border border-border px-3 py-1.5 text-sm font-medium"
                style={{
                  background: lyricsOpen ? 'var(--color-accent)' : 'transparent',
                  color: lyricsOpen ? '#fff' : undefined
                }}
                title="Show synced lyrics"
              >
                Lyrics
              </button>
              <button
                onClick={() => useStudioStore.getState().openExport()}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                title="Export stems, mixdown, minus-one, or a click track"
              >
                Export
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="flex-1 overflow-y-auto">
              <div className="relative min-h-full">
                {/* Loop ruler — drag to create, grab an edge to resize, body to move. */}
                <div
                  className="absolute top-0 z-10 flex items-center justify-end px-2 text-[10px] uppercase tracking-wide text-muted"
                  style={{ left: 0, width: GUTTER, height: RULER_H }}
                >
                  Loop
                </div>
                <div
                  ref={rulerRef}
                  onPointerDown={onRulerPointerDown}
                  className="absolute top-0 z-10 cursor-pointer border-b border-l border-border bg-surface/60"
                  style={{ left: GUTTER, right: 0, height: RULER_H }}
                  title="Drag to set a loop region"
                >
                  {loop && (
                    <div
                      className="absolute inset-y-0 border-x"
                      style={{
                        left: loopStartX,
                        width: Math.max(1, loopEndX - loopStartX),
                        background: loop.enabled ? 'rgba(124,92,255,0.5)' : 'rgba(148,148,148,0.3)',
                        borderColor: loop.enabled ? 'var(--color-accent)' : 'var(--color-border)'
                      }}
                    />
                  )}
                  <Playhead variant="ruler" />
                </div>

                <div style={{ paddingTop: RULER_H }}>
                  {stemKinds.map((kind) => (
                    <div key={kind} className="flex items-stretch border-b border-border/40">
                      <StemRow kind={kind} />
                      <div
                        className="relative h-20 flex-1 cursor-pointer border-l border-border bg-surface/40"
                        onClick={seekFromLane}
                      >
                        <Waveform
                          peaks={peaks[kind] ?? NO_PEAKS}
                          color={STEM_COLORS[kind]}
                          dimmed={anySolo && !controls[kind].soloed}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Loop band + beat grid + playhead, spanning only the lane column. */}
                <div
                  ref={overlayRef}
                  className="pointer-events-none absolute"
                  style={{ top: RULER_H, bottom: 0, left: GUTTER, right: 0 }}
                >
                  {loop && (
                    <div
                      className="absolute inset-y-0"
                      style={{
                        left: loopStartX,
                        width: Math.max(1, loopEndX - loopStartX),
                        background: loop.enabled
                          ? 'rgba(124,92,255,0.10)'
                          : 'rgba(148,148,148,0.06)',
                        borderLeft: `1px solid ${loop.enabled ? 'rgba(124,92,255,0.5)' : 'rgba(148,148,148,0.3)'}`,
                        borderRight: `1px solid ${loop.enabled ? 'rgba(124,92,255,0.5)' : 'rgba(148,148,148,0.3)'}`
                      }}
                    />
                  )}
                  {hasGrid && (
                    <BeatGrid
                      beatTimes={features.beatTimes}
                      downbeatTimes={features.downbeatTimes}
                      offsetSec={beatGridOffsetSec}
                      durationSec={duration}
                      width={laneW}
                      height={laneH}
                    />
                  )}
                  <Playhead variant="lane" />
                </div>
              </div>
            </div>
            {lyricsOpen && <Lyrics onClose={() => setLyricsOpen(false)} />}
          </div>

          {exportOpen && <ExportPanel />}
        </>
      )}
    </div>
  )
}

export default Studio
