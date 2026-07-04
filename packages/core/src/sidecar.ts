/**
 * Stdio JSON protocol between the Electron main process and the frozen Python
 * sidecar. One JSON object per line: requests go to the sidecar's stdin,
 * events come back on its stdout. stderr is reserved for crash traces.
 */
import type { StemKind } from "./stems.js";
import type { DetectedFeatures } from "./song.js";

export type SeparationModel = "htdemucs_6s";
export type ComputeDevice = "auto" | "cpu" | "mps" | "cuda";

// ---------------------------------------------------------------------------
// Requests: Electron → sidecar
// ---------------------------------------------------------------------------

export interface SeparateRequest {
  cmd: "separate";
  jobId: string;
  /** Absolute path to the source audio file. */
  inputPath: string;
  /** Absolute directory where `stems/<kind>.flac` will be written. */
  outputDir: string;
  model: SeparationModel;
  device?: ComputeDevice;
  /** Run librosa BPM/beat detection in the same pass. Defaults true. */
  detectFeatures?: boolean;
}

export interface PingRequest {
  cmd: "ping";
}

export interface CancelRequest {
  cmd: "cancel";
  jobId: string;
}

export type SidecarRequest = SeparateRequest | PingRequest | CancelRequest;

// ---------------------------------------------------------------------------
// Events: sidecar → Electron
// ---------------------------------------------------------------------------

export type SeparationStage =
  | "loading-model"
  | "separating"
  | "encoding"
  | "detecting-features";

export interface ReadyEvent {
  event: "ready";
  /** Sidecar build version. */
  version: string;
  /** Resolved compute device the sidecar will actually use. */
  device: ComputeDevice;
}

export interface ProgressEvent {
  event: "progress";
  jobId: string;
  stage: SeparationStage;
  /** 0..1. */
  progress: number;
  message?: string;
}

/** Emitted as each stem finishes encoding to FLAC. */
export interface StemEvent {
  event: "stem";
  jobId: string;
  kind: StemKind;
  path: string;
}

export interface DoneEvent {
  event: "done";
  jobId: string;
  /** kind → absolute FLAC path. */
  stems: Record<StemKind, string>;
  features: DetectedFeatures;
  durationSec: number;
}

export interface ErrorEvent {
  event: "error";
  jobId?: string;
  message: string;
  /** If true, the sidecar process is unusable and should be respawned. */
  fatal?: boolean;
}

export interface LogEvent {
  event: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

export type SidecarEvent =
  | ReadyEvent
  | ProgressEvent
  | StemEvent
  | DoneEvent
  | ErrorEvent
  | LogEvent;

/** Narrow an unknown parsed JSON line to a SidecarEvent. */
export function isSidecarEvent(value: unknown): value is SidecarEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { event?: unknown }).event === "string"
  );
}
