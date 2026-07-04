import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel, type SeparationEvent, type TimbrelApi } from '../shared/ipc'

const timbrel: TimbrelApi = {
  pickAudioFile: () => ipcRenderer.invoke(IpcChannel.PickAudio),
  startSeparation: (input) => ipcRenderer.invoke(IpcChannel.StartSeparation, input),
  listSongs: () => ipcRenderer.invoke(IpcChannel.ListSongs),
  loadProject: (songId) => ipcRenderer.invoke(IpcChannel.LoadProject, songId),
  getStemBytes: (songId, kind) => ipcRenderer.invoke(IpcChannel.ReadStem, songId, kind),
  onSeparationEvent: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: SeparationEvent): void => cb(payload)
    ipcRenderer.on(IpcChannel.SeparationEvent, listener)
    return () => ipcRenderer.removeListener(IpcChannel.SeparationEvent, listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('timbrel', timbrel)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.timbrel = timbrel
}
