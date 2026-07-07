/**
 * Turns a live job (current stage + within-stage progress) into ONE continuous,
 * forward-only bar. The five pipeline stages get fixed weight shares, so the bar
 * only ever advances — it never resets when the stage changes. Separation
 * dominates the weights because it dominates the wall-clock (~80% per STATUS.md).
 */
import type { JobUi } from '../types'

interface Stage {
  /** 1-based step number shown as "step N of 5". */
  step: number
  /** Share of the whole bar (all weights sum to 1). */
  weight: number
  label: string
}

/** Ordered pipeline. Acquisition (download/queued) is step 1 for every source,
 *  so a local upload and a YouTube import read as the same 5-step journey. */
const STAGES: Record<JobUi['stage'], Stage> = {
  queued: { step: 1, weight: 0.1, label: 'Preparing' },
  matching: { step: 1, weight: 0.1, label: 'Finding audio' },
  downloading: { step: 1, weight: 0.1, label: 'Downloading' },
  'loading-model': { step: 2, weight: 0.08, label: 'Loading model' },
  separating: { step: 3, weight: 0.57, label: 'Separating stems' },
  encoding: { step: 4, weight: 0.1, label: 'Encoding audio' },
  'detecting-features': { step: 5, weight: 0.15, label: 'Detecting tempo & key' }
}

const STEP_COUNT = 5

/** Cumulative weight completed before a given step begins. */
const CUMULATIVE_BEFORE: Record<number, number> = { 1: 0, 2: 0.1, 3: 0.18, 4: 0.75, 5: 0.85 }

export interface JobProgress {
  /** 0..1 across the whole pipeline. */
  fraction: number
  step: number
  stepCount: number
  label: string
}

export function jobProgress(job: JobUi): JobProgress {
  const stage = STAGES[job.stage] ?? STAGES.queued
  const within = Math.max(0, Math.min(1, job.progress || 0))
  const fraction = Math.min(1, CUMULATIVE_BEFORE[stage.step]! + stage.weight * within)
  return { fraction, step: stage.step, stepCount: STEP_COUNT, label: stage.label }
}

/** Rough, honest expectation set up front — the post-perf sidecar does a
 *  typical song in ~30 s (STATUS.md). Deliberately flat, not a live countdown. */
export const IMPORT_ETA_LABEL = 'approx 30 sec'
