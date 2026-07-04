import { useMemo, useState } from 'react'
import {
  BIT_DEPTHS,
  EXPORT_MODES,
  MODE_LABEL,
  MP3_BITRATES,
  STEM_COLORS,
  STEM_KINDS,
  STEM_LABELS,
  defaultEncodeSettings,
  exportFileName,
  isLossless,
  safeFilename,
  type BitDepth,
  type ExportEncodeSettings,
  type ExportFormat,
  type ExportMode,
  type Mp3Bitrate,
  type StemKind,
  type TempoKeyState
} from '@timbrel/core'
import { StudioEngine, type ExportRenderSpec, type StemControls } from '../audio/StudioEngine'

interface ExportPanelProps {
  engine: StudioEngine
  title: string
  stemKinds: StemKind[]
  controls: Record<StemKind, StemControls>
  tempoKey: TempoKeyState
  hasBeats: boolean
  onClose: () => void
}

type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

const FORMATS: ExportFormat[] = ['wav', 'flac', 'mp3']

/** Default stem selection = what's currently audible (respects mute/solo). */
function audibleDefaults(
  stemKinds: StemKind[],
  controls: Record<StemKind, StemControls>
): Record<StemKind, boolean> {
  const anySolo = stemKinds.some((k) => controls[k].soloed)
  const out = Object.fromEntries(STEM_KINDS.map((k) => [k, false])) as Record<StemKind, boolean>
  for (const k of stemKinds) out[k] = anySolo ? controls[k].soloed : !controls[k].muted
  return out
}

