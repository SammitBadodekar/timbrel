/**
 * Owns the sidecar child process: spawns it, parses its line-delimited JSON
 * event stream, and drives separation jobs. One long-lived process handles jobs
 * sequentially (v0.1); it is respawned if it dies.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'
import {
  isSidecarEvent,
  type ComputeDevice,
  type DoneEvent,
  type SeparateRequest,
  type SidecarEvent,
  type SidecarRequest
} from '@timbrel/core'
import { envWithTools } from '../setup/tools'
import { isSidecarInstalled, resolveSidecar } from './resolve'

const READY_TIMEOUT_MS = 90_000

export class SidecarManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private rl: Interface | null = null
  private readyPromise: Promise<void> | null = null
  private readonly bus = new EventEmitter()
  private device: ComputeDevice = 'cpu'

  /** Idempotent: starts the process (if needed) and resolves once it's ready. */
  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise

    // The UI is gated on the first-run install, so this should be unreachable —
    // but a clear error beats spawn ENOENT if a job races the installer.
    if (!isSidecarInstalled()) {
      return Promise.reject(
        new Error('The audio engine is still being installed. Try again in a moment.')
      )
    }

    const { command, args, cwd } = resolveSidecar()
    // demucs (inside the engine) shells out to ffmpeg/ffprobe to decode input
    // audio — make sure the first-run installed tools are on its PATH.
    const proc = spawn(command, args, { cwd, stdio: 'pipe', env: envWithTools() })
    this.proc = proc
    this.rl = createInterface({ input: proc.stdout })
    this.rl.on('line', (line) => this.onLine(line))
    proc.stderr.on('data', (chunk: Buffer) => {
      // The sidecar routes traces/library noise to stderr; surface for debugging.
      console.error('[sidecar]', chunk.toString().trimEnd())
    })
    proc.on('exit', (code) => this.onExit(code))
    proc.on('error', (err) => this.bus.emit('spawn-error', err))

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('sidecar did not become ready in time')),
        READY_TIMEOUT_MS
      )
      const onReady = (event: SidecarEvent): void => {
        if (event.event !== 'ready') return
        this.device = event.device
        clearTimeout(timer)
        this.bus.off('event', onReady)
        resolve()
      }
      this.bus.on('event', onReady)
      proc.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('sidecar exited before signalling ready'))
      })
      proc.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    return this.readyPromise
  }

  get computeDevice(): ComputeDevice {
    return this.device
  }

  onEvent(cb: (event: SidecarEvent) => void): () => void {
    this.bus.on('event', cb)
    return () => this.bus.off('event', cb)
  }

  /**
   * Run a separation job. `onEvent` receives every event for this job as it
   * streams; the promise resolves with the terminal `done` event or rejects on
   * an `error` event or a process crash.
   */
  runSeparation(
    request: Omit<SeparateRequest, 'cmd'>,
    onEvent: (event: SidecarEvent) => void
  ): Promise<DoneEvent> {
    return new Promise<DoneEvent>((resolve, reject) => {
      const cleanup = (): void => {
        offEvent()
        this.proc?.off('exit', onExit)
      }
      const onExit = (): void => {
        cleanup()
        reject(new Error('sidecar crashed during separation'))
      }
      const offEvent = this.onEvent((event) => {
        // Route only this job's events (job-less events like `log` pass through).
        if ('jobId' in event && event.jobId && event.jobId !== request.jobId) return
        onEvent(event)
        if (event.event === 'done') {
          cleanup()
          resolve(event)
        } else if (event.event === 'error') {
          cleanup()
          reject(new Error(event.message))
        }
      })
      this.proc?.once('exit', onExit)

      try {
        this.send({ cmd: 'separate', ...request })
      } catch (err) {
        cleanup()
        reject(err as Error)
      }
    })
  }

  dispose(): void {
    this.rl?.close()
    this.proc?.kill()
    this.proc = null
    this.rl = null
    this.readyPromise = null
  }

  private send(request: SidecarRequest): void {
    const stdin = this.proc?.stdin
    if (!stdin || !stdin.writable) throw new Error('sidecar is not running')
    stdin.write(JSON.stringify(request) + '\n')
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (isSidecarEvent(parsed)) this.bus.emit('event', parsed)
  }

  private onExit(code: number | null): void {
    console.error(`[sidecar] exited with code ${code}`)
    this.rl?.close()
    this.proc = null
    this.rl = null
    this.readyPromise = null
    this.bus.emit('exit', code)
  }
}
