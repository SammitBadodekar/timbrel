/**
 * The floating transport HUD — play, scrubber, tempo, key, loop, click, and
 * count-in. Extracted from the studio so it can also float over the full-screen
 * lyrics reader; every control reads/writes the global studio store, so multiple
 * instances stay in sync automatically.
 *
 * The moving parts (scrubber, tempo/key readout, loop label) subscribe to the
 * store in leaf components so a drag or per-frame clock tick never re-renders the
 * whole dock — the same pattern the studio shell uses.
 */
import { useState } from 'react'
import { transposeKey } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'
import { formatTime } from '../lib/format'

/** Current time + fixed-width scrubber + duration. Updates every RAF frame. */
function TransportScrubber(): React.JSX.Element {
  const currentTime = useStudioStore((s) => s.currentTime)
  const duration = useStudioStore((s) => s.duration)
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-10 text-right font-mono text-xs tabular-nums text-text">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={currentTime}
        onChange={(e) => useStudioStore.getState().seek(Number(e.target.value))}
        className="w-40 accent-charcoal"
        aria-label="Seek"
      />
      <span className="w-10 font-mono text-xs tabular-nums text-fog">{formatTime(duration)}</span>
    </div>
  )
}

/** Small round stepper button shared by the tempo + key controls. */
const STEP_BTN =
  'grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border leading-none text-muted hover:border-accent hover:text-text disabled:opacity-30 disabled:hover:border-border'

/** Tempo + key toolbar segments. Tempo is a type-or-step numeric field (BPM when
 *  known, else percent). */
function TempoKeyControls(): React.JSX.Element {
  const tempoKey = useStudioStore((s) => s.tempoKey)
  const features = useStudioStore((s) => s.project?.features)
  const [tempoDraft, setTempoDraft] = useState<string | null>(null)

  const onTempo = (ratio: number): void => useStudioStore.getState().setTempo(ratio)
  const onSemitones = (semitones: number): void => useStudioStore.getState().setSemitones(semitones)

  const ratio = tempoKey.tempoRatio
  const baseBpm = features?.bpm ?? null
  // Edit in BPM when we know the song's tempo, otherwise in percent.
  const tempoValue = baseBpm ? Math.round(baseBpm * ratio) : Math.round(ratio * 100)
  const tempoUnit = baseBpm ? 'BPM' : '%'
  const shiftedKey = transposeKey(features?.key ?? null, tempoKey.semitones)

  // Steps move by 1% (an exact 0.01 ratio step); typing sets an absolute value.
  const stepTempo = (delta: number): void => {
    setTempoDraft(null)
    onTempo(ratio + delta)
  }
  const commitTempo = (raw: string): void => {
    setTempoDraft(null)
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) onTempo(baseBpm ? n / baseBpm : n / 100)
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs">
        <span className="pr-0.5 text-muted">Tempo</span>
        <button
          onClick={() => stepTempo(-0.01)}
          disabled={ratio <= 0.5}
          className={STEP_BTN}
          title="Slower (−1%)"
        >
          −
        </button>
        <input
          value={tempoDraft ?? String(tempoValue)}
          onChange={(e) => setTempoDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commitTempo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') {
              setTempoDraft(null)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          inputMode="numeric"
          className="w-9 rounded-md bg-surface-2 py-0.5 text-center font-mono tabular-nums text-text outline-none focus:ring-1 focus:ring-accent"
          aria-label="Tempo"
          title={`${Math.round(ratio * 100)}% of original`}
        />
        <span className="text-muted">{tempoUnit}</span>
        <button
          onClick={() => stepTempo(0.01)}
          disabled={ratio >= 1.5}
          className={STEP_BTN}
          title="Faster (+1%)"
        >
          +
        </button>
        <button
          onClick={() => onTempo(1)}
          disabled={ratio === 1}
          className="ml-0.5 rounded-md px-1 text-muted hover:text-text disabled:opacity-30"
          title="Reset tempo"
        >
          ↺
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs">
        <span className="pr-0.5 text-muted">Key</span>
        <button
          onClick={() => onSemitones(tempoKey.semitones - 1)}
          disabled={tempoKey.semitones <= -12}
          className={STEP_BTN}
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
          className={STEP_BTN}
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
    </>
  )
}

/** The loop toolbar segment — its label tracks the drag, so it's a leaf too. */
function LoopControls(): React.JSX.Element {
  const loop = useStudioStore((s) => s.loop)
  return (
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
  )
}

/** The whole HUD pill. `mx-auto w-fit` centres it within whatever bar/overlay
 *  the caller places it in. */
function TransportDock(): React.JSX.Element {
  const playing = useStudioStore((s) => s.playing)
  const countingIn = useStudioStore((s) => s.countingIn)
  const metronome = useStudioStore((s) => s.metronome)
  const countIn = useStudioStore((s) => s.countIn)

  return (
    <div className="mx-auto flex w-fit max-w-full items-center gap-3 overflow-x-auto rounded-full border border-border bg-surface py-2.5 pl-2.5 pr-4 shadow-[var(--shadow-dock)]">
      <button
        onClick={() => void useStudioStore.getState().togglePlay()}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-charcoal text-white hover:bg-charcoal-hover ${
          countingIn ? 'animate-count' : ''
        }`}
        aria-label={countingIn ? 'Cancel count-in' : playing ? 'Pause' : 'Play'}
      >
        {countingIn ? '…' : playing ? '❚❚' : '▶'}
      </button>

      <TransportScrubber />

      <span className="h-7 w-px shrink-0 bg-border" />

      <TempoKeyControls />

      <LoopControls />

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => useStudioStore.getState().toggleMetronome()}
          className="rounded-full border px-3.5 py-2 text-xs font-medium transition-colors"
          style={{
            background: metronome ? 'var(--color-accent)' : 'var(--color-surface)',
            borderColor: metronome ? 'var(--color-accent)' : 'var(--color-border)',
            color: metronome ? '#fff' : 'var(--color-muted)'
          }}
          title="Metronome click on every beat"
        >
          Click
        </button>
        <button
          onClick={() => useStudioStore.getState().toggleCountIn()}
          className="rounded-full border px-3.5 py-2 text-xs font-medium transition-colors"
          style={{
            background: countIn ? 'var(--color-accent)' : 'var(--color-surface)',
            borderColor: countIn ? 'var(--color-accent)' : 'var(--color-border)',
            color: countIn ? '#fff' : 'var(--color-muted)'
          }}
          title="Count in one bar before playback"
        >
          Count-in
        </button>
      </div>
    </div>
  )
}

export default TransportDock
