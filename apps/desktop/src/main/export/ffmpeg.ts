/**
 * ffmpeg is a *thin encoding layer* over the renderer's WYSIWYG offline render
 * (DECISIONS.md → Export). The renderer hands us raw interleaved f32 PCM; we
 * pipe it into ffmpeg to produce the requested container/codec.
 *
 *  - **Dev:** `ffmpeg` from PATH (override with `TIMBREL_FFMPEG`).
 *  - **Prod:** a static ffmpeg downloaded on first run into the tools dir
 *    (setup/tools.ts), like the sidecar engine.
 */
import { spawn } from 'node:child_process'
import { ffmpegCodecArgs, type ExportEncodeSettings } from '@timbrel/core'
import { resolveTool } from '../setup/tools'

/** Resolve the ffmpeg executable: explicit override → installed → PATH. */
export function resolveFfmpeg(): string {
  return resolveTool('ffmpeg', 'TIMBREL_FFMPEG')
}

export interface EncodePcmInput {
  /** Interleaved 32-bit float PCM (little-endian). */
  pcm: Buffer
  sampleRate: number
  channels: number
  settings: ExportEncodeSettings
  /** Absolute destination path (extension already correct for the format). */
  destPath: string
}

/**
 * Encode raw f32le PCM (read from stdin) to `destPath`. Resolves on success,
 * rejects with ffmpeg's stderr on failure or a spawn error (e.g. no ffmpeg).
 */
export function encodePcm(input: EncodePcmInput): Promise<void> {
  const { pcm, sampleRate, channels, settings, destPath } = input
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'f32le',
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
    '-i',
    'pipe:0',
    ...ffmpegCodecArgs(settings),
    destPath
  ]

  return new Promise((resolve, reject) => {
    const ff = spawn(resolveFfmpeg(), args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''

    ff.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    ff.on('error', (err) =>
      reject(
        new Error(
          err.message.includes('ENOENT')
            ? 'ffmpeg was not found. Install ffmpeg (e.g. `brew install ffmpeg`) or set TIMBREL_FFMPEG.'
            : `ffmpeg failed to start: ${err.message}`
        )
      )
    )
    ff.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
    })

    ff.stdin.on('error', () => {
      // Broken pipe — ffmpeg already exited; the 'close' handler reports why.
    })
    ff.stdin.write(pcm)
    ff.stdin.end()
  })
}
