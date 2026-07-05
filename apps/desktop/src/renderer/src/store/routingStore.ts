/**
 * The global multi-device output routing rig (DECISIONS.md → Multi-device audio
 * output routing). Deliberately a SEPARATE, app-level store from the per-song
 * `studioStore`: routing is one app-wide "live rig" that outlives any song and
 * must be editable from the Audio Output panel even with no song loaded.
 *
 * The store is the source of truth for the rig; it resolves the rig against the
 * currently-connected devices and pushes the result to whatever `StudioEngine`
 * is live. The engine stays dumb about tags/rigs — it just applies a
 * `ResolvedRouting`. `studioStore.load()` pulls the current `resolved` when it
 * creates a fresh engine; device/rig changes push into the existing one here.
 */
import { create } from 'zustand'
import {
  assignDeviceTag,
  defaultRoutingRig,
  resetRigRouting,
  resolveRouting,
  type ResolvedRouting,
  type RoutableChannel,
  type RouteTarget,
  type RoutingRig
} from '@timbrel/core'
import { useStudioStore } from './studioStore'

interface RoutingData {
  rig: RoutingRig
  /** Currently-connected output devices (from `enumerateDevices`). */
  devices: MediaDeviceInfo[]
  /** The rig resolved against `devices` — mirrors what the engine is playing. */
  resolved: ResolvedRouting
  loaded: boolean
}

interface RoutingActions {
  /** Load the saved rig, enumerate devices, and watch for hot-plug changes. */
  init: () => Promise<void>
  refreshDevices: () => Promise<void>
  setDefaultTarget: (targets: RouteTarget[]) => void
  /** Override a channel's output, or pass null to clear it back to the default. */
  setChannelOverride: (channel: RoutableChannel, targets: RouteTarget[] | null) => void
  setDeviceTag: (deviceId: string, tag: string | null) => void
  /** Clear the default target + every override back to System Default. */
  reset: () => void
}

type RoutingStore = RoutingData & RoutingActions

/** Re-resolve the rig against the live devices and push it to the engine. */
function apply(rig: RoutingRig, devices: MediaDeviceInfo[]): ResolvedRouting {
  const resolved = resolveRouting(
    rig,
    devices.map((d) => d.deviceId)
  )
  useStudioStore.getState().engine?.setRouting(resolved)
  return resolved
}

export const useRoutingStore = create<RoutingStore>()((set, get) => {
  /** Persist + re-resolve + push, after any rig mutation. */
  function commit(rig: RoutingRig): void {
    void window.timbrel.saveRoutingRig(rig)
    set({ rig, resolved: apply(rig, get().devices) })
  }

  return {
    rig: defaultRoutingRig(),
    devices: [],
    resolved: apply(defaultRoutingRig(), []),
    loaded: false,

    init: async () => {
      // Push the live routing onto every freshly-created engine (a new song
      // load). `refreshDevices` below covers an engine that already exists.
      useStudioStore.subscribe((state, prev) => {
        if (state.engine && state.engine !== prev.engine) state.engine.setRouting(get().resolved)
      })
      const rig = await window.timbrel.getRoutingRig()
      set({ rig, loaded: true })
      await get().refreshDevices()
      navigator.mediaDevices.addEventListener('devicechange', () => void get().refreshDevices())
    },

    refreshDevices: async () => {
      const all = await navigator.mediaDevices.enumerateDevices()
      const devices = all.filter((d) => d.kind === 'audiooutput')
      set({ devices, resolved: apply(get().rig, devices) })
    },

    setDefaultTarget: (targets) => commit({ ...get().rig, defaultTarget: targets }),

    setChannelOverride: (channel, targets) => {
      const overrides = { ...get().rig.overrides }
      if (targets && targets.length > 0) overrides[channel] = targets
      else delete overrides[channel]
      commit({ ...get().rig, overrides })
    },

    setDeviceTag: (deviceId, tag) => {
      const label = get().devices.find((d) => d.deviceId === deviceId)?.label || deviceId
      commit({ ...get().rig, devices: assignDeviceTag(get().rig.devices, deviceId, label, tag) })
    },

    reset: () => commit(resetRigRouting(get().rig))
  }
})
