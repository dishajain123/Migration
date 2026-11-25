import type { CompletionRequest, ProviderId } from './ai';

// Async bulk job API of the AI gateway: the browser builds one completion request per item (e.g. one per target table),
// the gateway runs them in the background with limited concurrency, and the browser polls for status and results.

export type JobItemState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
/** partial = some items succeeded and some failed. */
export type JobState = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export interface JobItemView {
  id: string;
  state: JobItemState;
  /** Raw model output; the caller parses and validates it. */
  text?: string;
  error?: { code: string; message: string };
  provider?: ProviderId;
  model?: string;
  latencyMs?: number;
}

export interface JobView {
  id: string;
  kind: string;
  label: string;
  state: JobState;
  total: number;
  /** Items in a final state (succeeded, failed or cancelled). */
  done: number;
  failed: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  items: JobItemView[];
}

export interface JobCreateRequest {
  kind: string;
  label?: string;
  items: { id: string; request: CompletionRequest }[];
}

/** Mapping jobs as the UI sees them: each item's output already parsed and validated into proposals. */
export interface MappingJobItem {
  table: string;
  state: JobItemState;
  error?: { code: string; message: string };
  /** Present when the item succeeded and its output parsed. */
  proposalCount?: number;
  discardedCount?: number;
}
export interface MappingJobStatus {
  id: string;
  state: JobState;
  total: number;
  done: number;
  failed: number;
  createdAt: string;
  finishedAt?: string;
  items: MappingJobItem[];
}
