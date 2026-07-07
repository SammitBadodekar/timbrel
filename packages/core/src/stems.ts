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
 * Per-stem accent colors for the studio's color-coding. Recalibrated for the
 * light "Geniestudio" surface (v0.6 design pass): saturated enough to carry a
 * waveform on a pale ground, but not neon. The old violet lives on as `bass`.
 */
export const STEM_COLORS: Record<StemKind, string> = {
  vocals: "#e8446d",
  drums: "#e08a00",
  bass: "#7c5cff",
  guitar: "#0da678",
  piano: "#0d9bdc",
  other: "#8a919c",
};

/**
 * Per-stem pastel wash — the soft tint that pairs with each accent hue. Used as
 * chip / dot / hover-state backgrounds so a stem reads the same everywhere
 * (mixer, library chips, routing). Each is a desaturated cousin of its accent.
 */
export const STEM_WASH: Record<StemKind, string> = {
  vocals: "#fde3ea",
  drums: "#feefd6",
  bass: "#f1e6ff",
  guitar: "#d3f6e3",
  piano: "#cce7ff",
  other: "#eceef1",
};
