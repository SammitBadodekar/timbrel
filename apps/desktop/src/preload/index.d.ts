import type { ElectronAPI } from '@electron-toolkit/preload'
import type { TimbrelApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    timbrel: TimbrelApi
  }
}
