/**
 * Small music-theory helpers. The sidecar reports keys sharp-spelled and
 * lowercase-moded (e.g. "A# minor", "D major"); these stay in that convention.
 */

const SHARP_PITCHES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/**
 * Transpose a detected key by a number of semitones, preserving the mode.
 * Returns the input unchanged if it can't be parsed, and `null` for `null`
 * (so it composes with `DetectedFeatures.key`). Used to show the resulting key
 * name when the studio pitch-shifts the whole mix.
 */
export function transposeKey(
  key: string | null,
  semitones: number,
): string | null {
  if (!key) return null;
  if (!Number.isFinite(semitones) || semitones === 0) return key;

  const match = key.trim().match(/^([A-G]#?)\s+(major|minor)$/i);
  const root = match?.[1];
  const mode = match?.[2];
  if (!root || !mode) return key;

  const index = SHARP_PITCHES.indexOf(
    root.toUpperCase() as (typeof SHARP_PITCHES)[number],
  );
  if (index < 0) return key;

  const shifted = (((index + semitones) % 12) + 12) % 12;
  return `${SHARP_PITCHES[shifted]} ${mode.toLowerCase()}`;
}
