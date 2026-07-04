/**
 * On-disk library layout (see DECISIONS.md → Storage). Pure and
 * framework-agnostic: this module only knows the *names* inside a song folder.
 * The Electron main process joins these against the (user-configurable)
 * library root using Node's `path`.
 *
 *   <library>/<song-id>/
 *     original.<ext>        source audio (or a pointer for local files)
 *     stems/<kind>.flac     the six separated stems
 *     project.json          editable studio state
 *     peaks.json            cached waveform peaks
 *     lyrics.json           cached synced lyrics (LRCLIB)
 */
import type { StemKind } from "./stems.js";
import { STEM_KINDS } from "./stems.js";

export const STEMS_DIR = "stems";
export const STEM_EXT = "flac";
export const ORIGINAL_BASENAME = "original";
export const PROJECT_FILE = "project.json";
export const PEAKS_FILE = "peaks.json";
export const LYRICS_FILE = "lyrics.json";

export function stemFilename(kind: StemKind): string {
  return `${kind}.${STEM_EXT}`;
}

export function originalFilename(ext: string): string {
  return `${ORIGINAL_BASENAME}.${normalizeExt(ext)}`;
}

function normalizeExt(ext: string): string {
  return ext.replace(/^\./, "").toLowerCase();
}

/**
 * Relative paths (POSIX-style, from the song folder root) for every artifact
 * of a song. The main process resolves these against `<library>/<song-id>`.
 */
export interface SongLayout {
  stemsDir: string;
  project: string;
  peaks: string;
  original: (ext: string) => string;
  stem: (kind: StemKind) => string;
  allStems: () => Record<StemKind, string>;
}

export function songLayout(): SongLayout {
  return {
    stemsDir: STEMS_DIR,
    project: PROJECT_FILE,
    peaks: PEAKS_FILE,
    original: (ext) => originalFilename(ext),
    stem: (kind) => `${STEMS_DIR}/${stemFilename(kind)}`,
    allStems: () =>
      Object.fromEntries(
        STEM_KINDS.map((k) => [k, `${STEMS_DIR}/${stemFilename(k)}`]),
      ) as Record<StemKind, string>,
  };
}
