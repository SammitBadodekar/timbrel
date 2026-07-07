/**
 * A compact multi-select dropdown for choosing a routing target list — reused by
 * the Audio Output panel (default target + per-channel matrix) and the inline
 * per-stem pickers. `value === null` means "inherit the default" and is only
 * offered when `allowInherit` (i.e. for a channel, not for the default itself).
 *
 * The open menu is rendered in a portal to `document.body` with fixed
 * positioning: the inline per-stem picker lives inside the studio's
 * `overflow-hidden` lanes card, and an absolutely-positioned menu would be
 * clipped (and unreadable) there. The portal escapes every overflow/stacking
 * context; the menu closes on outside click, scroll, or resize.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RouteTarget } from '@timbrel/core'

interface Props {
  value: RouteTarget[] | null
  onChange: (next: RouteTarget[] | null) => void
  allowInherit: boolean
  devices: MediaDeviceInfo[]
  tags: string[]
  className?: string
}

const MENU_W = 224 // w-56
const MENU_MAX_H = 288 // max-h-72

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

interface MenuPos {
  left: number
  top?: number
  bottom?: number
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
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position the portaled menu against the trigger; flip above when it would
  // overflow the bottom of the viewport.
  useLayoutEffect(() => {
    if (!open) return
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8))
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < MENU_MAX_H + 12 && r.top > spaceBelow) {
      setPos({ left, bottom: window.innerHeight - r.top + 4 })
    } else {
      setPos({ left, top: r.bottom + 4 })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    // A fixed-position menu would otherwise float free of its trigger.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
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
      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-surface-2"
    >
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] text-white"
        style={{
          background: checked ? 'var(--color-accent)' : 'var(--color-surface)',
          borderColor: checked ? 'var(--color-accent)' : 'var(--color-border)'
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs hover:border-accent"
        title={summarize(value, allowInherit)}
      >
        <span className="truncate">{summarize(value, allowInherit)}</span>
        <span className="shrink-0 text-fog">▾</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[60] overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--shadow-dock)]"
            style={{
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: MENU_W,
              maxHeight: MENU_MAX_H
            }}
          >
            {allowInherit &&
              row('__inherit__', 'Follow default', value === null, () => {
                onChange(null)
                setOpen(false)
              })}
            {row('__system__', 'System Default', active({ type: 'system' }), () =>
              toggle({ type: 'system' })
            )}
            {tags.length > 0 && (
              <div className="mt-1 px-2 pt-1 text-[10px] uppercase tracking-wide text-fog">
                Tags
              </div>
            )}
            {tags.map((tag) =>
              row(`tag:${tag}`, `#${tag}`, active({ type: 'tag', tag }), () =>
                toggle({ type: 'tag', tag })
              )
            )}
            <div className="mt-1 px-2 pt-1 text-[10px] uppercase tracking-wide text-fog">
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
          </div>,
          document.body
        )}
    </div>
  )
}

export default OutputPicker
