import { useEffect, useRef, useState } from 'react'
import { STEM_KINDS, type ProjectFile, type StemKind } from '@timbrel/core'
import { StudioEngine, type StemControls } from '../audio/StudioEngine'
import { formatTime } from '../lib/format'
import StemRow from './StemRow'

interface StudioProps {
  songId: string
  onBack: () => void
}

function defaultControls(): Record<StemKind, StemControls> {
  return Object.fromEntries(
    STEM_KINDS.map((k) => [k, { gain: 1, muted: false, soloed: false }])
  ) as Record<StemKind, StemControls>
}

function Studio({ songId, onBack }: StudioProps): React.JSX.Element {
  const engineRef = useRef<StudioEngine | null>(null)
  const [project, setProject] = useState<ProjectFile | null>(null)
  const [stemKinds, setStemKinds] = useState<StemKind[]>([])
  const [controls, setControls] = useState<Record<StemKind, StemControls>>(defaultControls)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    let cancelled = false
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
      setStemKinds(kinds)
      setControls(() => {
        const next = defaultControls()
        for (const k of kinds) next[k] = { ...engine.getControls(k) }
        return next
      })
      setDuration(engine.duration)
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

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const engine = engineRef.current
      if (engine) {
        setCurrentTime(engine.currentTime)
        if (engine.isPlaying && engine.duration > 0 && engine.currentTime >= engine.duration) {
          engine.handleEnded()
          setPlaying(false)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const togglePlay = async (): Promise<void> => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.isPlaying) {
      engine.pause()
      setPlaying(false)
    } else {
      await engine.play()
      setPlaying(true)
    }
  }

  const onSeek = (t: number): void => {
    engineRef.current?.seek(t)
    setCurrentTime(t)
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

  const anySolo = stemKinds.some((k) => controls[k].soloed)
  const features = project?.features

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
          <div className="flex items-center gap-4 px-6 py-4">
            <button
              onClick={togglePlay}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-lg text-white hover:bg-accent-hover"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '▶'}
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
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-6 pb-6">
            {stemKinds.map((kind) => (
              <StemRow
                key={kind}
                kind={kind}
                controls={controls[kind]}
                dimmed={anySolo && !controls[kind].soloed}
                onGain={(v) => onGain(kind, v)}
                onMute={() => onMute(kind)}
                onSolo={() => onSolo(kind)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default Studio
