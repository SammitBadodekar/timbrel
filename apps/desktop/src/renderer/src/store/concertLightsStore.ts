import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WizBulb } from '@shared/ipc'

interface ConcertLightsStore {
  bulbs: WizBulb[]
  selectedBulbIds: string[]
  configured: boolean
  initialized: boolean
  discovering: boolean
  enabled: boolean
  open: boolean
  error: string | null

  init: () => void
  discover: () => Promise<void>
  toggleBulb: (ip: string) => void
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
      },

      discover: async () => {
        if (get().discovering) return
        set({ discovering: true, error: null })
        try {
          const bulbs = await window.timbrel.discoverWizBulbs()
          const firstConfiguration = !get().configured
          set({
            bulbs,
            selectedBulbIds: firstConfiguration ? bulbs.map(bulbIdentity) : get().selectedBulbIds,
            configured: firstConfiguration ? bulbs.length > 0 : get().configured,
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
