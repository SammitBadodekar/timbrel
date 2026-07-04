/** Main-side export handlers: pick a destination (native dialog) and encode
 *  the renderer's PCM through ffmpeg. See DECISIONS.md → Export. */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { isAbsolute, join } from 'node:path'
import { FORMAT_EXT, FORMAT_LABEL } from '@timbrel/core'
import {
  IpcChannel,
  type ExportEncodeInput,
  type ExportEncodeResult,
  type ExportPickTargetInput
} from '../../shared/ipc'
import { encodePcm } from './ffmpeg'

export function registerExportIpc(): void {
  ipcMain.handle(
    IpcChannel.ExportPickTarget,
    async (_event, input: ExportPickTargetInput): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

      if (input.kind === 'dir') {
        const opts = {
          title: 'Choose export folder',
          properties: ['openDirectory', 'createDirectory'] as const,
          buttonLabel: 'Export here'
        }
        const res = win
          ? await dialog.showOpenDialog(win, { ...opts, properties: [...opts.properties] })
          : await dialog.showOpenDialog({ ...opts, properties: [...opts.properties] })
        return res.canceled ? null : (res.filePaths[0] ?? null)
      }

      const opts = {
        title: 'Export',
        defaultPath: input.defaultName,
        filters: [{ name: FORMAT_LABEL[input.format], extensions: [FORMAT_EXT[input.format]] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return res.canceled ? null : (res.filePath ?? null)
    }
  )

  ipcMain.handle(
    IpcChannel.ExportEncode,
    async (_event, input: ExportEncodeInput): Promise<ExportEncodeResult> => {
      try {
        const destPath = input.filename ? join(input.targetPath, input.filename) : input.targetPath
        // Paths come from native dialogs; guard against anything relative anyway.
        if (!isAbsolute(destPath)) return { ok: false, error: 'Invalid destination path.' }
        await encodePcm({
          pcm: Buffer.from(input.pcm),
          sampleRate: input.sampleRate,
          channels: input.channels,
          settings: input.settings,
          destPath
        })
        return { ok: true, path: destPath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
}
