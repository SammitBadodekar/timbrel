import dgram from 'node:dgram'
import os from 'node:os'
import { isIP } from 'node:net'
import { ipcMain } from 'electron'
import { IpcChannel, type WizBulb, type WizLightCommand, type WizLightFrame } from '../shared/ipc'

const WIZ_PORT = 38899
const DISCOVERY_TIMEOUT_MS = 1_500

interface WizResponse {
  result?: Record<string, unknown>
}

/** Persistent, low-latency UDP sender. Concert frames are intentionally not
 * acknowledgement-gated: a newer audio frame is more useful than retrying an
 * old one, and the bulbs still reply for diagnostics on the same socket. */
class WizTransport {
  private socket: dgram.Socket | null = null
  private requestId = 0

  private getSocket(): dgram.Socket {
    if (this.socket) return this.socket
    const socket = dgram.createSocket('udp4')
    // UDP errors must be observed or Node treats them as uncaught exceptions.
    socket.on('error', (error) => console.warn('WiZ UDP error:', error.message))
    socket.on('message', () => {})
    socket.unref()
    this.socket = socket
    return socket
  }

  async send(frames: WizLightFrame[]): Promise<void> {
    if (frames.length === 0) return
    const socket = this.getSocket()
    await Promise.all(
      frames.map(({ host, params }) => {
        assertIpv4(host)
        const payload = Buffer.from(
          JSON.stringify({ id: this.nextRequestId(), method: 'setPilot', params })
        )
        return new Promise<void>((resolve, reject) => {
          socket.send(payload, WIZ_PORT, host, (error) => (error ? reject(error) : resolve()))
        })
      })
    )
  }

  close(): void {
    if (!this.socket) return
    try {
      this.socket.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error
    }
    this.socket = null
  }

  private nextRequestId(): number {
    this.requestId = (this.requestId % 2_147_483_646) + 1
    return this.requestId
  }
}

const transport = new WizTransport()

export function registerWizIpc(): void {
  ipcMain.handle(IpcChannel.WizDiscover, () => discoverWizBulbs())
  ipcMain.handle(IpcChannel.WizSetLights, (_event, frames: WizLightFrame[]) => {
    const safeFrames = frames.slice(0, 64).map((frame) => ({
      host: frame.host,
      params: validateCommand(frame.params)
    }))
    return transport.send(safeFrames)
  })
}

export function disposeWiz(): void {
  transport.close()
}

export function discoverWizBulbs(timeoutMs = DISCOVERY_TIMEOUT_MS): Promise<WizBulb[]> {
  const id = Math.floor(Math.random() * 1_000_000) + 1
  const message = Buffer.from(JSON.stringify({ id, method: 'getPilot', params: {} }))

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    const bulbs = new Map<string, WizBulb>()
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve([...bulbs.values()].sort((a, b) => a.ip.localeCompare(b.ip)))
    }
    const timer = setTimeout(() => finish(), timeoutMs)

    socket.on('error', finish)
    socket.on('message', (data, remote) => {
      let response: WizResponse
      try {
        response = JSON.parse(data.toString('utf8')) as WizResponse
      } catch {
        return
      }
      const pilot = response.result ?? {}
      bulbs.set(remote.address, {
        ip: remote.address,
        mac: stringValue(pilot.mac),
        name: stringValue(pilot.moduleName) ?? stringValue(pilot.name),
        rssi: numberValue(pilot.rssi),
        pilot: restorablePilot(pilot)
      })
    })
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
        for (const address of broadcastAddresses()) socket.send(message, WIZ_PORT, address)
      } catch (error) {
        finish(error as Error)
      }
    })
  })
}

function broadcastAddresses(): string[] {
  const addresses = new Set(['255.255.255.255'])
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.netmask) continue
      const ip = entry.address.split('.').map(Number)
      const mask = entry.netmask.split('.').map(Number)
      addresses.add(ip.map((part, index) => part | (~mask[index]! & 255)).join('.'))
    }
  }
  return [...addresses]
}

function validateCommand(command: WizLightCommand): WizLightCommand {
  if (!command || typeof command !== 'object') throw new Error('Invalid WiZ light command')
  const out: WizLightCommand = {}
  if (command.state !== undefined) {
    if (typeof command.state !== 'boolean') throw new Error('WiZ state must be true or false')
    out.state = command.state
  }
  if (command.r !== undefined) out.r = inRange(command.r, 0, 255, 'red')
  if (command.g !== undefined) out.g = inRange(command.g, 0, 255, 'green')
  if (command.b !== undefined) out.b = inRange(command.b, 0, 255, 'blue')
  if (command.dimming !== undefined) out.dimming = inRange(command.dimming, 1, 100, 'brightness')
  if (command.temp !== undefined) out.temp = inRange(command.temp, 1_000, 10_000, 'temperature')
  if (Object.keys(out).length === 0) throw new Error('Empty WiZ light command')
  return out
}

function restorablePilot(pilot: Record<string, unknown>): WizLightCommand {
  const command: WizLightCommand = {}
  if (typeof pilot.state === 'boolean') command.state = pilot.state
  for (const key of ['r', 'g', 'b', 'dimming', 'temp'] as const) {
    const value = numberValue(pilot[key])
    if (value !== undefined) command[key] = value
  }
  return command
}

function assertIpv4(host: string): void {
  if (isIP(host) !== 4) throw new Error('Invalid WiZ bulb address')
}

function inRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`WiZ ${label} must be between ${min} and ${max}`)
  }
  return Math.round(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
