import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb, closeDb } from './storage/db'
import { registerMediaSchemePrivileges, registerMediaProtocol } from './media'
import { SidecarManager } from './sidecar/manager'
import { registerIpc } from './ipc'

// Name drives the app-data folder (~/Library/Application Support/Timbrel, etc.).
app.setName('Timbrel')

// The privileged media scheme must be registered before the app is ready.
registerMediaSchemePrivileges()

let sidecar: SidecarManager | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ebf5ff',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.timbrel.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Output-device routing needs `enumerateDevices()` to expose device *labels*
  // ("AirPods Pro" vs a blank id), which Chromium gates behind a media
  // permission. Silently grant it (no prompt) — Timbrel never records audio; it
  // only needs the labels to build the routing UI (DECISIONS.md → Permissions).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  initDb()
  registerMediaProtocol()
  sidecar = new SidecarManager()
  registerIpc(sidecar)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  sidecar?.dispose()
  closeDb()
})
