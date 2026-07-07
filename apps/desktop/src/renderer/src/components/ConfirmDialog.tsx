import { useEffect } from 'react'

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A small in-app confirmation modal. `window.confirm` blocks the whole renderer
 * in Electron, so destructive actions (delete a song / playlist) route through
 * this instead. Escape cancels, Enter confirms.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="animate-pop w-[380px] rounded-3xl border border-border bg-surface p-6 shadow-[var(--shadow-dock)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted hover:border-accent hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-full px-4 py-2 text-sm font-medium text-white ${
              danger ? 'bg-danger hover:brightness-95' : 'bg-charcoal hover:bg-charcoal-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
