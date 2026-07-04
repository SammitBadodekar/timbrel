/** Long-running background work tracked in the job queue (SQLite). */
export type JobKind = "download" | "separate";

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

export interface Job {
  id: string;
  songId: string;
  kind: JobKind;
  status: JobStatus;
  /** 0..1. */
  progress: number;
  /** Human-readable current stage, or null. */
  stage: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
