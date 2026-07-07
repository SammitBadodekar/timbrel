import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel, type SeparationEvent, type TimbrelApi } from '../shared/ipc'

const timbrel: TimbrelApi = {
  pickAudioFile: () => ipcRenderer.invoke(IpcChannel.PickAudio),
  pathForFile: (file) => webUtils.getPathForFile(file),
  startSeparation: (input) => ipcRenderer.invoke(IpcChannel.StartSeparation, input),
  listSongs: () => ipcRenderer.invoke(IpcChannel.ListSongs),
  deleteSong: (songId) => ipcRenderer.invoke(IpcChannel.DeleteSong, songId),
  listPlaylists: () => ipcRenderer.invoke(IpcChannel.PlaylistList),
  getPlaylist: (playlistId) => ipcRenderer.invoke(IpcChannel.PlaylistGet, playlistId),
  createPlaylist: (name) => ipcRenderer.invoke(IpcChannel.PlaylistCreate, name),
  renamePlaylist: (playlistId, name) =>
    ipcRenderer.invoke(IpcChannel.PlaylistRename, playlistId, name),
  deletePlaylist: (playlistId) => ipcRenderer.invoke(IpcChannel.PlaylistDelete, playlistId),
  addSongsToPlaylist: (playlistId, songIds) =>
    ipcRenderer.invoke(IpcChannel.PlaylistAddSongs, playlistId, songIds),
  removeSongFromPlaylist: (playlistId, songId) =>
    ipcRenderer.invoke(IpcChannel.PlaylistRemoveSong, playlistId, songId),
  reorderPlaylist: (playlistId, orderedSongIds) =>
    ipcRenderer.invoke(IpcChannel.PlaylistReorder, playlistId, orderedSongIds),
  loadProject: (songId) => ipcRenderer.invoke(IpcChannel.LoadProject, songId),
  saveProject: (songId, patch) => ipcRenderer.invoke(IpcChannel.SaveProject, songId, patch),
  getPeaks: (songId) => ipcRenderer.invoke(IpcChannel.ReadPeaks, songId),
  savePeaks: (songId, peaks) => ipcRenderer.invoke(IpcChannel.SavePeaks, songId, peaks),
  pickExportTarget: (input) => ipcRenderer.invoke(IpcChannel.ExportPickTarget, input),
  encodeExport: (input) => ipcRenderer.invoke(IpcChannel.ExportEncode, input),
  spotifyStatus: () => ipcRenderer.invoke(IpcChannel.SpotifyStatus),
  spotifyConnect: () => ipcRenderer.invoke(IpcChannel.SpotifyConnect),
  spotifyDisconnect: () => ipcRenderer.invoke(IpcChannel.SpotifyDisconnect),
  spotifySetClientId: (clientId) => ipcRenderer.invoke(IpcChannel.SpotifySetClientId, clientId),
  spotifyOpenDashboard: () => ipcRenderer.invoke(IpcChannel.SpotifyOpenDashboard),
  spotifyPlaylists: () => ipcRenderer.invoke(IpcChannel.SpotifyPlaylists),
  spotifyPlaylistTracks: (playlistId) =>
    ipcRenderer.invoke(IpcChannel.SpotifyPlaylistTracks, playlistId),
  spotifyLikedTracks: () => ipcRenderer.invoke(IpcChannel.SpotifyLiked),
  spotifyImportTrack: (track) => ipcRenderer.invoke(IpcChannel.SpotifyImportTrack, track),
  youtubeSearch: (query) => ipcRenderer.invoke(IpcChannel.YoutubeSearch, query),
  youtubeImport: (video) => ipcRenderer.invoke(IpcChannel.YoutubeImport, video),
  getLyrics: (songId) => ipcRenderer.invoke(IpcChannel.GetLyrics, songId),
  getRoutingRig: () => ipcRenderer.invoke(IpcChannel.GetRoutingRig),
  saveRoutingRig: (rig) => ipcRenderer.invoke(IpcChannel.SaveRoutingRig, rig),
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
