/**
 * Tiny app-wide UI store. The Audio Output panel is launched from a pill in the
 * Home *and* Studio headers but rendered once at the app root, so its open state
 * lives here rather than being threaded through props.
 */
import { create } from 'zustand'

interface UiStore {
  outputOpen: boolean
  openOutput: () => void
  closeOutput: () => void
}

export const useUiStore = create<UiStore>()((set) => ({
  outputOpen: false,
  openOutput: () => set({ outputOpen: true }),
  closeOutput: () => set({ outputOpen: false })
}))
