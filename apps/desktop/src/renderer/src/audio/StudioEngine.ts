/**
 * Imperative multitrack playback engine — deliberately outside React.
 *
 * Graph: each stem → its own GainNode (volume / mute / solo) → a summed master
 * bus → destination. Buffers are decoded once; playback uses one-shot
 * AudioBufferSourceNodes recreated on every play/seek. The playhead is derived
 * from `AudioContext.currentTime` so it stays sample-accurate without React.
 *
 * Global real-time tempo/key is a single SoundTouch (WASM AudioWorklet) node on
 * the master bus (DECISIONS.md → Studio): the summed mix flows through one
 * `SoundTouchNode`. Tempo is driven by mirroring `playbackRate` on every stem
 * source and the node (the processor auto-compensates the pitch); key is
 * `pitchSemitones`. The node is bypassed while neutral to avoid its latency.
 *
 * Loop regions wrap playback at the loop end (polled from the RAF via
 * `activeLoop`, re-using `seek`). The metronome is a lookahead scheduler that
 * synthesises clicks on `features.beatTimes` — mapped through the same clock as
 * the transport so it follows tempo and the grid nudge — routed straight to the
 * destination so it never gets time-stretched, muted, or soloed.
 */
import {
  computePeaks,
  ROUTABLE_CHANNELS,
  STEM_KINDS,
  SYSTEM_SINK_ID,
  type LoopRegion,
  type ResolvedRouting,
  type StemContribution,
  type StemKind
} from '@timbrel/core'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'

export interface StemControls {
  gain: number
  muted: boolean
  soloed: boolean
}

/** A physical output sink's terminal. The system output routes straight to
 *  `ctx.destination`; a specific device streams via a MediaStream piped into a
 *  hidden <audio> element pinned to the device with `setSinkId`. */
interface SinkOutput {
  dest: AudioNode
  msd: MediaStreamAudioDestinationNode | null
  audio: HTMLAudioElement | null
}

/** Per-sink stem submix. `stretch` exists only while tempo/key is non-neutral;
 *  the summed stems for a sink flow submix → (stretch?) → sink terminal. */
interface SinkSubmix {
  submix: GainNode
  stretch: SoundTouchNode | null
}

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

/** The initial routing before any rig is applied: every channel → the system
 *  sink, which wires up exactly like the original single-master graph. */
function defaultResolvedRouting(): ResolvedRouting {
  const out = {} as ResolvedRouting
  for (const ch of ROUTABLE_CHANNELS) out[ch] = { deviceIds: [SYSTEM_SINK_ID], silent: false }
  return out
}

/** One WYSIWYG export render: what to sum, and whether to bake tempo/key. */
export interface ExportRenderSpec {
  /** Stems to sum at these linear gains (empty for a pure click track). */
  stems: StemContribution[]
  /** Also mix in a synthesized metronome click track. */
  click?: boolean
  /** Bake the current tempo/key; when false, render at the original tempo/key. */
  bakeTempoKey: boolean
}

