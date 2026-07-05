import { useMemo } from 'react'
import { allTags, STEM_COLORS, STEM_KINDS, STEM_LABELS, type StemKind } from '@timbrel/core'
import { useStudioStore } from '../store/studioStore'
import { useRoutingStore } from '../store/routingStore'
import OutputPicker from './OutputPicker'

/**
 * The per-stem channel strip: the fixed-width gutter that sits to the left of a
 * waveform lane (color dot, label, mute/solo, volume). Width must match the
 * `GUTTER` constant the studio uses to align the beat-grid/playhead overlay.
 *
 * Subscribes to its own slice of the store, so a fader drag re-renders only
 * this row — not the whole studio.
 */
function StemRow({ kind }: { kind: StemKind }): React.JSX.Element {
  const controls = useStudioStore((s) => s.controls[kind])
  const anySolo = useStudioStore((s) => STEM_KINDS.some((k) => s.controls[k].soloed))
  const dimmed = anySolo && !controls.soloed
  const color = STEM_COLORS[kind]

  // Inline output routing for this stem (edits the same global rig as the panel).
  const devices = useRoutingStore((s) => s.devices)
  const savedDevices = useRoutingStore((s) => s.rig.devices)
  const override = useRoutingStore((s) => s.rig.overrides[kind] ?? null)
  const tags = useMemo(() => allTags(savedDevices), [savedDevices])

  return (
    <div
      className="flex w-40 shrink-0 flex-col justify-center gap-2 px-3 py-2 transition-opacity"
      style={{ opacity: dimmed ? 0.5 : 1 }}
    >
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <span className="flex-1 truncate text-sm font-medium">{STEM_LABELS[kind]}</span>
        <button
          onClick={() => useStudioStore.getState().toggleMute(kind)}
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
          onClick={() => useStudioStore.getState().toggleSolo(kind)}
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
        onChange={(e) => useStudioStore.getState().setGain(kind, Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={`${STEM_LABELS[kind]} volume`}
      />

      <OutputPicker
        value={override}
        onChange={(next) => useRoutingStore.getState().setChannelOverride(kind, next)}
        allowInherit
        devices={devices}
        tags={tags}
      />
    </div>
  )
}

export default StemRow
