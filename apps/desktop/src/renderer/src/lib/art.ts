/**
 * Deterministic cover art for songs and playlists. We don't persist real
 * artwork (thumbnails are only known at search time, and local uploads have
 * none), so every song gets a stable pastel-gradient monogram derived from its
 * id — collectible-feeling, consistent between the shelf, rows and covers.
 */

/** Wash-pair gradients, drawn from the DESIGN.md pastel palette. */
const GRADIENTS = [
  ['#fff2be', '#ffd1b8'], // solar → peach
  ['#cce7ff', '#c2e9ff'], // powder → aqua
  ['#f1e6ff', '#e4ccff'], // lavender → violet
  ['#d3f6e3', '#b8f0d2'], // mint
  ['#fde3ea', '#ffd7e2'], // rose
  ['#feefd6', '#fff2be'], // amber → solar
  ['#cce7ff', '#d3f6e3'], // powder → mint
  ['#f1e6ff', '#cce7ff'] // lavender → powder
] as const

/** Small, stable string hash (FNV-1a) → non-negative int. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A CSS `linear-gradient(...)` chosen deterministically from a seed (song id). */
export function gradientFor(seed: string): string {
  const [a, b] = GRADIENTS[hash(seed) % GRADIENTS.length]!
  return `linear-gradient(135deg, ${a}, ${b})`
}

/** The single-letter monogram for a title (first alphanumeric, uppercased). */
export function monogram(title: string): string {
  const m = title.match(/[a-z0-9]/i)
  return (m?.[0] ?? '♪').toUpperCase()
}
