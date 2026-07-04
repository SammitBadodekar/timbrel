/** Exposes the Spotify auth + metadata surface to the renderer. Handlers reject
 *  on failure; the renderer catches and shows the message. */
import { ipcMain, shell } from 'electron'
import { SPOTIFY_DASHBOARD_URL } from '@timbrel/core'
import { IpcChannel } from '../../shared/ipc'
import { status, connect, disconnect } from './auth'
import { getPlaylists, getPlaylistTracks, getLikedTracks } from './api'
import { setClientId } from './clientId'

export function registerSpotifyIpc(): void {
  ipcMain.handle(IpcChannel.SpotifyStatus, () => status())
  ipcMain.handle(IpcChannel.SpotifyConnect, () => connect())
  ipcMain.handle(IpcChannel.SpotifyDisconnect, () => disconnect())
  ipcMain.handle(IpcChannel.SpotifySetClientId, async (_event, clientId: string) => {
    await setClientId(clientId)
    return status()
  })
  ipcMain.handle(IpcChannel.SpotifyOpenDashboard, () => shell.openExternal(SPOTIFY_DASHBOARD_URL))
  ipcMain.handle(IpcChannel.SpotifyPlaylists, () => getPlaylists())
  ipcMain.handle(IpcChannel.SpotifyPlaylistTracks, (_event, playlistId: string) =>
    getPlaylistTracks(playlistId)
  )
  ipcMain.handle(IpcChannel.SpotifyLiked, () => getLikedTracks())
}
