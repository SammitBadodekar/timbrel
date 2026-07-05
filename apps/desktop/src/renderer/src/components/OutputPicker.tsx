/**
 * A compact multi-select dropdown for choosing a routing target list — reused by
 * the Audio Output panel (default target + per-channel matrix) and the inline
 * per-stem pickers. `value === null` means "inherit the default" and is only
 * offered when `allowInherit` (i.e. for a channel, not for the default itself).
 */
import { useEffect, useRef, useState } from 'react'
import type { RouteTarget } from '@timbrel/core'

interface Props {
  value: RouteTarget[] | null
  onChange: (next: RouteTarget[] | null) => void
  allowInherit: boolean
  devices: MediaDeviceInfo[]
  tags: string[]
  className?: string
}

function targetKey(t: RouteTarget): string {
  return t.type === 'system' ? 'system' : t.type === 'tag' ? `tag:${t.tag}` : `dev:${t.deviceId}`
}

function labelOf(t: RouteTarget): string {
  if (t.type === 'system') return 'System'
  if (t.type === 'tag') return `#${t.tag}`
  return t.label || t.deviceId.slice(0, 8)
}

function summarize(value: RouteTarget[] | null, allowInherit: boolean): string {
  if (!value || value.length === 0) return allowInherit ? 'Follow default' : 'System Default'
  const names = value.map(labelOf)
  return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`
}

/** Real, taggable outputs — the OS aliases ('default'/'communications') are
 *  represented by the explicit "System Default" option instead. */
function realDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
}

function OutputPicker({
  value,
  onChange,
  allowInherit,
  devices,
  tags,
  className
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const active = (t: RouteTarget): boolean =>
    (value ?? []).some((x) => targetKey(x) === targetKey(t))

  const toggle = (t: RouteTarget): void => {
    const base = value ?? []
    const next = active(t) ? base.filter((x) => targetKey(x) !== targetKey(t)) : [...base, t]
    if (allowInherit && next.length === 0) onChange(null)
    else onChange(next)
  }

  const row = (
    key: string,
    label: string,
    checked: boolean,
    onClick: () => void
  ): React.JSX.Element => (
    <button
      key={key}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-2"
    >
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border text-[9px]"
        style={{ background: checked ? 'var(--color-accent)' : 'transparent' }}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs"
        title={summarize(value, allowInherit)}
      >
        <span className="truncate">{summarize(value, allowInherit)}</span>
        <span className="shrink-0 text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
          {allowInherit &&
            row('__inherit__', 'Follow default', value === null, () => {
              onChange(null)
              setOpen(false)
            })}
          {row('__system__', 'System Default', active({ type: 'system' }), () =>
            toggle({ type: 'system' })
          )}
          {tags.length > 0 && (
            <div className="mt-1 px-2 pt-1 text-[10px] uppercase tracking-wide text-muted">
              Tags
            </div>
          )}
          {tags.map((tag) =>
            row(`tag:${tag}`, `#${tag}`, active({ type: 'tag', tag }), () =>
              toggle({ type: 'tag', tag })
            )
          )}
          <div className="mt-1 px-2 pt-1 text-[10px] uppercase tracking-wide text-muted">
            Devices
          </div>
          {realDevices(devices).map((d) =>
            row(
              `dev:${d.deviceId}`,
              d.label || d.deviceId.slice(0, 12),
              active({ type: 'device', deviceId: d.deviceId, label: d.label }),
              () => toggle({ type: 'device', deviceId: d.deviceId, label: d.label || d.deviceId })
            )
          )}
          {realDevices(devices).length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted">No other devices connected</div>
          )}
        </div>
      )}
    </div>
  )
}

export default OutputPicker
