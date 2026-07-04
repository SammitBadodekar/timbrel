import { STEM_COLORS, STEM_LABELS, type StemKind } from '@timbrel/core'
import type { StemControls } from '../audio/StudioEngine'

interface StemRowProps {
  kind: StemKind
  controls: StemControls
  dimmed: boolean
  onGain: (value: number) => void
  onMute: () => void
  onSolo: () => void
}

/**
 * The per-stem channel strip: the fixed-width gutter that sits to the left of a
 * waveform lane (color dot, label, mute/solo, volume). Width must match the
 * `GUTTER` constant the studio uses to align the beat-grid/playhead overlay.
 */
function StemRow({
  kind,
  controls,
  dimmed,
  onGain,
  onMute,
  onSolo
}: StemRowProps): React.JSX.Element {
  const color = STEM_COLORS[kind]
  return (
    <div
      className="flex w-40 shrink-0 flex-col justify-center gap-2 px-3 py-2 transition-opacity"
      style={{ opacity: dimmed ? 0.5 : 1 }}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <span className="flex-1 truncate text-sm font-medium">{STEM_LABELS[kind]}</span>
        <button
          onClick={onMute}
          className="w-7 shrink-0 rounded-md border border-border py-0.5 text-xs font-semibold"
          style={{
            background: controls.muted ? '#ff5c7a' : 'transparent',
            color: controls.muted ? '#0b0d10' : undefined
          }}
          title="Mute"
        >
          M
        </button>
        <button
          onClick={onSolo}
          className="w-7 shrink-0 rounded-md border border-border py-0.5 text-xs font-semibold"
          style={{
            background: controls.soloed ? color : 'transparent',
            color: controls.soloed ? '#0b0d10' : undefined
          }}
          title="Solo"
        >
          S
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={controls.gain}
        onChange={(e) => onGain(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={`${STEM_LABELS[kind]} volume`}
      />
    </div>
  )
}

export default StemRow
