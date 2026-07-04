/**
 * The IPC contract shared by main, preload and renderer. Channel names and the
 * payload shapes that cross the context bridge live here so all three stay in
 * sync. Domain types come from `@timbrel/core`.
 */
import type {
  LoopRegion,
  MixerState,
  PeaksFile,
  ProjectFile,
  SeparationStage,
  StemKind,
  TempoKeyState
} from '@timbrel/core'

export const IpcChannel = {
  PickAudio: 'dialog:pickAudio',
  StartSeparation: 'separation:start',
  SeparationEvent: 'separation:event',
  ListSongs: 'library:list',
  LoadProject: 'project:load',
  SaveProject: 'project:save',
  ReadStem: 'stem:bytes',
  ReadPeaks: 'peaks:read',
  SavePeaks: 'peaks:save'
} as const

export interface StartSeparationInput {
  filePath: string
}

export type StartSeparationResult =
  | { ok: true; songId: string; alreadyExists: boolean }
  | { ok: false; error: string }

/** Row shown in the library list — the queryable subset of a Song. */
export interface SongSummary {
  id: string
  title: string
  artist: string | null
  durationSec: number | null
  bpm: number | null
  key: string | null
  separated: boolean
  createdAt: string
}

/**
 * App-level separation events pushed main → renderer while a job runs. This is
 * the sidecar's stream re-keyed by `songId` (the renderer never sees jobIds).
 */
export type SeparationEvent =
  | {
      type: 'progress'
      songId: string
      stage: SeparationStage
      progress: number
      message?: string
    }
  | { type: 'stem'; songId: string; kind: StemKind; path: string }
  | { type: 'done'; songId: string }
  | { type: 'error'; songId?: string; message: string }

/** A project loaded for the studio, plus which stems exist on disk. */
export interface LoadedProject {
  project: ProjectFile
  stems: StemKind[]
}

/**
 * The editable subset of `project.json` the studio writes back (debounced).
 * Every field is optional so callers patch only what changed; the main process
 * merges it onto the on-disk project and bumps `updatedAt`.
 */
export interface ProjectPatch {
  mixer?: MixerState
  tempoKey?: TempoKeyState
  loops?: LoopRegion[]
  beatGridOffsetSec?: number
}

/** The surface exposed on `window.timbrel` by the preload bridge. */
export interface TimbrelApi {
  pickAudioFile(): Promise<string | null>
  startSeparation(input: StartSeparationInput): Promise<StartSeparationResult>
  /** Subscribe to push events; returns an unsubscribe function. */
  onSeparationEvent(cb: (event: SeparationEvent) => void): () => void
  listSongs(): Promise<SongSummary[]>
  loadProject(songId: string): Promise<LoadedProject | null>
  /** Merge editable studio state into `project.json`. */
  saveProject(songId: string, patch: ProjectPatch): Promise<void>
  /** Raw FLAC bytes for a stem, for Web Audio `decodeAudioData`. */
  getStemBytes(songId: string, kind: StemKind): Promise<ArrayBuffer | null>
  /** Cached waveform peaks, or null if not computed yet. */
  getPeaks(songId: string): Promise<PeaksFile | null>
  /** Persist computed waveform peaks for instant re-render next time. */
  savePeaks(songId: string, peaks: PeaksFile): Promise<void>
}
