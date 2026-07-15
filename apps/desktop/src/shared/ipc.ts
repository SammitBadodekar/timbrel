/**
 * The IPC contract shared by main, preload and renderer. Channel names and the
 * payload shapes that cross the context bridge live here so all three stay in
 * sync. Domain types come from `@timbrel/core`.
 */
import type {
  ExportEncodeSettings,
  ExportFormat,
  LoopRegion,
  Lyrics,
  MixerState,
  PeaksFile,
  PlaylistSummary,
  ProjectFile,
  RoutingRig,
  SeparationStage,
  SpotifyConnection,
  SpotifyPlaylist,
  SpotifyTrack,
  StemKind,
  TempoKeyState,
  YtCandidate
} from '@timbrel/core'

export const IpcChannel = {
  PickAudio: 'dialog:pickAudio',
  StartSeparation: 'separation:start',
  SeparationEvent: 'separation:event',
  ListSongs: 'library:list',
  DeleteSong: 'library:delete',
  PlaylistList: 'playlist:list',
  PlaylistGet: 'playlist:get',
  PlaylistCreate: 'playlist:create',
  PlaylistRename: 'playlist:rename',
  PlaylistDelete: 'playlist:delete',
  PlaylistAddSongs: 'playlist:addSongs',
  PlaylistRemoveSong: 'playlist:removeSong',
  PlaylistReorder: 'playlist:reorder',
  LoadProject: 'project:load',
  SaveProject: 'project:save',
  ReadPeaks: 'peaks:read',
  SavePeaks: 'peaks:save',
  ExportPickTarget: 'export:pickTarget',
  ExportEncode: 'export:encode',
  SpotifyStatus: 'spotify:status',
  SpotifyConnect: 'spotify:connect',
  SpotifyDisconnect: 'spotify:disconnect',
  SpotifySetClientId: 'spotify:setClientId',
  SpotifyOpenDashboard: 'spotify:openDashboard',
  SpotifyPlaylists: 'spotify:playlists',
  SpotifyPlaylistTracks: 'spotify:playlistTracks',
  SpotifyLiked: 'spotify:liked',
  SpotifyImportTrack: 'spotify:importTrack',
  SpotifyImportTracks: 'spotify:importTracks',
  YoutubeSearch: 'youtube:search',
  YoutubeImport: 'youtube:import',
  GetLyrics: 'lyrics:get',
  GetRoutingRig: 'routing:get',
  SaveRoutingRig: 'routing:save',
  SetupState: 'setup:state',
  SetupEvent: 'setup:event',
  SetupRetry: 'setup:retry',
  WizDiscover: 'wiz:discover',
  WizSetLights: 'wiz:setLights'
} as const

/** The subset of setPilot supported by Timbrel's concert-light integration. */
export interface WizLightCommand {
  state?: boolean
  r?: number
  g?: number
  b?: number
  dimming?: number
  temp?: number
}

export interface WizLightFrame {
  host: string
  params: WizLightCommand
}

export interface WizBulb {
  ip: string
  mac?: string
  name?: string
  rssi?: number
  /** State captured during discovery, restored when the show is stopped. */
  pilot: WizLightCommand
}

/**
 * First-run install state — the frozen stem-separation engine plus the CLI
 * tools (yt-dlp, ffmpeg/ffprobe) are downloaded on first launch so the
 * installer stays small. The renderer blocks the whole UI behind a setup
 * screen until this reaches `ready`.
 */
export type SetupState =
  | {
      status: 'installing'
      /** Human label of what's installing — "audio engine", "YouTube downloader"… */
      item: string
      /** Rough download size, for the "x% of ~N MB" hint. */
      approxMB: number
      /** 1-based position among the items this run still has to install. */
      step: number
      steps: number
      stage: 'downloading' | 'extracting'
      progress: number
    }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export interface StartSeparationInput {
  filePath: string
}

/**
 * The stages a job can report. A Spotify import adds two acquisition stages
 * *before* the sidecar's separation stages (`SeparationStage`); a local upload
 * only ever reports the latter.
 */
export type ImportStage = SeparationStage | 'matching' | 'downloading'

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
  /** YouTube thumbnail URL (from the source's video id), or null → monogram. */
  thumbnailUrl: string | null
}

/** One playlist with its ordered member songs (for the detail view). */
export interface PlaylistDetail {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  songs: SongSummary[]
}

/**
 * App-level separation events pushed main → renderer while a job runs. This is
 * the sidecar's stream re-keyed by `songId` (the renderer never sees jobIds).
 */
