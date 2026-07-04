/**
 * Imperative multitrack playback engine — deliberately outside React.
 *
 * Graph: each stem → its own GainNode (volume / mute / solo) → a summed master
 * bus → destination. Buffers are decoded once; playback uses one-shot
 * AudioBufferSourceNodes recreated on every play/seek. The playhead is derived
 * from `AudioContext.currentTime` so it stays sample-accurate without React.
 *
 * (v0.2 will insert a single SoundTouch WASM node on the master bus for global
 * real-time tempo/key — see DECISIONS.md → Studio.)
 */
import type { StemKind } from '@timbrel/core'

export interface StemControls {
  gain: number
  muted: boolean
  soloed: boolean
}

export class StudioEngine {
  private readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly buffers = new Map<StemKind, AudioBuffer>()
  private readonly gains = new Map<StemKind, GainNode>()
  private readonly sources = new Map<StemKind, AudioBufferSourceNode>()
  private readonly controls = new Map<StemKind, StemControls>()

  private startedAtCtxTime = 0
  private offsetSec = 0
  private playing = false

  duration = 0

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
  }

  /** Decode every stem from its FLAC bytes and build its gain node. */
  async loadStems(buffers: Partial<Record<StemKind, ArrayBuffer>>): Promise<StemKind[]> {
    const entries = Object.entries(buffers) as [StemKind, ArrayBuffer][]
    await Promise.all(
      entries.map(async ([kind, bytes]) => {
        const buffer = await this.ctx.decodeAudioData(bytes)
        const gain = this.ctx.createGain()
        gain.connect(this.master)
        this.buffers.set(kind, buffer)
        this.gains.set(kind, gain)
        this.controls.set(kind, { gain: 1, muted: false, soloed: false })
        this.duration = Math.max(this.duration, buffer.duration)
      })
    )
    this.applyMix()
    return [...this.buffers.keys()]
  }

  private applyMix(): void {
    const anySolo = [...this.controls.values()].some((c) => c.soloed)
    for (const [kind, gainNode] of this.gains) {
      const c = this.controls.get(kind)!
      const audible = anySolo ? c.soloed : !c.muted
      gainNode.gain.value = audible ? c.gain : 0
    }
  }

  getControls(kind: StemKind): StemControls {
    return this.controls.get(kind) ?? { gain: 1, muted: false, soloed: false }
  }

  setGain(kind: StemKind, value: number): void {
    const c = this.controls.get(kind)
    if (!c) return
    c.gain = value
    this.applyMix()
  }

  toggleMute(kind: StemKind): boolean {
    const c = this.controls.get(kind)
    if (!c) return false
    c.muted = !c.muted
    this.applyMix()
    return c.muted
  }

  toggleSolo(kind: StemKind): boolean {
    const c = this.controls.get(kind)
    if (!c) return false
    c.soloed = !c.soloed
    this.applyMix()
    return c.soloed
  }

  async play(): Promise<void> {
    if (this.playing) return
    await this.ctx.resume()
    let from = this.offsetSec
    if (from >= this.duration) from = 0
    this.startSources(from)
    this.playing = true
  }

  pause(): void {
    if (!this.playing) return
    this.offsetSec = this.currentTime
    this.stopSources()
    this.playing = false
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.duration))
    this.offsetSec = clamped
    if (this.playing) this.startSources(clamped)
  }

  get currentTime(): number {
    if (!this.playing) return this.offsetSec
    const elapsed = this.ctx.currentTime - this.startedAtCtxTime
    return Math.min(this.duration, this.offsetSec + elapsed)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** Called by the RAF loop when playback runs off the end. */
  handleEnded(): void {
    this.stopSources()
    this.playing = false
    this.offsetSec = 0
  }

  dispose(): void {
    this.stopSources()
    void this.ctx.close()
  }

  private startSources(fromOffset: number): void {
    this.stopSources()
    const when = this.ctx.currentTime
    for (const [kind, buffer] of this.buffers) {
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.gains.get(kind)!)
      source.start(when, fromOffset)
      this.sources.set(kind, source)
    }
    this.startedAtCtxTime = when
    this.offsetSec = fromOffset
  }

  private stopSources(): void {
    for (const source of this.sources.values()) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
      source.disconnect()
    }
    this.sources.clear()
  }
}
