import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PEAK_BUCKETS,
  STEM_COLORS,
  STEM_KINDS,
  transposeKey,
  type LoopRegion,
  type ProjectFile,
  type StemKind,
  type TempoKeyState
} from '@timbrel/core'
import type { ProjectPatch } from '@shared/ipc'
import { StudioEngine, type StemControls } from '../audio/StudioEngine'
import { formatTime } from '../lib/format'
import StemRow from './StemRow'
import Waveform from './Waveform'
import BeatGrid from './BeatGrid'

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

function defaultControls(): Record<StemKind, StemControls> {
  return Object.fromEntries(
    STEM_KINDS.map((k) => [k, { gain: 1, muted: false, soloed: false }])
  ) as Record<StemKind, StemControls>
}

function Studio({ songId, onBack }: StudioProps): React.JSX.Element {
  const engineRef = useRef<StudioEngine | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)

  const [project, setProject] = useState<ProjectFile | null>(null)
  const [stemKinds, setStemKinds] = useState<StemKind[]>([])
  const [controls, setControls] = useState<Record<StemKind, StemControls>>(defaultControls)
  const [peaks, setPeaks] = useState<Partial<Record<StemKind, number[]>>>({})
  const [beatGridOffsetSec, setBeatGridOffsetSec] = useState(0)
  const [tempoKey, setTempoKey] = useState<TempoKeyState>({ tempoRatio: 1, semitones: 0 })
  const [loop, setLoop] = useState<LoopRegion | null>(null)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [countingIn, setCountingIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [laneW, setLaneW] = useState(0)
  const [laneH, setLaneH] = useState(0)

  const loopDrag = useRef<LoopDrag | null>(null)

  // --- Debounced persistence back to project.json ---------------------------
  const saveTimer = useRef<number | undefined>(undefined)
  const pending = useRef<ProjectPatch | null>(null)
  const didHydrate = useRef(false)

  const scheduleSave = useCallback(
    (patch: ProjectPatch) => {
      pending.current = { ...pending.current, ...patch }
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        const p = pending.current
        pending.current = null
        if (p) void window.timbrel.saveProject(songId, p)
      }, 500)
    },
    [songId]
  )

  // Flush any pending save when leaving the studio.
  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current)
      if (pending.current) {
        void window.timbrel.saveProject(songId, pending.current)
        pending.current = null
      }
    }
  }, [songId])

  // --- Load project + decode stems + peaks ----------------------------------
  useEffect(() => {
    let cancelled = false
    didHydrate.current = false
    const engine = new StudioEngine()
    engineRef.current = engine

    void (async () => {
      const loaded = await window.timbrel.loadProject(songId)
      if (cancelled) return
      if (!loaded) {
        setError('Project not found on disk.')
        setLoading(false)
        return
      }
      setProject(loaded.project)

      const buffers: Partial<Record<StemKind, ArrayBuffer>> = {}
      await Promise.all(
        loaded.stems.map(async (kind) => {
          const bytes = await window.timbrel.getStemBytes(songId, kind)
          if (bytes) buffers[kind] = bytes
        })
      )
      if (cancelled) return

      const kinds = await engine.loadStems(buffers)
      if (cancelled) return

      engine.applyMixerState(loaded.project.mixer)
      engine.applyTempoKey(loaded.project.tempoKey)
      const savedLoop = loaded.project.loops[0] ?? null
      engine.setLoop(savedLoop?.enabled ? savedLoop : null)
      engine.setBeats(
        loaded.project.features.beatTimes,
        loaded.project.features.downbeatTimes,
        loaded.project.beatGridOffsetSec
      )
      setStemKinds(kinds)
      setControls(() => {
        const next = defaultControls()
        for (const k of kinds) next[k] = { ...engine.getControls(k) }
        return next
      })
      setBeatGridOffsetSec(loaded.project.beatGridOffsetSec)
      setTempoKey(loaded.project.tempoKey)
      setLoop(savedLoop)
      setDuration(engine.duration)

      // Cached peaks render instantly; otherwise compute once and persist.
      const cached = await window.timbrel.getPeaks(songId)
      if (cancelled) return
      let stemPeaks: Partial<Record<StemKind, number[]>>
      if (
        cached &&
        cached.buckets === PEAK_BUCKETS &&
        kinds.every((k) => (cached.stems[k]?.length ?? 0) > 0)
      ) {
        stemPeaks = cached.stems
      } else {
        stemPeaks = engine.computeAllPeaks(PEAK_BUCKETS)
        void window.timbrel.savePeaks(songId, {
          version: 1,
          buckets: PEAK_BUCKETS,
          durationSec: engine.duration,
          stems: stemPeaks
        })
      }
      if (cancelled) return
      setPeaks(stemPeaks)
      setLoading(false)
    })().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
    }
  }, [songId])

  // Persist mixer / grid offset / tempo-key / loops on change (skip hydration echo).
  useEffect(() => {
    if (loading) return
    if (!didHydrate.current) {
      didHydrate.current = true
      return
    }
    scheduleSave({ mixer: controls, beatGridOffsetSec, tempoKey, loops: loop ? [loop] : [] })
  }, [controls, beatGridOffsetSec, tempoKey, loop, loading, scheduleSave])

  // Mirror the enabled loop into the engine so playback wraps at its end.
  useEffect(() => {
    engineRef.current?.setLoop(loop?.enabled ? loop : null)
  }, [loop])

  // Keep the click scheduler's beats aligned with the (nudgeable) grid.
  useEffect(() => {
    const f = project?.features
    engineRef.current?.setBeats(f?.beatTimes ?? [], f?.downbeatTimes ?? [], beatGridOffsetSec)
  }, [project, beatGridOffsetSec])

  // Metronome on/off is an ephemeral practice aid (not persisted).
  useEffect(() => {
    engineRef.current?.setMetronome(metronome)
  }, [metronome])

  // --- 60fps playhead -------------------------------------------------------
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const engine = engineRef.current
      if (engine) {
        setCurrentTime(engine.currentTime)
        if (engine.isPlaying) {
          const activeLoop = engine.activeLoop
          if (activeLoop && engine.currentTime >= activeLoop.endSec) {
            engine.seek(activeLoop.startSec)
          } else if (engine.duration > 0 && engine.currentTime >= engine.duration) {
            engine.handleEnded()
            setPlaying(false)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // --- Measure the lane region for the overlay (grid + playhead) -------------
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const update = (): void => {
      setLaneW(el.clientWidth)
      setLaneH(el.clientHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, stemKinds.length])

  const togglePlay = async (): Promise<void> => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.isPlaying || countingIn) {
      engine.cancelCountIn()
      engine.pause()
      setCountingIn(false)
      setPlaying(false)
      return
    }
    if (countIn) {
      // One bar of clicks at the heard tempo, then roll the transport.
      const bpm = project?.features.bpm
      const secPerBeat = (bpm ? 60 / bpm : 0.5) / tempoKey.tempoRatio
      setCountingIn(true)
      engine.startCountIn(4, secPerBeat, () => {
        setCountingIn(false)
        void engine.play().then(() => setPlaying(true))
      })
      return
    }
    await engine.play()
    setPlaying(true)
  }

  const onSeek = (t: number): void => {
    const clamped = Math.max(0, Math.min(t, duration))
    engineRef.current?.seek(clamped)
    setCurrentTime(clamped)
  }

  const seekFromLane = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    onSeek(((e.clientX - rect.left) / rect.width) * duration)
  }

  const onGain = (kind: StemKind, value: number): void => {
    engineRef.current?.setGain(kind, value)
    setControls((c) => ({ ...c, [kind]: { ...c[kind], gain: value } }))
  }

  const onMute = (kind: StemKind): void => {
    const muted = engineRef.current?.toggleMute(kind) ?? false
    setControls((c) => ({ ...c, [kind]: { ...c[kind], muted } }))
  }

  const onSolo = (kind: StemKind): void => {
    const soloed = engineRef.current?.toggleSolo(kind) ?? false
    setControls((c) => ({ ...c, [kind]: { ...c[kind], soloed } }))
  }

  const nudge = (deltaSec: number): void => {
    setBeatGridOffsetSec((o) => Math.round((o + deltaSec) * 1000) / 1000)
  }

  const toggleLoop = (): void => {
    setLoop((l) => (l ? { ...l, enabled: !l.enabled } : l))
  }

  const clearLoop = (): void => setLoop(null)

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
    setLoop((l) => (l && l.endSec - l.startSec < MIN_LOOP_SEC ? null : l))
    loopDrag.current = null
  }

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (duration === 0) return
    e.preventDefault()
    const rect = rulerRef.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const t = timeFromRulerX(e.clientX)

    const create: LoopDrag = { mode: 'create', anchorSec: t, anchorClientX: e.clientX, id: null }
    if (loop) {
      const startX = (loop.startSec / duration) * rect.width
      const endX = (loop.endSec / duration) * rect.width
      if (Math.abs(px - startX) <= HANDLE_PX) loopDrag.current = { mode: 'resize-start' }
      else if (Math.abs(px - endX) <= HANDLE_PX) loopDrag.current = { mode: 'resize-end' }
      else if (px > startX && px < endX)
        loopDrag.current = {
          mode: 'move',
          grabOffsetSec: t - loop.startSec,
          widthSec: loop.endSec - loop.startSec
        }
      else loopDrag.current = create
    } else {
      loopDrag.current = create
    }

    window.addEventListener('pointermove', onRulerPointerMove)
    window.addEventListener('pointerup', onRulerPointerUp, { once: true })
  }

  const onTempo = (ratio: number): void => {
    const clamped = Math.min(1.5, Math.max(0.5, Math.round(ratio * 100) / 100))
    engineRef.current?.setTempo(clamped)
    setTempoKey((t) => ({ ...t, tempoRatio: clamped }))
  }

  const onSemitones = (semitones: number): void => {
    const clamped = Math.round(Math.min(12, Math.max(-12, semitones)))
    engineRef.current?.setSemitones(clamped)
    setTempoKey((t) => ({ ...t, semitones: clamped }))
  }

  const anySolo = stemKinds.some((k) => controls[k].soloed)
  const features = project?.features
  const hasGrid = !!features && features.beatTimes.length > 0
  const playheadX = duration > 0 ? (currentTime / duration) * laneW : 0

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
              onClick={togglePlay}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white hover:bg-accent-hover"
              aria-label={countingIn ? 'Cancel count-in' : playing ? 'Pause' : 'Play'}
            >
              {countingIn ? '…' : playing ? '❚❚' : '▶'}
            </button>
            <span className="w-12 text-right font-mono text-sm tabular-nums text-muted">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="flex-1 accent-accent"
              aria-label="Seek"
            />
            <span className="w-12 font-mono text-sm tabular-nums text-muted">
              {formatTime(duration)}
            </span>

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
                onClick={toggleLoop}
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
                    onClick={clearLoop}
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
                onClick={() => setMetronome((m) => !m)}
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
                onClick={() => setCountIn((c) => !c)}
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
          </div>

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
                <div
                  className="pointer-events-none absolute top-0 w-px bg-accent"
                  style={{ height: RULER_H, transform: `translateX(${playheadX}px)` }}
                />
              </div>

              <div style={{ paddingTop: RULER_H }}>
                {stemKinds.map((kind) => (
                  <div key={kind} className="flex items-stretch border-b border-border/40">
                    <StemRow
                      kind={kind}
                      controls={controls[kind]}
                      dimmed={anySolo && !controls[kind].soloed}
                      onGain={(v) => onGain(kind, v)}
                      onMute={() => onMute(kind)}
                      onSolo={() => onSolo(kind)}
                    />
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
                      background: loop.enabled ? 'rgba(124,92,255,0.10)' : 'rgba(148,148,148,0.06)',
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
                <div
                  className="absolute w-px bg-accent"
                  style={{ top: 0, bottom: 0, transform: `translateX(${playheadX}px)` }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Studio