export type SeparationEvent =
  | {
      type: 'progress'
      songId: string
      stage: ImportStage
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
  /** Absolute filesystem path for a dropped `File` (Electron `webUtils`);
   *  `File.path` was removed in Electron 32+. Empty string if unavailable. */
  pathForFile(file: File): string
  startSeparation(input: StartSeparationInput): Promise<StartSeparationResult>
  /** Subscribe to push events; returns an unsubscribe function. */
  onSeparationEvent(cb: (event: SeparationEvent) => void): () => void
  listSongs(): Promise<SongSummary[]>
  /** Permanently delete a song: its stems/original on disk, its index row, and
   *  its membership in any playlists (the playlists themselves survive). */
  deleteSong(songId: string): Promise<void>
  /** All playlists with derived counts + cover song ids, newest first. */
  listPlaylists(): Promise<PlaylistSummary[]>
  /** One playlist with its ordered member songs, or null if gone. */
  getPlaylist(playlistId: string): Promise<PlaylistDetail | null>
  /** Create an empty playlist; returns it in summary form. */
  createPlaylist(name: string): Promise<PlaylistSummary>
  renamePlaylist(playlistId: string, name: string): Promise<void>
  /** Delete the playlist only — never the songs it contained. */
  deletePlaylist(playlistId: string): Promise<void>
  /** Append songs to a playlist (dedups ones already present). */
  addSongsToPlaylist(playlistId: string, songIds: string[]): Promise<void>
  removeSongFromPlaylist(playlistId: string, songId: string): Promise<void>
  /** Persist a new member order (full ordered id list). */
  reorderPlaylist(playlistId: string, orderedSongIds: string[]): Promise<void>
  loadProject(songId: string): Promise<LoadedProject | null>
  /** Merge editable studio state into `project.json`. */
  saveProject(songId: string, patch: ProjectPatch): Promise<void>
  /** Cached waveform peaks, or null if not computed yet. */
  getPeaks(songId: string): Promise<PeaksFile | null>
  /** Persist computed waveform peaks for instant re-render next time. */
  savePeaks(songId: string, peaks: PeaksFile): Promise<void>
  /** Open a native dialog for an export destination; null if cancelled. */
  pickExportTarget(input: ExportPickTargetInput): Promise<string | null>
  /** Encode rendered PCM to a file via ffmpeg. */
  encodeExport(input: ExportEncodeInput): Promise<ExportEncodeResult>
  /** Find WiZ bulbs on the current LAN using their local UDP protocol. */
  discoverWizBulbs(): Promise<WizBulb[]>
  /** Queue one concert-light frame for all selected bulbs. */
  setWizLights(frames: WizLightFrame[]): Promise<void>
  /** Whether a Spotify session is stored, and whose. */
  spotifyStatus(): Promise<SpotifyConnection>
  /** Open the browser consent flow; resolves once connected (rejects on deny/timeout). */
  spotifyConnect(): Promise<SpotifyConnection>
  /** Forget the stored Spotify session. */
  spotifyDisconnect(): Promise<void>
  /** Store the user's own Spotify `client_id` (BYO); returns the fresh status. */
  spotifySetClientId(clientId: string): Promise<SpotifyConnection>
  /** Open the Spotify developer dashboard in the system browser. */
  spotifyOpenDashboard(): Promise<void>
  /** The user's playlists (metadata only). */
  spotifyPlaylists(): Promise<SpotifyPlaylist[]>
  /** Tracks in a playlist (metadata only). */
  spotifyPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]>
  /** The user's liked songs (metadata only). */
  spotifyLikedTracks(): Promise<SpotifyTrack[]>
  /**
   * Match a Spotify track on YouTube, download its audio, and feed it into the
   * separation pipeline. Returns immediately with the song id; progress (match →
   * download → separate) streams over `onSeparationEvent`, keyed by that id.
   */
  spotifyImportTrack(track: SpotifyTrack): Promise<StartSeparationResult>
  /**
   * Import a whole batch (a Spotify playlist or Liked Songs) in one call.
   * Returns a result per track immediately; the acquisition + separation jobs
   * run serially in the main process (one demucs at a time), streaming progress
   * over `onSeparationEvent`. When `playlistName` is set the songs are also
   * collected into a local playlist of that name (created if needed).
   */
  spotifyImportTracks(
    tracks: SpotifyTrack[],
    playlistName: string | null
  ): Promise<StartSeparationResult[]>
  /** Search YouTube for songs (metadata only). */
  youtubeSearch(query: string): Promise<YtCandidate[]>
  /**
   * Download a chosen YouTube result and feed it into the separation pipeline.
   * Returns immediately with the song id; progress streams over
   * `onSeparationEvent`, keyed by that id.
   */
  youtubeImport(video: YtCandidate): Promise<StartSeparationResult>
  /** Synced lyrics for a song (cached; best-effort from LRCLIB). */
  getLyrics(songId: string): Promise<Lyrics | null>
  /** The global multi-device output routing rig (app-wide, not per-song). */
  getRoutingRig(): Promise<RoutingRig>
  /** Persist the global routing rig. */
  saveRoutingRig(rig: RoutingRig): Promise<void>
  /** Current first-run install state (engine + tools). */
  getSetupState(): Promise<SetupState>
  /** Subscribe to install state changes; returns an unsubscribe function. */
  onSetupState(cb: (state: SetupState) => void): () => void
  /** Re-attempt a failed install (e.g. after a network error). */
  retrySetup(): Promise<void>
}
