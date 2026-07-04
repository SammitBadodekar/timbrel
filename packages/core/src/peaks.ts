/**
 * Cached waveform peaks (`peaks.json`). Computed once from the decoded stems and
 * reused on every studio open so waveforms render instantly (see DECISIONS.md →
 * Storage). Pure and framework-agnostic: the math takes raw channel data, so it
 * runs the same in the renderer (from a Web Audio `AudioBuffer`) or, later, in a
 * worker.
 */
import type { StemKind } from "./stems.js";

/**
 * Number of buckets per stem. Resolution-independent: the renderer downsamples
 * these to the actual canvas width, so peaks stay crisp at any lane size without
 * re-decoding. ~2000 keeps `peaks.json` small (tens of KB for six stems).
 */
export const PEAK_BUCKETS = 2000;

export interface PeaksFile {
  version: 1;
  /** Buckets per stem (mirror of `PEAK_BUCKETS` at write time). */
  buckets: number;
  durationSec: number;
  /** kind → per-bucket peak amplitude in 0..1. */
  stems: Partial<Record<StemKind, number[]>>;
}

/**
 * Downsample interleaved channel data to `buckets` peak amplitudes (0..1).
 * Each bucket is the max absolute sample across all channels in that window —
 * a mono envelope suitable for a mirrored waveform. Amplitudes are left raw
 * (not normalised), so a quiet stem reads as a quiet waveform.
 */
export function computePeaks(
  channels: Float32Array[],
  buckets: number = PEAK_BUCKETS,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (channels.length === 0) return out;

  const frames = channels[0]?.length ?? 0;
  if (frames === 0) return out;

  const step = frames / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step);
    const end = b === buckets - 1 ? frames : Math.floor((b + 1) * step);
    let peak = 0;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i];
        if (v === undefined) continue;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }
    out[b] = peak > 1 ? 1 : Math.round(peak * 1000) / 1000;
  }
  return out;
}
