import type { StemKind } from "./stems.js";
import { STEM_KINDS } from "./stems.js";
import type { AudioSource, DetectedFeatures } from "./song.js";
import { emptyFeatures } from "./song.js";

/** Mixer state for a single stem. `gain` is linear 0..1 for a Web Audio GainNode. */
export interface StemMix {
  gain: number;
  muted: boolean;
  soloed: boolean;
}

export type MixerState = Record<StemKind, StemMix>;

/** Global time-stretch / pitch-shift, applied once on the master bus. */
export interface TempoKeyState {
  /** Playback rate; 1 = original tempo. */
  tempoRatio: number;
  /** Pitch shift in semitones; 0 = original key. */
  semitones: number;
}

export interface LoopRegion {
  id: string;
  startSec: number;
  endSec: number;
  enabled: boolean;
}

/**
 * `project.json` — the per-song editable studio state saved alongside the
 * stems. Everything the user can tweak that must survive a reload.
 */
export interface ProjectFile {
  version: 1;
  songId: string;
  title: string;
  artist: string | null;
  source: AudioSource;
  features: DetectedFeatures;
  mixer: MixerState;
  tempoKey: TempoKeyState;
  loops: LoopRegion[];
  /** Manual beat-grid nudge in seconds (auto downbeat detection is imperfect). */
  beatGridOffsetSec: number;
  /** ISO-8601. */
  updatedAt: string;
}

export function defaultStemMix(): StemMix {
  return { gain: 1, muted: false, soloed: false };
}

export function defaultMixerState(): MixerState {
  return Object.fromEntries(
    STEM_KINDS.map((k) => [k, defaultStemMix()]),
  ) as MixerState;
}

export interface NewProjectInput {
  songId: string;
  title: string;
  artist?: string | null;
  source: AudioSource;
  features?: DetectedFeatures;
  updatedAt: string;
}

export function createProjectFile(input: NewProjectInput): ProjectFile {
  return {
    version: 1,
    songId: input.songId,
    title: input.title,
    artist: input.artist ?? null,
    source: input.source,
    features: input.features ?? emptyFeatures(),
    mixer: defaultMixerState(),
    tempoKey: { tempoRatio: 1, semitones: 0 },
    loops: [],
    beatGridOffsetSec: 0,
    updatedAt: input.updatedAt,
  };
}
