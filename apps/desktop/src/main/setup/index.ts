/**
 * First-run install lifecycle. A fresh install is missing everything the app
 * shells out to — the frozen separation engine (~200 MB) plus yt-dlp and
 * ffmpeg/ffprobe (see tools.ts) — so the installer stays small and this module
 * fetches them at first launch. It streams progress to the renderer, which
 * blocks the whole UI behind a setup screen until `ready`, and supports retry
 * after a failure. Already-installed items are skipped, so adding a new tool
 * in an update re-gates only for that download.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { IpcChannel, type SetupState } from '../../shared/ipc'
import { sidecarSetupItem } from '../sidecar/resolve'
import { areToolsInstalled, toolSetupItems, updateYtDlpInBackground, type SetupItem } from './tools'

let state: SetupState = { status: 'ready' }
let installing = false

function setState(next: SetupState): void {
  state = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannel.SetupEvent, next)
  }
}

function isSetupComplete(): boolean {
  return sidecarSetupItem().installed() && areToolsInstalled()
}

async function runInstall(): Promise<void> {
  if (installing || state.status === 'ready') return
  installing = true
  const items: SetupItem[] = [sidecarSetupItem(), ...toolSetupItems()]
  const pending = items.filter((item) => !item.installed())
  try {
    for (const [i, item] of pending.entries()) {
      // Progress arrives per network chunk; forward only whole-percent changes
      // (each event is an IPC serialize + a renderer render).
      let lastPct = -1
      const base = {
        status: 'installing' as const,
        item: item.label,
        approxMB: item.approxMB,
        step: i + 1,
        steps: pending.length
      }
      setState({ ...base, stage: 'downloading', progress: 0 })
      await item.install((progress, stage) => {
        const pct = Math.floor(progress * 100)
        if (stage === 'downloading' && pct === lastPct) return
        lastPct = pct
        setState({ ...base, stage, progress })
      })
    }
    setState({ status: 'ready' })
  } catch (err) {
    setState({ status: 'error', message: (err as Error).message })
  } finally {
    installing = false
  }
}

/**
 * Registers the setup IPC and starts the first-run install. Call once at app
 * ready, before the window is created, so the renderer's initial state query
 * already sees an in-flight install. No-op when everything is installed (and
 * in dev, which runs the engine from source and tools from PATH).
 */
export function startSetup(): void {
  ipcMain.handle(IpcChannel.SetupState, () => state)
  ipcMain.handle(IpcChannel.SetupRetry, () => {
    void runInstall()
  })

  if (isSetupComplete()) {
    // Keep the acquisition layer alive: yt-dlp breaks as YouTube changes, and
    // its standalone binary self-updates in place.
    if (app.isPackaged) updateYtDlpInBackground()
    return
  }
  state = {
    status: 'installing',
    item: 'audio engine',
    approxMB: 200,
    step: 1,
    steps: 1,
    stage: 'downloading',
    progress: 0
  }
  void runInstall()
}
