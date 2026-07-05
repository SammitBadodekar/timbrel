/**
 * The Audio Output control center (DECISIONS.md → UI): a gear launcher + modal
 * that owns the global routing rig. Works with no song loaded, since the seven
 * routable channels (six stems + click) are universal. Reads/writes the global
 * `routingStore`; its edits push straight to whatever engine is live.
 *
 * The per-stem inline pickers (StemRow) edit the same rig — this panel is the
 * full matrix + device tagging + the reset escape hatch.
 */
import { useMemo, useState } from 'react'
import {
  allTags,
  deviceTag,
  ROUTABLE_CHANNELS,
  routingSpansMultipleDevices,
  STEM_COLORS,
  STEM_LABELS,
  type RoutableChannel
} from '@timbrel/core'
import { useRoutingStore } from '../store/routingStore'
import OutputPicker from './OutputPicker'

const CHANNEL_LABEL = (ch: RoutableChannel): string =>
  ch === 'click' ? 'Metronome / click' : STEM_LABELS[ch]
const CHANNEL_COLOR = (ch: RoutableChannel): string =>
  ch === 'click' ? '#9aa0aa' : STEM_COLORS[ch]

function DeviceTagRow({ device }: { device: MediaDeviceInfo }): React.JSX.Element {
  const savedDevices = useRoutingStore((s) => s.rig.devices)
  const tags = useMemo(() => allTags(savedDevices), [savedDevices])
  const current = deviceTag(savedDevices, device.deviceId)
  // `window.prompt` is unsupported in Electron, so new tags are entered inline.
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const setTag = (tag: string | null): void =>
    useRoutingStore.getState().setDeviceTag(device.deviceId, tag)

  const cancel = (): void => {
    setCreating(false)
    setDraft('')
  }

  const commitNew = (): void => {
    const name = draft.trim()
    if (name) setTag(name)
    cancel()
  }

  const onSelect = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value
    if (v === '__new__') setCreating(true)
    else setTag(v || null)
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex-1 truncate text-sm">
        {device.label || device.deviceId.slice(0, 16)}
      </span>
      {creating ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitNew()
            else if (e.key === 'Escape') cancel()
          }}
          onBlur={cancel}
          placeholder="Tag name, then ↵"
          className="w-36 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
        />
      ) : (
        <select
          value={current ?? ''}
          onChange={onSelect}
          className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
        >
          <option value="">No tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
          <option value="__new__">New tag…</option>
        </select>
      )}
    </div>
  )
}

function Panel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const rig = useRoutingStore((s) => s.rig)
  const devices = useRoutingStore((s) => s.devices)
  const resolved = useRoutingStore((s) => s.resolved)
  const tags = useMemo(() => allTags(rig.devices), [rig.devices])
  const split = routingSpansMultipleDevices(resolved)

  const realDevices = devices.filter(
    (d) => d.deviceId !== 'default' && d.deviceId !== 'communications'
  )

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Audio Output</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => useRoutingStore.getState().reset()}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-text"
              title="Clear the default target + every override back to System Default"
            >
              Reset
            </button>
            <button onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:text-text">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Devices + tags */}
          <section className="mb-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Devices</div>
            {realDevices.length === 0 ? (
              <div className="py-2 text-sm text-muted">
                Only the system output is connected. Plug in another device to route to it.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {realDevices.map((d) => (
                  <DeviceTagRow key={d.deviceId} device={d} />
                ))}
              </div>
            )}
          </section>

          {/* Default target */}
          <section className="mb-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">
              Default output
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-sm text-muted">Everything not overridden below</span>
              <OutputPicker
                value={rig.defaultTarget}
                onChange={(next) =>
                  useRoutingStore.getState().setDefaultTarget(next ?? [{ type: 'system' }])
                }
                allowInherit={false}
                devices={devices}
                tags={tags}
                className="w-52"
              />
            </div>
          </section>

          {/* Per-channel routing matrix */}
          <section>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">Routing</div>
            <div className="space-y-1">
              {ROUTABLE_CHANNELS.map((ch) => (
                <div key={ch} className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: CHANNEL_COLOR(ch) }}
                  />
                  <span className="flex-1 text-sm">{CHANNEL_LABEL(ch)}</span>
                  {resolved[ch]?.silent && (
                    <span className="shrink-0 text-[10px] font-semibold text-stem-vocals">
                      MUTED — device gone
                    </span>
                  )}
                  <OutputPicker
                    value={rig.overrides[ch] ?? null}
                    onChange={(next) => useRoutingStore.getState().setChannelOverride(ch, next)}
                    allowInherit
                    devices={devices}
                    tags={tags}
                    className="w-52"
                  />
                </div>
              ))}
            </div>
          </section>

          {split && (
            <div className="mt-4 rounded-md border border-stem-drums/40 bg-stem-drums/10 px-3 py-2 text-xs text-stem-drums">
              ⚠ Stems are split across different devices. If any is wireless (Bluetooth), those
              stems will drift out of sync with the others.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AudioOutput(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-30 rounded-md border border-border bg-surface/80 px-3 py-1.5 text-xs font-semibold backdrop-blur hover:bg-surface-2"
        title="Audio output routing"
      >
        🔊 Output
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </>
  )
}

export default AudioOutput
