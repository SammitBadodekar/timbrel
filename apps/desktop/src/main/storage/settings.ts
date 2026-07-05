/** App-global key/value settings — state with no per-song home. The
 *  multi-device output routing rig is stored here as a JSON blob under a single
 *  key (DECISIONS.md → Persistence): the rig is a global "live setup", not
 *  per-song, so machine-specific device ids never leak into `project.json`. */
import { defaultRoutingRig, type RoutingRig } from '@timbrel/core'
import { getDb } from './db'

const ROUTING_KEY = 'routingRig'

function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = @value`
    )
    .run({ key, value })
}

/** The saved routing rig, or a fresh default when none is stored / unparseable. */
export function readRoutingRig(): RoutingRig {
  const raw = getSetting(ROUTING_KEY)
  if (!raw) return defaultRoutingRig()
  try {
    return JSON.parse(raw) as RoutingRig
  } catch {
    return defaultRoutingRig()
  }
}

export function writeRoutingRig(rig: RoutingRig): void {
  setSetting(ROUTING_KEY, JSON.stringify(rig))
}
