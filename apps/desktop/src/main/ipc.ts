/** Wires the renderer's requests to storage + the sidecar, and pushes
 *  separation progress back out. The one place the core loop is orchestrated. */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { basename, extname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import {
  createProjectFile,
  emptyFeatures,
  parseTrackFromYouTube,
  STEM_KINDS,
  type Lyrics,
  type PeaksFile,
  type ProjectFile,
  type SpotifyTrack,
  type StemKind,
  type YtCandidate
} from '@timbrel/core'
import {
  IpcChannel,
  type LoadedProject,
  type ProjectPatch,
  type SeparationEvent,
  type StartSeparationInput,
  type StartSeparationResult
} from '../shared/ipc'
import type { SidecarManager } from './sidecar/manager'
import * as songs from './storage/songs'
import { hashFile, songIdFromHash, songIdFromSpotify, songIdFromYoutube } from './lib/hash'
import { songDir, stemsDir, projectPath, peaksPath, lyricsPath, stemPath } from './lib/paths'
import { registerExportIpc } from './export/ipc'
import { registerSpotifyIpc } from './spotify/ipc'
import { matchYtTrack } from './spotify/download'
import { searchYouTube, downloadYtAudio } from './youtube/ytdlp'
import { fetchLyrics } from './lyrics/lrclib'

export function registerIpc(sidecar: SidecarManager): void {
  registerExportIpc()
  registerSpotifyIpc()

  ipcMain.handle(IpcChannel.PickAudio, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'oga', 'aac', 'aiff', 'aif']
        }
      ]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(
    IpcChannel.StartSeparation,
    async (_event, input: StartSeparationInput): Promise<StartSeparationResult> => {
      try {
        return await startSeparation(sidecar, input.filePath)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.SpotifyImportTrack,
    async (_event, track: SpotifyTrack): Promise<StartSeparationResult> => {
      try {
        return await startSpotifyImport(sidecar, track)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IpcChannel.YoutubeSearch, async (_event, query: string) => {
    const q = query.trim()
    return q ? searchYouTube(q) : []
  })

  ipcMain.handle(
    IpcChannel.YoutubeImport,
    async (_event, video: YtCandidate): Promise<StartSeparationResult> => {
      try {
        return await startYoutubeImport(sidecar, video)
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IpcChannel.GetLyrics,
    async (_event, songId: string): Promise<Lyrics | null> => getLyrics(songId)
  )

  ipcMain.handle(IpcChannel.ListSongs, async () => songs.list())

  ipcMain.handle(IpcChannel.LoadProject, async (_event, songId: string) => loadProject(songId))

  ipcMain.handle(
    IpcChannel.SaveProject,
    async (_event, songId: string, patch: ProjectPatch): Promise<void> => saveProject(songId, patch)
  )

  ipcMain.handle(
    IpcChannel.ReadStem,
    async (_event, songId: string, kind: StemKind): Promise<ArrayBuffer | null> => {
      const path = stemPath(songId, kind)
      if (!existsSync(path)) return null
      const buf = await readFile(path)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
  )

  ipcMain.handle(
    IpcChannel.ReadPeaks,
    async (_event, songId: string): Promise<PeaksFile | null> => {
      try {
        return JSON.parse(await readFile(peaksPath(songId), 'utf8')) as PeaksFile
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(
    IpcChannel.SavePeaks,
    async (_event, songId: string, peaks: PeaksFile): Promise<void> => {
      await writeFile(peaksPath(songId), JSON.stringify(peaks), 'utf8')
    }
  )
}

async function startSeparation(
  sidecar: SidecarManager,
  filePath: string
): Promise<StartSeparationResult> {
  const hash = await hashFile(filePath)
  const existing = songs.findByHash(hash)

  // Dedup: the same track is never re-separated (DECISIONS.md → Storage).
  if (existing?.separatedAt) {
    return { ok: true, songId: existing.id, alreadyExists: true }
  }

  const songId = existing?.id ?? songIdFromHash(hash)
  const ext = extname(filePath).slice(1).toLowerCase() || 'audio'
  const originalDest = join(songDir(songId), `original.${ext}`)
  const title = basename(filePath, extname(filePath))
  const now = new Date().toISOString()

  await mkdir(stemsDir(songId), { recursive: true })
  await copyFile(filePath, originalDest)

  if (!existing) {
    songs.insert({
      id: songId,
      title,
      artist: null,
      durationSec: null,
      contentHash: hash,
      source: { type: 'local-upload', originalFilename: basename(filePath) },
      features: emptyFeatures(),
      createdAt: now,
      separatedAt: null
    })
  }

  // Run in the background; progress streams to the renderer via push events.
  void runSeparationJob(sidecar, songId, originalDest, title)

  return { ok: true, songId, alreadyExists: false }
}

/**
 * Import a Spotify track: derive a stable id (dedup), then in the background
 * match it on YouTube, download the audio, and hand off to the same separation
 * pipeline as a local upload. Returns immediately; progress streams over the
 * `SeparationEvent` channel keyed by the returned `songId`.
 */
async function startSpotifyImport(
  sidecar: SidecarManager,
  track: SpotifyTrack
): Promise<StartSeparationResult> {
  const songId = songIdFromSpotify({ isrc: track.isrc, spotifyId: track.id })
  const existing = songs.get(songId)

  // Dedup: the same recording is never re-downloaded or re-separated.
  if (existing?.separatedAt) {
    return { ok: true, songId, alreadyExists: true }
  }

  void runSpotifyImportJob(sidecar, songId, track)
  return { ok: true, songId, alreadyExists: false }
}

async function runSpotifyImportJob(
  sidecar: SidecarManager,
  songId: string,
  track: SpotifyTrack
): Promise<void> {
  const title = track.name
  const artist = track.artists.join(', ') || null
  try {
    await mkdir(songDir(songId), { recursive: true })

    broadcast({
      type: 'progress',
      songId,
      stage: 'matching',
      progress: 0,
      message: 'Finding audio…'
    })
    const match = await matchYtTrack(track)
    if (!match) {
      throw new Error(`Couldn't find a matching source on YouTube for "${title}".`)
    }

    broadcast({
      type: 'progress',
      songId,
      stage: 'downloading',
      progress: 0,
      message: 'Downloading…'
    })
    const originalPath = await downloadYtAudio(match.youtubeId, songDir(songId), (progress) =>
      broadcast({ type: 'progress', songId, stage: 'downloading', progress })
    )

    // Record the song before separation so `project.json` carries the Spotify
    // source. (`runSeparationJob` reads the source back from storage.)
    if (!songs.get(songId)) {
      songs.insert({
        id: songId,
        title,
        artist,
        durationSec: track.durationSec,
        contentHash: null,
        source: {
          type: 'spotify',
          spotifyId: track.id,
          isrc: track.isrc,
          youtubeId: match.youtubeId
        },
        features: emptyFeatures(),
        createdAt: new Date().toISOString(),
        separatedAt: null
      })
    }

    await runSeparationJob(sidecar, songId, originalPath, title)
  } catch (err) {
    broadcast({ type: 'error', songId, message: (err as Error).message })
  }
}

/**
 * Import a directly-searched YouTube result: derive a stable id (dedup), then in
 * the background download the audio and hand off to the same separation pipeline
 * as a local upload. Returns immediately; progress streams over the
 * `SeparationEvent` channel keyed by the returned `songId`.
 */
async function startYoutubeImport(
  sidecar: SidecarManager,
  video: YtCandidate
): Promise<StartSeparationResult> {
  if (!video?.id) throw new Error('No video selected.')
  const songId = songIdFromYoutube(video.id)
  const existing = songs.get(songId)

  // Dedup: the same video is never re-downloaded or re-separated.
  if (existing?.separatedAt) {
    return { ok: true, songId, alreadyExists: true }
  }

  void runYoutubeImportJob(sidecar, songId, video)
  return { ok: true, songId, alreadyExists: false }
}

async function runYoutubeImportJob(
  sidecar: SidecarManager,
  songId: string,
  video: YtCandidate
): Promise<void> {
  // Clean the noisy video title into a proper title/artist for the library + lyrics.
  const { title, artist } = parseTrackFromYouTube(video.title, video.channel)
  try {
    await mkdir(songDir(songId), { recursive: true })

    broadcast({
      type: 'progress',
      songId,
      stage: 'downloading',
      progress: 0,
      message: 'Downloading…'
    })
    const originalPath = await downloadYtAudio(video.id, songDir(songId), (progress) =>
      broadcast({ type: 'progress', songId, stage: 'downloading', progress })
    )

    if (!songs.get(songId)) {
      songs.insert({
        id: songId,
        title,
        artist,
        durationSec: video.durationSec,
        contentHash: null,
        source: { type: 'youtube', youtubeId: video.id, channel: video.channel },
        features: emptyFeatures(),
        createdAt: new Date().toISOString(),
        separatedAt: null
      })
    }

    await runSeparationJob(sidecar, songId, originalPath, title)
  } catch (err) {
    broadcast({ type: 'error', songId, message: (err as Error).message })
  }
}

/** Synced lyrics for a song: cached `lyrics.json`, else fetched from LRCLIB. */
async function getLyrics(songId: string): Promise<Lyrics | null> {
  try {
    return JSON.parse(await readFile(lyricsPath(songId), 'utf8')) as Lyrics
  } catch {
    // Not cached yet — fetch from the song's metadata.
  }
  const song = songs.get(songId)
  if (!song) return null
  const lyrics = await fetchLyrics({
    title: song.title,
    artist: song.artist,
    durationSec: song.durationSec
  })
  if (lyrics) {
    await writeFile(lyricsPath(songId), JSON.stringify(lyrics), 'utf8').catch(() => {})
  }
  return lyrics
}

async function runSeparationJob(
  sidecar: SidecarManager,
  songId: string,
  inputPath: string,
  title: string
): Promise<void> {
  try {
    await sidecar.start()

    const done = await sidecar.runSeparation(
      {
        jobId: songId,
        inputPath,
        outputDir: songDir(songId),
        model: 'htdemucs_6s',
        device: 'auto',
        detectFeatures: true
      },
      (event) => {
        if (event.event === 'progress') {
          broadcast({
            type: 'progress',
            songId,
            stage: event.stage,
            progress: event.progress,
            message: event.message
          })
        } else if (event.event === 'stem') {
          broadcast({ type: 'stem', songId, kind: event.kind, path: event.path })
        }
      }
    )

    const now = new Date().toISOString()
    songs.markSeparated(songId, done.features, done.durationSec, now)

    const song = songs.get(songId)
    const project = createProjectFile({
      songId,
      title,
      source: song?.source ?? { type: 'local-upload', originalFilename: title },
      features: done.features,
      updatedAt: now
    })
    await writeFile(projectPath(songId), JSON.stringify(project, null, 2), 'utf8')

    broadcast({ type: 'done', songId })
  } catch (err) {
    broadcast({ type: 'error', songId, message: (err as Error).message })
  }
}

async function loadProject(songId: string): Promise<LoadedProject | null> {
  try {
    const raw = await readFile(projectPath(songId), 'utf8')
    const project = JSON.parse(raw) as ProjectFile
    const stems = STEM_KINDS.filter((kind) => existsSync(stemPath(songId, kind)))
    return { project, stems }
  } catch {
    return null
  }
}

/** Merge the editable subset of a project back onto disk. No-op if missing. */
async function saveProject(songId: string, patch: ProjectPatch): Promise<void> {
  let project: ProjectFile
  try {
    project = JSON.parse(await readFile(projectPath(songId), 'utf8')) as ProjectFile
  } catch {
    return // project.json not written yet (e.g. separation still running)
  }
  const next: ProjectFile = {
    ...project,
    ...(patch.mixer ? { mixer: patch.mixer } : {}),
    ...(patch.tempoKey ? { tempoKey: patch.tempoKey } : {}),
    ...(patch.loops ? { loops: patch.loops } : {}),
    ...(patch.beatGridOffsetSec !== undefined
      ? { beatGridOffsetSec: patch.beatGridOffsetSec }
      : {}),
    updatedAt: new Date().toISOString()
  }
  await writeFile(projectPath(songId), JSON.stringify(next, null, 2), 'utf8')
}

function broadcast(event: SeparationEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannel.SeparationEvent, event)
  }
}
