import { randomUUID } from 'node:crypto';
import type { CompletionRequest, CompletionResult } from '../../../src/types/ai';
import type { JobCreateRequest, JobItemState, JobState, JobView } from '../../../src/types/jobs';
import { GatewayError } from '../providers/types';

/*
 * Async job API for bulk AI runs. Jobs live in memory (they are cheap to re-run and never hold keys); each item is one
 * completion call through the gateway, run with limited concurrency. The runner never switches provider or model by
 * itself: after a rate limit the remaining items are marked failed so the user can decide what to retry.
 */

export type CompleteFn = (uid: string, req: CompletionRequest, signal?: AbortSignal) => Promise<CompletionResult>;

export interface JobRunnerOptions {
  concurrency?: number;
  maxActivePerUser?: number;
  /** How long finished jobs are kept for polling. */
  retainMs?: number;
  now?: () => number;
}

interface Item { id: string; request: CompletionRequest; state: JobItemState; text?: string; error?: { code: string; message: string }; provider?: CompletionResult['provider']; model?: string; latencyMs?: number }
interface Job {
  id: string; uid: string; kind: string; label: string; createdAt: number; startedAt?: number; finishedAt?: number;
  items: Item[]; cancelled: boolean; abort: AbortController; next: number; rateLimited: boolean; finished: Promise<void>;
}

const FINAL = new Set<JobItemState>(['succeeded', 'failed', 'cancelled']);
const iso = (t: number) => new Date(t).toISOString();

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly concurrency: number;
  private readonly maxActive: number;
  private readonly retainMs: number;
  private readonly now: () => number;

  constructor(private readonly complete: CompleteFn, opts: JobRunnerOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.maxActive = Math.max(1, opts.maxActivePerUser ?? 3);
    this.retainMs = opts.retainMs ?? 60 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  create(uid: string, req: JobCreateRequest): JobView {
    this.sweep();
    const active = [...this.jobs.values()].filter((j) => j.uid === uid && !j.finishedAt).length;
    if (active >= this.maxActive) throw new GatewayError('BAD_REQUEST', `You already have ${active} job(s) running. Wait for one to finish or cancel it.`, 409);
    let release!: () => void;
    const job: Job = {
      id: randomUUID(), uid, kind: req.kind, label: req.label ?? req.kind, createdAt: this.now(), cancelled: false, abort: new AbortController(), next: 0, rateLimited: false,
      items: req.items.map((i) => ({ id: i.id, request: i.request, state: 'queued' as JobItemState })),
      finished: new Promise<void>((r) => { release = r; }),
    };
    this.jobs.set(job.id, job);
    void this.run(job).finally(() => { job.finishedAt = this.now(); release(); });
    return this.view(job);
  }

  get(uid: string, id: string): JobView { return this.view(this.own(uid, id)); }
  list(uid: string): JobView[] { this.sweep(); return [...this.jobs.values()].filter((j) => j.uid === uid).sort((a, b) => b.createdAt - a.createdAt).map((j) => this.view(j)); }

  /** Stop starting new items, abort the ones in flight and mark everything unfinished as cancelled. */
  cancel(uid: string, id: string): JobView {
    const job = this.own(uid, id);
    if (!job.finishedAt) {
      job.cancelled = true;
      job.abort.abort();
      for (const it of job.items) if (it.state === 'queued' || it.state === 'running') it.state = 'cancelled';
    }
    return this.view(job);
  }

  /** Resolves when the job has finished (used by tests and graceful shutdown). */
  whenDone(uid: string, id: string): Promise<void> { return this.own(uid, id).finished; }

  private own(uid: string, id: string): Job {
    const j = this.jobs.get(id);
    if (!j || j.uid !== uid) throw new GatewayError('BAD_REQUEST', 'Job not found.', 404);
    return j;
  }

  private sweep() {
    const cutoff = this.now() - this.retainMs;
    for (const [id, j] of this.jobs) if (j.finishedAt && j.finishedAt < cutoff) this.jobs.delete(id);
  }

  private async run(job: Job): Promise<void> {
    job.startedAt = this.now();
    const worker = async () => {
      for (;;) {
        if (job.cancelled) return;
        const it = job.items[job.next++];
        if (!it) return;
        if (it.state !== 'queued') continue;
        if (job.rateLimited) {
          it.state = 'failed';
          it.error = { code: 'RATE_LIMITED', message: 'Not attempted: the provider rate-limited an earlier item. Retry the failed items later, or pick another model yourself.' };
          continue;
        }
        it.state = 'running';
        try {
          const r = await this.complete(job.uid, it.request, job.abort.signal);
          if (job.cancelled) return;
          Object.assign(it, { state: 'succeeded' as const, text: r.text, provider: r.provider, model: r.model, latencyMs: r.latencyMs });
        } catch (e) {
          if (job.cancelled) return;
          const err = e instanceof GatewayError ? e : new GatewayError('PROVIDER_ERROR', 'The AI request failed.', 500);
          if (err.code === 'RATE_LIMITED') job.rateLimited = true;
          it.state = 'failed';
          it.error = { code: err.code, message: err.message };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, job.items.length) }, worker));
  }

  private view(job: Job): JobView {
    const done = job.items.filter((i) => FINAL.has(i.state)).length;
    const failed = job.items.filter((i) => i.state === 'failed').length;
    const ok = job.items.filter((i) => i.state === 'succeeded').length;
    const finished = done === job.items.length;
    let state: JobState;
    if (job.cancelled) state = 'cancelled';
    else if (!finished) state = job.items.some((i) => i.state === 'running') || done > 0 ? 'running' : 'queued';
    else state = failed === 0 ? 'succeeded' : ok === 0 ? 'failed' : 'partial';
    return {
      id: job.id, kind: job.kind, label: job.label, state, total: job.items.length, done, failed,
      createdAt: iso(job.createdAt), ...(job.startedAt ? { startedAt: iso(job.startedAt) } : {}),
      ...(finished || job.cancelled ? { finishedAt: iso(job.finishedAt ?? this.now()) } : {}),
      items: job.items.map(({ id, state: s, text, error, provider, model, latencyMs }) => ({ id, state: s, ...(text !== undefined ? { text } : {}), ...(error ? { error } : {}), ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(latencyMs !== undefined ? { latencyMs } : {}) })),
    };
  }
}
