/**
 * The IPC contract shared by main, preload and renderer. Channel names and the
 * payload shapes that cross the context bridge live here so all three stay in
 * sync. Domain types come from `@timbrel/core`.
 */
import type {
  ExportEncodeSettings,
  ExportFormat,
  LoopRegion,
  MixerState,
  PeaksFile,
  ProjectFile,
  SeparationStage,
  SpotifyConnection,
  SpotifyPlaylist,
  SpotifyTrack,
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
  SavePeaks: 'peaks:save',
  ExportPickTarget: 'export:pickTarget',
  ExportEncode: 'export:encode',
  SpotifyStatus: 'spotify:status',
  SpotifyConnect: 'spotify:connect',
  SpotifyDisconnect: 'spotify:disconnect',
  SpotifyPlaylists: 'spotify:playlists',
  SpotifyPlaylistTracks: 'spotify:playlistTracks',
  SpotifyLiked: 'spotify:liked'
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

/** Ask the main process for a destination via a native dialog. `file` picks a
 *  single save path (one output); `dir` picks a folder (many outputs). */
export interface ExportPickTargetInput {
  kind: 'file' | 'dir'
  /** Suggested filename for the save dialog (file mode only). */
  defaultName: string
  /** Drives the save dialog's file-type filter (file mode only). */
  format: ExportFormat
}

/**
 * One encode request: raw interleaved f32 PCM from the renderer's offline
 * render → ffmpeg → a file. For single-file exports `targetPath` is the chosen
 * file; for multi-file exports it's the chosen folder and `filename` is joined.
 */
export interface ExportEncodeInput {
  targetPath: string
  /** When set, `targetPath` is a folder and this is joined onto it. */
  filename?: string
  /** Interleaved 32-bit float PCM, little-endian. */
  pcm: ArrayBuffer
  sampleRate: number
  channels: number
  settings: ExportEncodeSettings
}

export type ExportEncodeResult = { ok: true; path: string } | { ok: false; error: string }

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
  /** Open a native dialog for an export destination; null if cancelled. */
  pickExportTarget(input: ExportPickTargetInput): Promise<string | null>
  /** Encode rendered PCM to a file via ffmpeg. */
  encodeExport(input: ExportEncodeInput): Promise<ExportEncodeResult>
  /** Whether a Spotify session is stored, and whose. */
  spotifyStatus(): Promise<SpotifyConnection>
  /** Open the browser consent flow; resolves once connected (rejects on deny/timeout). */
  spotifyConnect(): Promise<SpotifyConnection>
  /** Forget the stored Spotify session. */
  spotifyDisconnect(): Promise<void>
  /** The user's playlists (metadata only). */
  spotifyPlaylists(): Promise<SpotifyPlaylist[]>
  /** Tracks in a playlist (metadata only). */
  spotifyPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]>
  /** The user's liked songs (metadata only). */
  spotifyLikedTracks(): Promise<SpotifyTrack[]>
}
