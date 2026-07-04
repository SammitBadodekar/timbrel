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
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-opacity"
      style={{ opacity: dimmed ? 0.4 : 1 }}
    >
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
      <span className="w-16 shrink-0 text-sm font-medium">{STEM_LABELS[kind]}</span>

      <button
        onClick={onMute}
        className="w-8 shrink-0 rounded-lg border border-border py-1 text-xs font-semibold"
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
        className="w-8 shrink-0 rounded-lg border border-border py-1 text-xs font-semibold"
        style={{
          background: controls.soloed ? color : 'transparent',
          color: controls.soloed ? '#0b0d10' : undefined
        }}
        title="Solo"
      >
        S
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={controls.gain}
        onChange={(e) => onGain(Number(e.target.value))}
        className="ml-2 flex-1 accent-accent"
        aria-label={`${STEM_LABELS[kind]} volume`}
      />
    </div>
  )
}

export default StemRow
