import { useEffect, useMemo } from 'react'
import type { WizBulb, WizLightFrame } from '@shared/ipc'
import { STEM_KINDS, STEM_LABELS } from '@timbrel/core'
import { concertLightFrame } from '../audio/concertLights'
import { bulbIdentity, useConcertLightsStore } from '../store/concertLightsStore'
import { useStudioStore } from '../store/studioStore'

const FRAME_INTERVAL_MS = 80

/** Always-mounted bridge from the currently-live song engine to the global WiZ rig. */
export function ConcertLightsController(): null {
  const bulbs = useConcertLightsStore((state) => state.bulbs)
  const selectedBulbIds = useConcertLightsStore((state) => state.selectedBulbIds)
  const enabled = useConcertLightsStore((state) => state.enabled)
  const lightStemKinds = useConcertLightsStore((state) => state.lightStemKinds)
  const engine = useStudioStore((state) => state.engine)
  const playing = useStudioStore((state) => state.playing)
  const selectedBulbs = useMemo(() => {
    const selected = new Set(selectedBulbIds)
    return bulbs.filter((bulb) => selected.has(bulbIdentity(bulb)))
  }, [bulbs, selectedBulbIds])

  useEffect(() => {
    engine?.setLightStems(lightStemKinds)
  }, [engine, lightStemKinds])

  useEffect(() => {
    if (!enabled || selectedBulbs.length === 0) return
    let stopped = false
    let timer = 0
    const startedAt = performance.now()

    const tick = (): void => {
      if (stopped) return
      const { engine, playing: transportPlaying } = useStudioStore.getState()
      if (engine && transportPlaying) {
        const energy = engine.getLightEnergy()
        const frames: WizLightFrame[] = selectedBulbs.map((bulb, index) => ({
          host: bulb.ip,
          params: concertLightFrame(energy, index, performance.now() - startedAt)
        }))
        void window.timbrel.setWizLights(frames).catch((reason: unknown) => {
          if (!stopped) useConcertLightsStore.getState().setError(errorMessage(reason))
        })
      }
      timer = window.setTimeout(tick, FRAME_INTERVAL_MS)
    }
    tick()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [enabled, selectedBulbs])

  // Song changes briefly remove the old engine. Keep the global rig armed and
  // settle to standby until the next song starts instead of restoring/reselecting.
  useEffect(() => {
    if (!enabled || playing || selectedBulbs.length === 0) return
    void window.timbrel.setWizLights(
      selectedBulbs.map((bulb) => ({
        host: bulb.ip,
        params: { state: true, r: 22, g: 4, b: 38, dimming: 6 }
      }))
    )
  }, [enabled, playing, selectedBulbs])

  return null
}

export function ConcertLightsButton(): React.JSX.Element {
  const bulbs = useConcertLightsStore((state) => state.bulbs)
  const selectedBulbIds = useConcertLightsStore((state) => state.selectedBulbIds)
  const enabled = useConcertLightsStore((state) => state.enabled)
  const selectedCount = bulbs.filter((bulb) => selectedBulbIds.includes(bulbIdentity(bulb))).length

  return (
    <button
      onClick={() => useConcertLightsStore.getState().openPanel()}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium text-muted hover:border-accent hover:text-text"
      title="Global Philips WiZ concert-light rig"
    >
      <span aria-hidden>💡</span>
      <span>
        {enabled ? 'Lights live' : selectedCount > 0 ? `${selectedCount} lights` : 'Lights'}
      </span>
      {enabled && <span className="h-2 w-2 animate-pulse rounded-full bg-stem-drums" />}
    </button>
  )
}

export function ConcertLightsPanel(): React.JSX.Element | null {
  const open = useConcertLightsStore((state) => state.open)
  const bulbs = useConcertLightsStore((state) => state.bulbs)
  const selectedBulbIds = useConcertLightsStore((state) => state.selectedBulbIds)
  const discovering = useConcertLightsStore((state) => state.discovering)
  const enabled = useConcertLightsStore((state) => state.enabled)
  const error = useConcertLightsStore((state) => state.error)
  const lightStemKinds = useConcertLightsStore((state) => state.lightStemKinds)
  const playing = useStudioStore((state) => state.playing)
  const selectedBulbs = useMemo(() => {
    const selected = new Set(selectedBulbIds)
    return bulbs.filter((bulb) => selected.has(bulbIdentity(bulb)))
  }, [bulbs, selectedBulbIds])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm"
      onClick={() => useConcertLightsStore.getState().closePanel()}
    >
      <div
        className="animate-pop w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-border bg-surface shadow-[var(--shadow-dock)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Global concert lights</h2>
            <p className="mt-0.5 text-xs text-muted">One WiZ rig for every song in Timbrel</p>
          </div>
          <button
            onClick={() => useConcertLightsStore.getState().closePanel()}
            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
            aria-label="Close concert lights"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">WiZ bulbs on this network</div>
              <div className="text-xs text-muted">Your selection is saved for every song.</div>
            </div>
            <button
              onClick={() => void useConcertLightsStore.getState().discover()}
              disabled={discovering || enabled}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-text disabled:opacity-50"
            >
              {discovering ? 'Discovering…' : 'Discover'}
            </button>
          </div>

          <BulbList
            bulbs={bulbs}
            selectedBulbIds={selectedBulbIds}
            discovering={discovering}
            enabled={enabled}
          />

          <div>
            <div className="text-sm font-medium">Light source stems</div>
            <div className="mt-1 text-xs text-muted">
              Choose which parts of the mix drive brightness, colour, and beat pulses.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {STEM_KINDS.map((kind) => {
                const selected = lightStemKinds.includes(kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => useConcertLightsStore.getState().toggleLightStem(kind)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? 'border-accent bg-wash-lavender text-text'
                        : 'border-border bg-surface text-muted hover:border-accent'
                    }`}
                  >
                    {STEM_LABELS[kind]}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-wash-vocals px-3 py-2 text-xs text-danger">{error}</div>
          )}

          <div className="rounded-2xl bg-wash-lavender px-3.5 py-3 text-xs leading-relaxed text-muted">
            Loudness and frequency energy continuously move brightness, silent passages fall to
            1–5%, and every detected beat flashes at 100%. The global rig stays armed while you
            switch songs.
          </div>

          <button
            onClick={() =>
              enabled
                ? void useConcertLightsStore.getState().stop()
                : useConcertLightsStore.getState().start()
            }
            disabled={!enabled && selectedBulbs.length === 0}
            className="w-full rounded-full bg-charcoal px-4 py-2.5 text-sm font-semibold text-white hover:bg-charcoal-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enabled
              ? 'Stop and restore lights'
              : playing
                ? 'Start global concert sync'
                : 'Arm lights for all songs'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulbList({
  bulbs,
  selectedBulbIds,
  discovering,
  enabled
}: {
  bulbs: WizBulb[]
  selectedBulbIds: string[]
  discovering: boolean
  enabled: boolean
}): React.JSX.Element {
  return (
    <div className="min-h-20 overflow-hidden rounded-2xl border border-border bg-surface-2/50">
      {bulbs.length === 0 ? (
        <div className="grid min-h-20 place-items-center px-4 text-center text-sm text-muted">
          {discovering ? 'Listening for saved WiZ bulbs…' : 'No bulbs discovered yet.'}
        </div>
      ) : (
        bulbs.map((bulb) => (
          <label
            key={bulb.ip}
            className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={selectedBulbIds.includes(bulbIdentity(bulb))}
              disabled={enabled}
              onChange={() => useConcertLightsStore.getState().toggleBulb(bulb.ip)}
              className="accent-accent"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {bulb.name || `WiZ light ${bulb.ip.split('.').at(-1)}`}
              </span>
              <span className="block text-xs text-muted">
                {bulb.ip}
                {bulb.rssi != null ? ` · ${bulb.rssi} dBm` : ''}
              </span>
            </span>
          </label>
        ))
      )}
    </div>
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
