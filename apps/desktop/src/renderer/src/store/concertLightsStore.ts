import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WizBulb } from '@shared/ipc'
import { STEM_KINDS, type StemKind } from '@timbrel/core'

const AUTO_DISCOVERY_INTERVAL_MS = 5_000
let autoDiscoveryTimer: number | undefined

interface ConcertLightsStore {
  bulbs: WizBulb[]
  selectedBulbIds: string[]
  lightStemKinds: StemKind[]
  configured: boolean
  initialized: boolean
  discovering: boolean
  enabled: boolean
  open: boolean
  error: string | null

  init: () => void
  discover: () => Promise<void>
  toggleBulb: (ip: string) => void
  toggleLightStem: (kind: StemKind) => void
  start: () => void
  stop: () => Promise<void>
  openPanel: () => void
  closePanel: () => void
  setError: (error: string | null) => void
}

/** App-wide WiZ rig. Device selection is persisted; discovery results, current
 * bulb state, errors and whether the show is armed are deliberately transient. */
export const useConcertLightsStore = create<ConcertLightsStore>()(
  persist(
    (set, get) => ({
      bulbs: [],
      selectedBulbIds: [],
      lightStemKinds: [...STEM_KINDS],
      configured: false,
      initialized: false,
      discovering: false,
      enabled: false,
      open: false,
      error: null,

      init: () => {
        if (get().initialized) return
        set({ initialized: true })
        void get().discover()
        // Bulbs may still be joining Wi-Fi when Timbrel starts. Keep looking
        // until at least one is reachable instead of requiring repeated clicks.
        autoDiscoveryTimer ??= window.setInterval(() => {
          const state = get()
          if (state.bulbs.length === 0 && !state.discovering) void state.discover()
        }, AUTO_DISCOVERY_INTERVAL_MS)
      },

      discover: async () => {
        if (get().discovering) return
        set({ discovering: true, error: null })
        try {
          const bulbs = await window.timbrel.discoverWizBulbs()
          const state = get()
          const firstConfiguration = !state.configured
          const selectedBulbIds = firstConfiguration
            ? bulbs.map(bulbIdentity)
            : state.selectedBulbIds
          const selected = new Set(selectedBulbIds)
          const hasSelectedBulbs = bulbs.some((bulb) => selected.has(bulbIdentity(bulb)))
          set({
            bulbs,
            selectedBulbIds,
            configured: firstConfiguration ? bulbs.length > 0 : state.configured,
            // Discovery is the connection step: once a saved (or initially
            // selected) rig responds, arm it without requiring another click.
            enabled: hasSelectedBulbs,
            error:
              bulbs.length === 0
                ? 'No WiZ bulbs replied. Check that local communication is enabled in the WiZ app.'
                : null
          })
        } catch (reason) {
          set({ error: errorMessage(reason) })
        } finally {
          set({ discovering: false })
        }
      },

      toggleBulb: (ip) => {
        if (get().enabled) return
        const bulb = get().bulbs.find((candidate) => candidate.ip === ip)
        if (!bulb) return
        const id = bulbIdentity(bulb)
        const selected = new Set(get().selectedBulbIds)
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        set({ selectedBulbIds: [...selected], configured: true })
      },

      toggleLightStem: (kind) => {
        const selected = new Set(get().lightStemKinds)
        if (selected.has(kind)) {
          // An armed rig with no analysis source looks broken, so always keep
          // at least one stem selected.
          if (selected.size === 1) return
          selected.delete(kind)
        } else {
          selected.add(kind)
        }
        set({ lightStemKinds: STEM_KINDS.filter((candidate) => selected.has(candidate)) })
      },

      start: () => {
        if (get().bulbs.some((bulb) => get().selectedBulbIds.includes(bulbIdentity(bulb)))) {
          set({ enabled: true, error: null })
        }
      },

      stop: async () => {
        set({ enabled: false })
        const selected = new Set(get().selectedBulbIds)
        const frames = get()
          .bulbs.filter(
            (bulb) => selected.has(bulbIdentity(bulb)) && Object.keys(bulb.pilot).length > 0
          )
          .map((bulb) => ({ host: bulb.ip, params: bulb.pilot }))
        try {
          if (frames.length > 0) await window.timbrel.setWizLights(frames)
        } catch (reason) {
          set({ error: errorMessage(reason) })
        }
      },

      openPanel: () => set({ open: true }),
      closePanel: () => set({ open: false }),
      setError: (error) => set({ error })
    }),
    {
      name: 'timbrel-concert-lights',
      partialize: (state) => ({
        selectedBulbIds: state.selectedBulbIds,
        lightStemKinds: state.lightStemKinds,
        configured: state.configured
      })
    }
  )
)

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function bulbIdentity(bulb: WizBulb): string {
  return (bulb.mac ?? bulb.ip).toLowerCase()
}
