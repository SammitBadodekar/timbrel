import type { WizLightCommand } from '@shared/ipc'

export interface AudioEnergy {
  level: number
  bass: number
  mid: number
  treble: number
  /** Positive bass onset, used as a short beat flash. */
  pulse: number
  /** Pulse from Timbrel's detected beat grid, synchronized to transport time. */
  beat: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

/** Map the live spectrum to a saturated concert palette. Bass drives punch and
 * brightness, mids/treble steer the hue, and bulbs are phase-offset so a room
 * reads as one coordinated show instead of one flat color. */
export function concertLightFrame(
  energy: AudioEnergy,
  bulbIndex: number,
  elapsedMs: number
): WizLightCommand {
  const level = clamp01(energy.level)
  const bass = clamp01(energy.bass)
  const mid = clamp01(energy.mid)
  const treble = clamp01(energy.treble)
  const pulse = clamp01(energy.pulse)
  const beat = clamp01(energy.beat)
  const spectralTotal = bass + mid + treble + 0.001
  const spectralHue = (bass * 342 + mid * 214 + treble * 54) / spectralTotal
  const drift = (elapsedMs / 1_000) * (8 + level * 22)
  const hue = (spectralHue + drift + bulbIndex * 47) % 360
  const saturation = 0.8 + treble * 0.18
  const rgb = hsvToRgb(hue, saturation, 1)

  // The beat grid is an explicit full-brightness flash. Between beats, actual
  // waveform loudness supplies the main envelope while each frequency band
  // contributes enough movement for the brightness to visibly breathe.
  let dimming: number
  if (beat >= 0.5 || pulse >= 0.72) {
    dimming = 100
  } else if (level < 0.025) {
    // A real silence floor: never black out completely, but stay at 1–5%.
    dimming = Math.max(1, Math.round((level / 0.025) * 5))
  } else {
    const loudness = Math.pow(level, 0.72) * 68
    const frequency = bass * 16 + mid * 9 + treble * 12
    const contrast = (Math.max(bass, mid, treble) - Math.min(bass, mid, treble)) * 12
    dimming = Math.round(Math.min(98, 2 + loudness + frequency + contrast + pulse * 24))
  }

  return { state: true, ...rgb, dimming }
}

function hsvToRgb(hue: number, saturation: number, value: number): Rgb {
  const c = value * saturation
  const h = hue / 60
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r1, g1, b1] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = value - c
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255)
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