function ExportPanel({
  engine,
  title,
  stemKinds,
  controls,
  tempoKey,
  hasBeats,
  onClose
}: ExportPanelProps): React.JSX.Element {
  const [mode, setMode] = useState<ExportMode>('mixdown')
  const [selected, setSelected] = useState<Record<StemKind, boolean>>(() =>
    audibleDefaults(stemKinds, controls)
  )
  const [removeKind, setRemoveKind] = useState<StemKind>(stemKinds[0] ?? 'vocals')
  const [settings, setSettings] = useState<ExportEncodeSettings>(defaultEncodeSettings)
  const [bake, setBake] = useState(true)
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' })

  const busy = status.kind === 'busy'
  const neutral = tempoKey.tempoRatio === 1 && tempoKey.semitones === 0
  const selectedKinds = useMemo(() => stemKinds.filter((k) => selected[k]), [stemKinds, selected])

  // Which jobs (suffix + render spec) the current config produces.
  const jobs = useMemo((): { suffix: string; spec: ExportRenderSpec }[] => {
    // A stem is audible iff (some solo → it's soloed) else (not muted). Minus-one
    // renders the current *audible* mix, so a muted stem never leaks into it.
    const anySolo = stemKinds.some((k) => controls[k].soloed)
    const isAudible = (k: StemKind): boolean => (anySolo ? controls[k].soloed : !controls[k].muted)
    switch (mode) {
      case 'stems':
        return selectedKinds.map((k) => ({
          suffix: STEM_LABELS[k],
          spec: { stems: [{ kind: k, gain: 1 }], bakeTempoKey: bake }
        }))
      case 'mixdown':
        return [
          {
            suffix: 'Mixdown',
            spec: {
              stems: selectedKinds.map((k) => ({ kind: k, gain: controls[k].gain })),
              bakeTempoKey: bake
            }
          }
        ]
      case 'minus-one':
        return [
          {
            suffix: `No ${STEM_LABELS[removeKind]}`,
            spec: {
              stems: stemKinds
                .filter((k) => k !== removeKind && isAudible(k))
                .map((k) => ({ kind: k, gain: controls[k].gain })),
              bakeTempoKey: bake
            }
          }
        ]
      case 'click':
        return [{ suffix: 'Click', spec: { stems: [], click: true, bakeTempoKey: bake } }]
    }
  }, [mode, selectedKinds, removeKind, stemKinds, controls, bake])

  const invalidReason =
    mode === 'click' && !hasBeats
      ? 'No beats were detected for this song.'
      : (mode === 'stems' || mode === 'mixdown') && selectedKinds.length === 0
        ? 'Select at least one stem.'
        : mode === 'minus-one' && stemKinds.length < 2
          ? 'Need at least two stems for a minus-one mix.'
          : null

  const showStemPicker = mode === 'stems' || mode === 'mixdown'

  const runExport = async (): Promise<void> => {
    if (invalidReason || jobs.length === 0) return
    const single = jobs.length === 1

    const target = await window.timbrel.pickExportTarget(
      single
        ? {
            kind: 'file',
            defaultName: exportFileName(title, jobs[0].suffix, settings.format),
            format: settings.format
          }
        : { kind: 'dir', defaultName: safeFilename(title), format: settings.format }
    )
    if (!target) return // cancelled

    try {
      let saved = 0
      for (const job of jobs) {
        setStatus({
          kind: 'busy',
          message: `Rendering ${job.suffix}${jobs.length > 1 ? ` (${saved + 1}/${jobs.length})` : ''}…`
        })
        const buffer = await engine.renderExport(job.spec)
        const pcm = StudioEngine.toInterleavedPCM(buffer)
        setStatus({ kind: 'busy', message: `Encoding ${job.suffix}…` })
        const res = await window.timbrel.encodeExport({
          targetPath: target,
          filename: single ? undefined : exportFileName(title, job.suffix, settings.format),
          pcm: pcm.buffer as ArrayBuffer,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
          settings
        })
        if (!res.ok) throw new Error(res.error)
        saved++
      }
      setStatus({
        kind: 'done',
        message: `Exported ${saved} file${saved > 1 ? 's' : ''}.`
      })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const setFormat = (format: ExportFormat): void => setSettings((s) => ({ ...s, format }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="max-h-[90vh] w-[min(560px,94vw)] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export</h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="h-7 w-7 rounded-md border border-border text-muted hover:text-text disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Mode */}
        <Section label="What to export">
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="rounded-lg border px-3 py-2 text-left text-sm"
                style={{
                  borderColor: mode === m ? 'var(--color-accent)' : 'var(--color-border)',
                  background: mode === m ? 'rgba(124,92,255,0.12)' : 'transparent'
                }}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </Section>

        {/* Stem picker (stems / mixdown) */}
        {showStemPicker && (
          <Section
            label={mode === 'stems' ? 'Stems (one file each)' : 'Stems in the mix'}
            action={
              <div className="flex gap-2 text-xs text-muted">
                <button
                  className="hover:text-text"
                  onClick={() =>
                    setSelected(
                      Object.fromEntries(STEM_KINDS.map((k) => [k, true])) as Record<
                        StemKind,
                        boolean
                      >
                    )
                  }
                >
                  All
                </button>
                <span>·</span>
                <button
                  className="hover:text-text"
                  onClick={() =>
                    setSelected(
                      Object.fromEntries(STEM_KINDS.map((k) => [k, false])) as Record<
                        StemKind,
                        boolean
                      >
                    )
                  }
                >
                  None
                </button>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {stemKinds.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected[k]}
                    onChange={(e) => setSelected((s) => ({ ...s, [k]: e.target.checked }))}
                    className="accent-accent"
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: STEM_COLORS[k] }}
                  />
                  {STEM_LABELS[k]}
                </label>
              ))}
            </div>
          </Section>
        )}

        {/* Minus-one: which stem to drop */}
        {mode === 'minus-one' && (
          <Section label="Remove which stem">
            <select
              value={removeKind}
              onChange={(e) => setRemoveKind(e.target.value as StemKind)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
            >
              {stemKinds.map((k) => (
                <option key={k} value={k} className="bg-surface">
                  {STEM_LABELS[k]}
                </option>
              ))}
            </select>
          </Section>
        )}

        {/* Format + quality */}
        <Section label="Format">
          <div className="flex flex-wrap items-center gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className="rounded-lg border px-3 py-1.5 text-sm font-medium uppercase"
                style={{
                  borderColor:
                    settings.format === f ? 'var(--color-accent)' : 'var(--color-border)',
                  background: settings.format === f ? 'rgba(124,92,255,0.12)' : 'transparent'
                }}
              >
                {f}
              </button>
            ))}
            <div className="ml-auto">
              {isLossless(settings.format) ? (
                <select
                  value={settings.bitDepth}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, bitDepth: Number(e.target.value) as BitDepth }))
                  }
                  className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm"
                  aria-label="Bit depth"
                >
                  {BIT_DEPTHS.map((b) => (
                    <option key={b} value={b} className="bg-surface">
                      {b}-bit
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={settings.mp3Bitrate}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, mp3Bitrate: Number(e.target.value) as Mp3Bitrate }))
                  }
                  className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm"
                  aria-label="MP3 bitrate"
                >
                  {MP3_BITRATES.map((b) => (
                    <option key={b} value={b} className="bg-surface">
                      {b} kbps
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </Section>

        {/* Tempo/key bake */}
        <Section label="Tempo & key">
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ opacity: neutral ? 0.5 : 1 }}
          >
            <input
              type="checkbox"
              checked={bake}
              disabled={neutral}
              onChange={(e) => setBake(e.target.checked)}
              className="accent-accent"
            />
            Bake current tempo &amp; key into the export
          </label>
          <p className="mt-1 text-xs text-muted">
            {neutral
              ? 'Tempo & key are at their original values — nothing to bake.'
              : bake
                ? 'Export matches what you hear (adjusted tempo/key).'
                : 'Export at the original tempo & key.'}
          </p>
        </Section>

        {/* Footer */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={runExport}
            disabled={busy || !!invalidReason}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-border px-4 py-2 text-sm text-muted hover:text-text disabled:opacity-40"
          >
            Close
          </button>
          <div className="min-w-0 flex-1 text-right text-sm">
            {invalidReason && status.kind === 'idle' && (
              <span className="text-muted">{invalidReason}</span>
            )}
            {status.kind === 'busy' && <span className="text-muted">{status.message}</span>}
            {status.kind === 'done' && <span className="text-stem-guitar">✓ {status.message}</span>}
            {status.kind === 'error' && (
              <span className="text-stem-vocals" title={status.message}>
                Export failed: {status.message}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({
  label,
  action,
  children
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

export default ExportPanel
