/**
 * Shared export vocabulary (see DECISIONS.md → Export). The actual WYSIWYG
 * render happens in the renderer (`OfflineAudioContext` through the same graph);
 * ffmpeg in the main process is a thin encoding layer only. This module holds
 * the enums, labels, and filename helpers all three processes agree on.
 */
import type { StemKind } from "./stems.js";

/** Container / codec the user picks. */
export const EXPORT_FORMATS = ["wav", "flac", "mp3"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_EXT: Record<ExportFormat, string> = {
  wav: "wav",
  flac: "flac",
  mp3: "mp3",
};

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  wav: "WAV",
  flac: "FLAC",
  mp3: "MP3",
};

/** Lossless formats carry a PCM bit depth; MP3 carries a bitrate instead. */
export function isLossless(format: ExportFormat): boolean {
  return format === "wav" || format === "flac";
}

export type BitDepth = 16 | 24;
export const BIT_DEPTHS: readonly BitDepth[] = [16, 24];

export const MP3_BITRATES = [320, 256, 192, 128] as const;
export type Mp3Bitrate = (typeof MP3_BITRATES)[number];

/**
 * What to bake into a single output file.
 *  - `stems`      — each selected stem as its own file (isolated instrument).
 *  - `mixdown`    — sum of the selected stems at their mixer gains.
 *  - `minus-one`  — the full mix minus one stem (instant backing track).
 *  - `click`      — a synthesized metronome click track locked to the beat grid.
 */
export const EXPORT_MODES = ["stems", "mixdown", "minus-one", "click"] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];

export const MODE_LABEL: Record<ExportMode, string> = {
  stems: "Separate stems",
  mixdown: "Custom mixdown",
  "minus-one": "Minus one",
  click: "Click track",
};

/** Whole-song time-stretch / pitch-shift settings the export can bake in. */
export interface ExportEncodeSettings {
  format: ExportFormat;
  /** PCM depth for wav/flac; ignored for mp3. */
  bitDepth: BitDepth;
  /** kbps for mp3; ignored for lossless. */
  mp3Bitrate: Mp3Bitrate;
}

export function defaultEncodeSettings(): ExportEncodeSettings {
  return { format: "wav", bitDepth: 24, mp3Bitrate: 320 };
}

/** ffmpeg codec/format args for an encode setting (validated against ffmpeg 8). */
export function ffmpegCodecArgs(s: ExportEncodeSettings): string[] {
  switch (s.format) {
    case "wav":
      return ["-c:a", s.bitDepth === 24 ? "pcm_s24le" : "pcm_s16le"];
    case "flac":
      // s32 input yields a 24-bit FLAC; s16 yields 16-bit.
      return ["-c:a", "flac", "-sample_fmt", s.bitDepth === 24 ? "s32" : "s16"];
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", `${s.mp3Bitrate}k`];
  }
}

/** Strip characters that are illegal or awkward in filenames across OSes. */
export function safeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "-") // reserved on Windows
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "") // no leading dots (hidden / traversal)
      .trim()
      .slice(0, 120) || "export"
  );
}

/** `<title> - <suffix>.<ext>`, sanitized. `suffix` names the stem/mode. */
export function exportFileName(
  title: string,
  suffix: string,
  format: ExportFormat,
): string {
  return `${safeFilename(`${title} - ${suffix}`)}.${FORMAT_EXT[format]}`;
}

/** A single stem's contribution to a render (linear gain, 1 = unity). */
export interface StemContribution {
  kind: StemKind;
  gain: number;
}
