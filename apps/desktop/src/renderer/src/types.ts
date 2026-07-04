import type { ImportStage } from '@shared/ipc'

/** UI-side view of an in-flight job (local separation or Spotify import). */
export interface JobUi {
  stage: ImportStage | 'queued'
  progress: number
  message?: string
  error?: string
}

export const STAGE_LABELS: Record<ImportStage | 'queued', string> = {
  queued: 'Queued',
  matching: 'Finding audio',
  downloading: 'Downloading',
  'loading-model': 'Loading model',
  separating: 'Separating stems',
  encoding: 'Encoding FLAC',
  'detecting-features': 'Detecting tempo & key'
}
