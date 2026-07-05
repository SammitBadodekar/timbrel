/**
 * The studio's single source of truth (Zustand), replacing the prop-drilling +
 * `engineRef`-mirroring the studio outgrew across v0.2.
 *
 * The store *owns* the imperative `StudioEngine`: every user action mutates the
 * engine (the audio graph) and the reactive slice in one place, so there's no
 * "call engine.setX() then setState(x)" duplication and no ref read during
 * render (the export panel used to capture `engineRef.current` in an onClick to
 * satisfy `react-hooks/refs` — that dance is gone).
 *
 * Persistence lives here too: user actions schedule a debounced `project.json`
 * write; `load()` seeds state with a plain `set()` and never schedules a save,
 * so the old hydration-echo guard (`didHydrate`) is unnecessary.
 */
import { create } from 'zustand'
import {
  PEAK_BUCKETS,
  STEM_KINDS,
  STEMS_DIR,
  stemFilename,
  type LoopRegion,
  type Lyrics,
  type ProjectFile,
  type StemKind,
  type TempoKeyState
} from '@timbrel/core'
import type { ProjectPatch } from '@shared/ipc'
import { StudioEngine, type StemControls } from '../audio/StudioEngine'

type Controls = Record<StemKind, StemControls>

function defaultControls(): Controls {
  return Object.fromEntries(
    STEM_KINDS.map((k) => [k, { gain: 1, muted: false, soloed: false }])
  ) as Controls
}

// --- Debounced persistence (module-level: not reactive state) ---------------
let saveTimer: number | undefined
let pendingPatch: ProjectPatch | null = null

function scheduleSave(songId: string, patch: ProjectPatch): void {
  pendingPatch = { ...pendingPatch, ...patch }
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const p = pendingPatch
    pendingPatch = null
    if (p) void window.timbrel.saveProject(songId, p)
  }, 500)
}

function flushSave(songId: string): void {
  window.clearTimeout(saveTimer)
  if (pendingPatch) {
    void window.timbrel.saveProject(songId, pendingPatch)
    pendingPatch = null
  }
}

/**
 * Monotonic load token. Bumped on every `load()` and on `dispose()`; an async
 * load whose token is stale (StrictMode remount, or the user left the studio
 * mid-load) bails and disposes the engine it created. Not reactive state.
 */
let loadSeq = 0

interface StudioData {
  /** Owns the audio graph; null before load / after dispose. */
  engine: StudioEngine | null
  songId: string | null
  loading: boolean
  error: string | null

  project: ProjectFile | null
  stemKinds: StemKind[]
  peaks: Partial<Record<StemKind, number[]>>
  controls: Controls

  playing: boolean
  countingIn: boolean
  currentTime: number
  duration: number

  beatGridOffsetSec: number
  tempoKey: TempoKeyState
  loop: LoopRegion | null

  // Synced lyrics (best-effort from LRCLIB); null until fetched or if none found.
  lyrics: Lyrics | null
  lyricsLoading: boolean

  // Ephemeral practice aids — deliberately not persisted.
  metronome: boolean
  countIn: boolean

  exportOpen: boolean

  // Measured lane region (for the beat-grid / playhead overlay).
  laneW: number
  laneH: number
}

interface StudioActions {
  load: (songId: string) => Promise<void>
  dispose: () => void

  tick: () => void
  togglePlay: () => Promise<void>
  seek: (t: number) => void

  setGain: (kind: StemKind, value: number) => void
  toggleMute: (kind: StemKind) => void
  toggleSolo: (kind: StemKind) => void

  nudge: (deltaSec: number) => void
  setTempo: (ratio: number) => void
  setSemitones: (semitones: number) => void

  setLoop: (arg: LoopRegion | null | ((prev: LoopRegion | null) => LoopRegion | null)) => void
  toggleLoop: () => void
  clearLoop: () => void

  toggleMetronome: () => void
  toggleCountIn: () => void

  openExport: () => void
  closeExport: () => void

  setLaneSize: (w: number, h: number) => void
  /** Schedule a debounced write of the persisted slice. */
  persist: () => void
}

type StudioStore = StudioData & StudioActions

