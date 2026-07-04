/** Resolves the on-disk library layout (see DECISIONS.md → Storage). */
import { app } from 'electron'
import { join } from 'node:path'
import {
  PROJECT_FILE,
  PEAKS_FILE,
  STEMS_DIR,
  stemFilename,
  type StemKind
} from '@timbrel/core'

let overrideRoot: string | null = null

/** The library root. Default lives in app-data; user-configurable (v0.4). */
export function libraryRoot(): string {
  return overrideRoot ?? join(app.getPath('userData'), 'Library')
}

export function setLibraryRoot(dir: string): void {
  overrideRoot = dir
}

export function songDir(songId: string): string {
  return join(libraryRoot(), songId)
}

export function stemsDir(songId: string): string {
  return join(songDir(songId), STEMS_DIR)
}

export function stemPath(songId: string, kind: StemKind): string {
  return join(stemsDir(songId), stemFilename(kind))
}

export function projectPath(songId: string): string {
  return join(songDir(songId), PROJECT_FILE)
}

export function peaksPath(songId: string): string {
  return join(songDir(songId), PEAKS_FILE)
}
