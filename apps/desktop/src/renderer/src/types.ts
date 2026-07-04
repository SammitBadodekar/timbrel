import type { SeparationStage } from '@timbrel/core'

/** UI-side view of an in-flight separation job, driven by push events. */
export interface JobUi {
  stage: SeparationStage | 'queued'
  progress: number
  message?: string
  error?: string
}

export const STAGE_LABELS: Record<SeparationStage | 'queued', string> = {
  queued: 'Queued',
  'loading-model': 'Loading model',
  separating: 'Separating stems',
  encoding: 'Encoding FLAC',
  'detecting-features': 'Detecting tempo & key'
}