function initialData(): StudioData {
  return {
    engine: null,
    songId: null,
    loading: true,
    error: null,
    project: null,
    stemKinds: [],
    peaks: {},
    controls: defaultControls(),
    playing: false,
    countingIn: false,
    currentTime: 0,
    duration: 0,
    beatGridOffsetSec: 0,
    tempoKey: { tempoRatio: 1, semitones: 0 },
    loop: null,
    lyrics: null,
    lyricsLoading: false,
    metronome: false,
    countIn: false,
    exportOpen: false,
    laneW: 0,
    laneH: 0
  }
}

export const useStudioStore = create<StudioStore>()((set, get) => ({
  ...initialData(),

  // --- Lifecycle -----------------------------------------------------------
  load: async (songId) => {
    const myLoad = ++loadSeq
    const engine = new StudioEngine()
    // Clear any previous song and expose the fresh engine (the RAF `tick`
    // reads it) before the first await.
    set({ ...initialData(), engine, songId })
    const stale = (): boolean => myLoad !== loadSeq

    try {
      const loaded = await window.timbrel.loadProject(songId)
      if (stale()) return engine.dispose()
      if (!loaded) {
        set({ error: 'Project not found on disk.', loading: false })
        return
      }

      // Stems stream straight from the library over the privileged media
      // protocol — no whole-file structured clone across the IPC boundary.
      const buffers: Partial<Record<StemKind, ArrayBuffer>> = {}
      await Promise.all(
        loaded.stems.map(async (kind) => {
          const res = await fetch(`timbrel-media://${songId}/${STEMS_DIR}/${stemFilename(kind)}`)
          if (res.ok) buffers[kind] = await res.arrayBuffer()
        })
      )
      if (stale()) return engine.dispose()

      const kinds = await engine.loadStems(buffers)
      if (stale()) return engine.dispose()

      engine.applyMixerState(loaded.project.mixer)
      engine.applyTempoKey(loaded.project.tempoKey)
      const savedLoop = loaded.project.loops[0] ?? null
      engine.setLoop(savedLoop?.enabled ? savedLoop : null)
      engine.setBeats(
        loaded.project.features.beatTimes,
        loaded.project.features.downbeatTimes,
        loaded.project.beatGridOffsetSec
      )

      const controls = defaultControls()
      for (const k of kinds) controls[k] = { ...engine.getControls(k) }

      set({
        project: loaded.project,
        stemKinds: kinds,
        controls,
        beatGridOffsetSec: loaded.project.beatGridOffsetSec,
        tempoKey: loaded.project.tempoKey,
        loop: savedLoop,
        duration: engine.duration
      })

      // Cached peaks render instantly; otherwise compute once and persist.
      const cached = await window.timbrel.getPeaks(songId)
      if (stale()) return engine.dispose()
      let stemPeaks: Partial<Record<StemKind, number[]>>
      if (
        cached &&
        cached.buckets === PEAK_BUCKETS &&
        kinds.every((k) => (cached.stems[k]?.length ?? 0) > 0)
      ) {
        stemPeaks = cached.stems
      } else {
        stemPeaks = engine.computeAllPeaks(PEAK_BUCKETS)
        void window.timbrel.savePeaks(songId, {
          version: 1,
          buckets: PEAK_BUCKETS,
          durationSec: engine.duration,
          stems: stemPeaks
        })
      }
      if (stale()) return engine.dispose()
      set({ peaks: stemPeaks, loading: false })

      // Lyrics are networked + best-effort — fetch after the studio is interactive.
      set({ lyricsLoading: true })
      void window.timbrel.getLyrics(songId).then((lyrics) => {
        if (!stale()) set({ lyrics, lyricsLoading: false })
      })
    } catch (err) {
      if (stale()) engine.dispose()
      else set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  dispose: () => {
    loadSeq++ // invalidate any in-flight load
    const { songId, engine } = get()
    if (songId) flushSave(songId)
    engine?.dispose()
    set(initialData())
  },

  // --- Transport -----------------------------------------------------------
  // Called each RAF frame: reflect the engine clock, and drive loop-wrap /
  // end-of-song (same shape as the old handleEnded check).
  tick: () => {
    const { engine } = get()
    if (!engine) return
    if (engine.isPlaying) {
      const loop = engine.activeLoop
      if (loop && engine.currentTime >= loop.endSec) {
        engine.seek(loop.startSec)
      } else if (engine.duration > 0 && engine.currentTime >= engine.duration) {
        engine.handleEnded()
        set({ playing: false })
      }
    }
    const t = engine.currentTime
    if (t !== get().currentTime) set({ currentTime: t })
  },

  togglePlay: async () => {
    const { engine, playing, countingIn, countIn, tempoKey, project } = get()
    if (!engine) return
    if (playing || countingIn) {
      engine.cancelCountIn()
      engine.pause()
      set({ countingIn: false, playing: false })
      return
    }
    if (countIn) {
      // One bar of clicks at the heard tempo, then roll the transport.
      const bpm = project?.features.bpm
      const secPerBeat = (bpm ? 60 / bpm : 0.5) / tempoKey.tempoRatio
      set({ countingIn: true })
      engine.startCountIn(4, secPerBeat, () => {
        set({ countingIn: false })
        void engine.play().then(() => set({ playing: true }))
      })
      return
    }
    await engine.play()
    set({ playing: true })
  },

  seek: (t) => {
    const { engine, duration } = get()
    if (!engine) return
    const clamped = Math.max(0, Math.min(t, duration))
    engine.seek(clamped)
    set({ currentTime: clamped })
  },

  // --- Mixer ---------------------------------------------------------------
  setGain: (kind, value) => {
    const { engine, controls } = get()
    engine?.setGain(kind, value)
    set({ controls: { ...controls, [kind]: { ...controls[kind], gain: value } } })
    get().persist()
  },

  toggleMute: (kind) => {
    const { engine, controls } = get()
    const muted = engine?.toggleMute(kind) ?? false
    set({ controls: { ...controls, [kind]: { ...controls[kind], muted } } })
    get().persist()
  },

  toggleSolo: (kind) => {
    const { engine, controls } = get()
    const soloed = engine?.toggleSolo(kind) ?? false
    set({ controls: { ...controls, [kind]: { ...controls[kind], soloed } } })
    get().persist()
  },

  // --- Grid / tempo / key --------------------------------------------------
  nudge: (deltaSec) => {
    const { engine, project } = get()
    const next = Math.round((get().beatGridOffsetSec + deltaSec) * 1000) / 1000
    engine?.setBeats(project?.features.beatTimes ?? [], project?.features.downbeatTimes ?? [], next)
    set({ beatGridOffsetSec: next })
    get().persist()
  },

  setTempo: (ratio) => {
    const { engine, tempoKey } = get()
    const clamped = Math.min(1.5, Math.max(0.5, Math.round(ratio * 100) / 100))
    if (clamped === tempoKey.tempoRatio) return
    engine?.setTempo(clamped)
    set({ tempoKey: { ...tempoKey, tempoRatio: clamped } })
    get().persist()
  },

  setSemitones: (semitones) => {
    const { engine, tempoKey } = get()
    const clamped = Math.round(Math.min(12, Math.max(-12, semitones)))
    if (clamped === tempoKey.semitones) return
    engine?.setSemitones(clamped)
    set({ tempoKey: { ...tempoKey, semitones: clamped } })
    get().persist()
  },

  // --- Loop ----------------------------------------------------------------
  setLoop: (arg) => {
    const prev = get().loop
    const next = typeof arg === 'function' ? arg(prev) : arg
    if (next === prev) return
    // Engine wraps playback only while an *enabled* loop is set.
    get().engine?.setLoop(next?.enabled ? next : null)
    set({ loop: next })
    get().persist()
  },

  toggleLoop: () => get().setLoop((l) => (l ? { ...l, enabled: !l.enabled } : l)),
  clearLoop: () => get().setLoop(null),

  // --- Ephemeral aids ------------------------------------------------------
  toggleMetronome: () => {
    const next = !get().metronome
    get().engine?.setMetronome(next)
    set({ metronome: next })
  },
  toggleCountIn: () => set({ countIn: !get().countIn }),

  // --- Export --------------------------------------------------------------
  openExport: () => {
    if (get().engine) set({ exportOpen: true })
  },
  closeExport: () => set({ exportOpen: false }),

  // --- View measurement ----------------------------------------------------
  setLaneSize: (w, h) => {
    if (w !== get().laneW || h !== get().laneH) set({ laneW: w, laneH: h })
  },

  persist: () => {
    const { songId, controls, beatGridOffsetSec, tempoKey, loop } = get()
    if (!songId) return
    scheduleSave(songId, {
      mixer: controls,
      beatGridOffsetSec,
      tempoKey,
      loops: loop ? [loop] : []
    })
  }
}))
