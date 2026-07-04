/**
 * The six stems produced by Demucs `htdemucs_6s`. Order is the canonical
 * display order across the whole app (mixer rows, export lists, waveforms).
 */
export const STEM_KINDS = [
  "vocals",
  "drums",
  "bass",
  "guitar",
  "piano",
  "other",
] as const;

export type StemKind = (typeof STEM_KINDS)[number];

export function isStemKind(value: string): value is StemKind {
  return (STEM_KINDS as readonly string[]).includes(value);
}

/** Human-facing labels. */
export const STEM_LABELS: Record<StemKind, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  piano: "Piano",
  other: "Other",
};

/**
 * Per-stem accent colors for the studio's color-coding. Tuned for a
 * dark-first, pro-audio surface; adjust alongside the design pass (v0.4).
 */
export const STEM_COLORS: Record<StemKind, string> = {
  vocals: "#ff5c7a",
  drums: "#ffab3d",
  bass: "#8b7bff",
  guitar: "#33d69f",
  piano: "#4db8ff",
  other: "#9aa0aa",
};