/** A short synthesised click on any context/destination (live bus or offline). */
function synthClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  accent: boolean
): OscillatorNode {
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.frequency.value = accent ? 1600 : 1000
  const peak = accent ? 0.7 : 0.4
  env.gain.setValueAtTime(0.0001, when)
  env.gain.exponentialRampToValueAtTime(peak, when + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  osc.connect(env)
  env.connect(dest)
  osc.start(when)
  osc.stop(when + 0.06)
  return osc
}

export class StudioEngine {
  private readonly ctx: AudioContext
  private readonly buffers = new Map<StemKind, AudioBuffer>()
  private readonly gains = new Map<StemKind, GainNode>()
  private readonly sources = new Map<StemKind, AudioBufferSourceNode>()
  private readonly controls = new Map<StemKind, StemControls>()

  private startedAtCtxTime = 0
  private offsetSec = 0
  private playing = false

  // --- Output routing (DECISIONS.md → Multi-device audio output routing) ------
  // The resolved per-channel sink mapping plus the live nodes realising it.
  // Stems bound to a sink sum into that sink's submix (through a per-sink
  // SoundTouch node when tempo/key is non-neutral); the click is always dry.
  // Default routing (every channel → the system sink) reproduces the original
  // single-master → destination graph exactly.
  private resolved: ResolvedRouting = defaultResolvedRouting()
  private readonly sinks = new Map<string, SinkOutput>()
  private readonly submixes = new Map<string, SinkSubmix>()
  private workletReady: Promise<void> | null = null
  private rebuildChain: Promise<void> = Promise.resolve()

  // Global tempo/key: mirrored onto every source's playbackRate and every
  // per-sink SoundTouch node (which compensates the pitch). 1 / 0 = neutral.
  private rate = 1
  private semitones = 0

  // Loop region (non-null only while an enabled loop is set).
  private loop: LoopRegion | null = null

  // Metronome — its own bus straight to the destination (never time-stretched,
  // muted, or soloed), driven by a lookahead scheduler over the beat times.
  private readonly clickBus: GainNode
  private metronomeOn = false
  private beatTimes: number[] = []
  private downbeatSet = new Set<number>()
  private gridOffset = 0
  private schedulerId: number | null = null
  /** Cursor into `beatTimes` for the click scheduler — beats are sorted, so
   *  each tick resumes where the last stopped instead of rescanning from 0.
   *  Reset to 0 on seek / tempo change / scheduler start. */
  private nextBeatIdx = 0
  private countInTimer: number | null = null
  private countInNodes: OscillatorNode[] = []
  private disposed = false
  private readonly LOOKAHEAD = 0.1 // schedule clicks this far ahead (s)
  private readonly SCHED_INTERVAL = 25 // scheduler poll period (ms)

  duration = 0

  constructor() {
    this.ctx = new AudioContext()
    this.clickBus = this.ctx.createGain()
    this.clickBus.gain.value = 0.9
    // The system sink is synchronous (dest = ctx.destination), so the click
    // works immediately — identical to the original clickBus → destination.
    this.clickBus.connect(this.ensureSink(SYSTEM_SINK_ID).dest)
  }

  /** Decode every stem from its FLAC bytes and build its gain node. */
  async loadStems(buffers: Partial<Record<StemKind, ArrayBuffer>>): Promise<StemKind[]> {
    const entries = Object.entries(buffers) as [StemKind, ArrayBuffer][]
    await Promise.all(
      entries.map(async ([kind, bytes]) => {
        const buffer = await this.ctx.decodeAudioData(bytes)
        const gain = this.ctx.createGain()
        this.buffers.set(kind, buffer)
        this.gains.set(kind, gain)
        this.controls.set(kind, { gain: 1, muted: false, soloed: false })
        this.duration = Math.max(this.duration, buffer.duration)
      })
    )
    this.applyMix()
    // Wire the freshly-created stem gains into the routing graph before the
    // caller (the store) starts playback.
    this.scheduleRebuild()
    await this.rebuildChain
    // Buffers decode in async race order; return them in the canonical
    // STEM_KINDS order so every song renders its lanes identically.
    return STEM_KINDS.filter((kind) => this.buffers.has(kind))
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

  /** Restore persisted mixer state (from `project.json`) onto loaded stems. */
  applyMixerState(mixer: Partial<Record<StemKind, StemControls>>): void {
    for (const kind of this.controls.keys()) {
      const m = mixer[kind]
      if (m) this.controls.set(kind, { gain: m.gain, muted: m.muted, soloed: m.soloed })
    }
    this.applyMix()
  }

  /** Downsample every decoded stem to peak envelopes for waveform rendering. */
  computeAllPeaks(buckets: number): Partial<Record<StemKind, number[]>> {
    const out: Partial<Record<StemKind, number[]>> = {}
    for (const [kind, buffer] of this.buffers) {
      const channels: Float32Array[] = []
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        channels.push(buffer.getChannelData(c))
      }
      out[kind] = computePeaks(channels, buckets)
    }
    return out
  }

  // --- Offline export (WYSIWYG) ---------------------------------------------

  /**
   * Render one export file through an `OfflineAudioContext` that mirrors the
   * live graph (DECISIONS.md → Export): selected stems → per-stem gains →
   * master → (SoundTouch when baking a non-neutral tempo/key) → destination,
   * so the output is bit-identical to what the user heard. Tempo is baked the
   * same way it plays — native `playbackRate` on every source and the node, the
   * processor compensating the pitch — and key via `pitchSemitones`. When the
   * tempo/key is neutral (or not baked) the stretch node is skipped entirely.
   *
   * A click track is synthesised fresh at the (tempo-scaled) beat times and
   * bypasses the stretch node, exactly like the live metronome's own bus.
   */
  async renderExport(spec: ExportRenderSpec): Promise<AudioBuffer> {
    const sampleRate = this.ctx.sampleRate
    const rate = spec.bakeTempoKey ? this.rate : 1
    const semis = spec.bakeTempoKey ? this.semitones : 0
    const stretch = rate !== 1 || semis !== 0

    // Longest contributing source, in samples at the render sample rate.
    let maxSamples = 0
    for (const { kind } of spec.stems) {
      const buffer = this.buffers.get(kind)
      if (buffer) maxSamples = Math.max(maxSamples, buffer.length)
    }
    if (spec.click) maxSamples = Math.max(maxSamples, Math.ceil(this.duration * sampleRate))
    if (maxSamples === 0) throw new Error('Nothing selected to export.')

    // Output is compressed by 1/rate; a short tail lets the stretch FIFO flush.
    const tail = stretch ? Math.ceil(sampleRate * 0.5) : 0
    const outLength = Math.ceil(maxSamples / rate) + tail
    const offline = new OfflineAudioContext(2, outLength, sampleRate)

    const master = offline.createGain()
    if (stretch) {
      await SoundTouchNode.register(offline, processorUrl)
      const node = new SoundTouchNode({ context: offline })
      node.playbackRate.value = rate
      node.pitchSemitones.value = semis
      master.connect(node)
      node.connect(offline.destination)
    } else {
      master.connect(offline.destination)
    }

    for (const { kind, gain } of spec.stems) {
      const buffer = this.buffers.get(kind)
      if (!buffer) continue
      const source = offline.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = rate
      const g = offline.createGain()
      g.gain.value = gain
      source.connect(g)
      g.connect(master)
      source.start(0)
    }

    if (spec.click) {
      const clickBus = offline.createGain()
      clickBus.gain.value = 0.9
      clickBus.connect(offline.destination)
      for (let i = 0; i < this.beatTimes.length; i++) {
        const songTime = this.beatTimes[i] + this.gridOffset
        if (songTime < 0) continue
        synthClick(offline, clickBus, songTime / rate, this.downbeatSet.has(this.beatTimes[i]))
      }
    }

    return offline.startRendering()
  }

  /** Interleave an AudioBuffer's channels into f32le PCM for the ffmpeg pipe. */
  static toInterleavedPCM(buffer: AudioBuffer): Float32Array {
    const channels = buffer.numberOfChannels
    const length = buffer.length
    const out = new Float32Array(length * channels)
    const data: Float32Array[] = []
    for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c))
    for (let i = 0; i < length; i++) {
      const base = i * channels
      for (let c = 0; c < channels; c++) out[base + c] = data[c][i]
    }
    return out
  }

  // --- Global tempo / key ---------------------------------------------------

  get tempoRatio(): number {
    return this.rate
  }

  get semitoneShift(): number {
    return this.semitones
  }

  /** Restore persisted tempo/key (from `project.json`). */
  applyTempoKey(state: { tempoRatio: number; semitones: number }): void {
    this.setTempo(state.tempoRatio)
    this.setSemitones(state.semitones)
  }

  /** Change global tempo (1 = original). Smooth: live sources keep playing. */
  setTempo(ratio: number): void {
    const clamped = Math.min(1.5, Math.max(0.5, ratio))
    if (clamped === this.rate) return
    // Rebase the time origin at the current song position *before* the rate
    // changes, so `currentTime` stays continuous across the tempo change.
    if (this.playing) {
      this.offsetSec = this.currentTime
      this.startedAtCtxTime = this.ctx.currentTime
    }
    const wasActive = this.rate !== 1 || this.semitones !== 0
    this.rate = clamped
    for (const source of this.sources.values()) {
      source.playbackRate.value = clamped
    }
    for (const sm of this.submixes.values()) {
      if (sm.stretch) sm.stretch.playbackRate.value = clamped
    }
    // Upcoming beats must be re-timed for the new rate (already-scheduled
    // clicks in the ~100 ms window keep their old timing — negligible drift).
    this.nextBeatIdx = 0
    // Crossing the neutral boundary adds/removes the per-sink stretch nodes.
    if ((this.rate !== 1 || this.semitones !== 0) !== wasActive) this.scheduleRebuild()
  }

  /** Change global key by whole semitones (0 = original). */
  setSemitones(semitones: number): void {
    const clamped = Math.round(Math.min(12, Math.max(-12, semitones)))
    if (clamped === this.semitones) return
    const wasActive = this.rate !== 1 || this.semitones !== 0
    this.semitones = clamped
    for (const sm of this.submixes.values()) {
      if (sm.stretch) sm.stretch.pitchSemitones.value = clamped
    }
    if ((this.rate !== 1 || this.semitones !== 0) !== wasActive) this.scheduleRebuild()
  }

  // --- Output routing -------------------------------------------------------

  /**
   * Apply a resolved routing (from core's `resolveRouting`) — which channels
   * play out of which sinks. Serialised through `rebuildChain` so a burst of rig
   * or device changes can't interleave graph edits.
   */
  setRouting(resolved: ResolvedRouting): void {
    this.resolved = resolved
    this.scheduleRebuild()
  }

  private scheduleRebuild(): void {
    this.rebuildChain = this.rebuildChain.then(() => this.rebuildRoutingGraph()).catch(() => {})
  }

  /** A sink's terminal: `ctx.destination` for the system output; otherwise a
   *  MediaStream piped to an <audio> element pinned to the device. */
  private ensureSink(id: string): SinkOutput {
    const existing = this.sinks.get(id)
    if (existing) return existing
    let sink: SinkOutput
    if (id === SYSTEM_SINK_ID) {
      sink = { dest: this.ctx.destination, msd: null, audio: null }
    } else {
      const msd = this.ctx.createMediaStreamDestination()
      const audio = new Audio() as SinkAudio
      audio.srcObject = msd.stream
      // Pin to the device, then start pulling the stream. Best-effort: a vanished
      // device or a blocked autoplay is retried on the next play().
      void (audio.setSinkId?.(id) ?? Promise.resolve()).then(() => audio.play()).catch(() => {})
      sink = { dest: msd, msd, audio }
    }
    this.sinks.set(id, sink)
    return sink
  }

  private ensureSubmix(id: string): SinkSubmix {
    const existing = this.submixes.get(id)
    if (existing) return existing
    const sm: SinkSubmix = { submix: this.ctx.createGain(), stretch: null }
    this.submixes.set(id, sm)
    return sm
  }

  /** Lazily create + register this submix's SoundTouch node, mirroring the
   *  current tempo/key onto it. */
  private async ensureStretch(sm: SinkSubmix): Promise<SoundTouchNode> {
    if (!this.workletReady) {
      this.workletReady = SoundTouchNode.register(this.ctx, processorUrl)
    }
    await this.workletReady
    if (!sm.stretch) sm.stretch = new SoundTouchNode({ context: this.ctx })
    sm.stretch.playbackRate.value = this.rate
    sm.stretch.pitchSemitones.value = this.semitones
    return sm.stretch
  }

  /**
   * Rebuild the routing graph from `this.resolved`: (re)wire every stem gain to
   * the submix of each sink it targets, sum each sink's stems through a per-sink
   * SoundTouch node while tempo/key is non-neutral, route the (dry) click bus to
   * its sinks, and tear down anything no longer in use. Idempotent — runs for a
   * rig change, a device (dis)connect, or a tempo neutral↔active flip.
   */
  private async rebuildRoutingGraph(): Promise<void> {
    if (this.disposed) return
    const active = this.rate !== 1 || this.semitones !== 0

    const stemSinks = new Set<string>()
    for (const kind of this.gains.keys()) {
      const r = this.resolved[kind]
      if (r && !r.silent) for (const id of r.deviceIds) stemSinks.add(id)
    }
    const clickRoute = this.resolved.click
    const clickSinks =
      clickRoute && !clickRoute.silent ? new Set(clickRoute.deviceIds) : new Set<string>()
    const allSinks = new Set<string>([...stemSinks, ...clickSinks])

    // Terminals first (async setSinkId for device sinks).
    for (const id of allSinks) this.ensureSink(id)

    // Per-sink stem submix → (stretch when active) → terminal.
    for (const id of stemSinks) {
      const sm = this.ensureSubmix(id)
      sm.submix.disconnect()
      if (active) {
        const node = await this.ensureStretch(sm)
        if (this.disposed) return
        node.disconnect()
        node.connect(this.ensureSink(id).dest)
        sm.submix.connect(node)
      } else {
        sm.stretch?.disconnect()
        sm.submix.connect(this.ensureSink(id).dest)
      }
    }

    // Stem gains → their sinks' submixes (nothing when silenced).
    for (const [kind, gain] of this.gains) {
      gain.disconnect()
      const r = this.resolved[kind]
      if (r && !r.silent) for (const id of r.deviceIds) gain.connect(this.ensureSubmix(id).submix)
    }

    // Click bus → its sinks' terminals (always dry — never time-stretched).
    this.clickBus.disconnect()
    for (const id of clickSinks) this.clickBus.connect(this.ensureSink(id).dest)

    // Drop submixes / sinks that fell out of use (the system sink always stays).
    for (const [id, sm] of [...this.submixes]) {
      if (!stemSinks.has(id)) {
        sm.submix.disconnect()
        sm.stretch?.disconnect()
        this.submixes.delete(id)
      }
    }
    for (const [id, sink] of [...this.sinks]) {
      if (id === SYSTEM_SINK_ID || allSinks.has(id)) continue
      sink.msd?.disconnect()
      if (sink.audio) {
        sink.audio.pause()
        sink.audio.srcObject = null
      }
      this.sinks.delete(id)
    }
  }

  // --- Loop region ----------------------------------------------------------

  /** Set the active loop, or null to disable. Studio passes the enabled one. */
  setLoop(loop: LoopRegion | null): void {
    this.loop = loop && loop.endSec > loop.startSec ? loop : null
  }

  get activeLoop(): LoopRegion | null {
    return this.loop
  }

  // --- Metronome ------------------------------------------------------------

  /** Feed the click scheduler the detected beats + the manual grid nudge. */
  setBeats(beatTimes: number[], downbeatTimes: number[], gridOffset: number): void {
    this.beatTimes = beatTimes
    this.downbeatSet = new Set(downbeatTimes)
    this.gridOffset = gridOffset
  }

  get metronomeEnabled(): boolean {
    return this.metronomeOn
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on
    if (on && this.playing) this.startScheduler()
    else if (!on) this.stopScheduler()
  }

  private startScheduler(): void {
    if (this.schedulerId != null) return
    this.nextBeatIdx = 0
    this.schedulerId = window.setInterval(() => this.scheduleClicks(), this.SCHED_INTERVAL)
  }

  private stopScheduler(): void {
    if (this.schedulerId == null) return
    window.clearInterval(this.schedulerId)
    this.schedulerId = null
  }

  /**
   * Lookahead scheduler: each tick, queue every beat whose wall-clock time falls
   * in the next `LOOKAHEAD` window. Beat song-time `t + gridOffset` maps to
   * wall-clock via the transport clock (`startedAtCtxTime`/`offsetSec`/`rate`),
   * so clicks track tempo and the nudge. `nextBeatIdx` (reset on any
   * seek/tempo change) prevents double-scheduling as the window advances.
   */
  private scheduleClicks(): void {
    if (!this.metronomeOn || !this.playing) return
    const now = this.ctx.currentTime
    const windowEnd = now + this.LOOKAHEAD
    // Never click at/after the loop end — playback wraps there.
    const limit = this.loop ? this.loop.endSec : this.duration
    while (this.nextBeatIdx < this.beatTimes.length) {
      const beat = this.beatTimes[this.nextBeatIdx]
      const songTime = beat + this.gridOffset
      if (songTime >= limit) return
      const at = this.startedAtCtxTime + (songTime - this.offsetSec) / this.rate
      if (at > windowEnd) return // beats are sorted — nothing else is in range
      this.nextBeatIdx++
      if (at < now) continue // already elapsed — skip, but don't revisit
      this.click(at, this.downbeatSet.has(beat))
    }
  }

  /** A short synthesised click on the live bus; downbeats ring higher + louder. */
  private click(when: number, accent: boolean): OscillatorNode {
    return synthClick(this.ctx, this.clickBus, when, accent)
  }

  get isCountingIn(): boolean {
    return this.countInTimer != null
  }

  /**
   * Play `beats` count-in clicks spaced `interval` s apart, then invoke
   * `onComplete` (which starts the transport). Cancels any prior count-in.
   */
  startCountIn(beats: number, interval: number, onComplete: () => void): void {
    this.cancelCountIn()
    void this.ctx.resume()
    const first = this.ctx.currentTime + 0.12
    for (let i = 0; i < beats; i++) {
      this.countInNodes.push(this.click(first + i * interval, i === 0))
    }
    const totalMs = (first - this.ctx.currentTime + beats * interval) * 1000
    this.countInTimer = window.setTimeout(() => {
      this.countInTimer = null
      this.countInNodes = []
      onComplete()
    }, totalMs)
  }

  cancelCountIn(): void {
    if (this.countInTimer != null) {
      window.clearTimeout(this.countInTimer)
      this.countInTimer = null
    }
    for (const osc of this.countInNodes) {
      try {
        osc.stop()
      } catch {
        // already stopped
      }
    }
    this.countInNodes = []
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
    // Recover any device <audio> sink whose autoplay was blocked before a gesture.
    for (const sink of this.sinks.values()) {
      if (sink.audio && sink.audio.paused) void sink.audio.play().catch(() => {})
    }
    let from = this.offsetSec
    if (from >= this.duration) from = 0
    this.startSources(from)
    this.playing = true
    if (this.metronomeOn) this.startScheduler()
  }

  pause(): void {
    if (!this.playing) return
    this.offsetSec = this.currentTime
    this.stopSources()
    this.stopScheduler()
    this.playing = false
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.duration))
    this.offsetSec = clamped
    // Post-seek beats must be (re)scheduled from the new position.
    this.nextBeatIdx = 0
    if (this.playing) this.startSources(clamped)
  }

  get currentTime(): number {
    if (!this.playing) return this.offsetSec
    // Song time advances `rate`× faster than wall-clock (tempo is applied via
    // each source's playbackRate), so scale the elapsed wall time by `rate`.
    const elapsed = (this.ctx.currentTime - this.startedAtCtxTime) * this.rate
    return Math.min(this.duration, this.offsetSec + elapsed)
  }

  get isPlaying(): boolean {
    return this.playing
  }

  /** Called by the RAF loop when playback runs off the end. */
  handleEnded(): void {
    this.stopSources()
    this.stopScheduler()
    this.playing = false
    this.offsetSec = 0
  }

  dispose(): void {
    // Idempotent: a StrictMode remount disposes the engine, then the stale
    // in-flight load bails and disposes its own (same) engine again.
    if (this.disposed) return
    this.disposed = true
    this.stopSources()
    this.stopScheduler()
    this.cancelCountIn()
    for (const sm of this.submixes.values()) sm.stretch?.disconnect()
    for (const sink of this.sinks.values()) {
      if (sink.audio) {
        sink.audio.pause()
        sink.audio.srcObject = null
      }
    }
    void this.ctx.close()
  }

  private startSources(fromOffset: number): void {
    this.stopSources()
    const when = this.ctx.currentTime
    for (const [kind, buffer] of this.buffers) {
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = this.rate
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
