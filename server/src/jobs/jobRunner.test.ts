import { describe, expect, it } from 'vitest';
import type { CompletionRequest, CompletionResult } from '../../../src/types/ai';
import type { JobCreateRequest } from '../../../src/types/jobs';
import { GatewayError } from '../providers/types';
import { JOB_MAX_ITEMS, parseJobRequest } from '../schemas/requests';
import { JobRunner, type CompleteFn } from './jobRunner';

const req = (n: number): JobCreateRequest => ({
  kind: 'mapping-ai', label: 'test',
  items: Array.from({ length: n }, (_, i) => ({ id: `T${i}`, request: { messages: [{ role: 'user' as const, content: `item ${i}` }] } satisfies CompletionRequest })),
});
const ok = (text: string): CompletionResult => ({ text, provider: 'openai', model: 'm', latencyMs: 5 });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobRunner', () => {
  it('runs every item with bounded concurrency and reports status and results', async () => {
    let inFlight = 0; let peak = 0;
    const complete: CompleteFn = async (_u, r) => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; return ok(`done:${r.messages[0].content}`); };
    const jobs = new JobRunner(complete, { concurrency: 2 });
    const created = jobs.create('u', req(5));
    expect(created.total).toBe(5);
    expect(['queued', 'running']).toContain(created.state);
    await jobs.whenDone('u', created.id);
    const v = jobs.get('u', created.id);
    expect(v.state).toBe('succeeded');
    expect(v.done).toBe(5);
    expect(v.failed).toBe(0);
    expect(v.items.map((i) => i.text)).toEqual([0, 1, 2, 3, 4].map((i) => `done:item ${i}`));
    expect(v.items[0]).toMatchObject({ state: 'succeeded', provider: 'openai', model: 'm' });
    expect(v.finishedAt).toBeDefined();
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('is partial when some items fail, keeping the error code and message', async () => {
    const complete: CompleteFn = async (_u, r) => { if (r.messages[0].content === 'item 1') throw new GatewayError('INVALID_KEY', 'bad key'); return ok('x'); };
    const jobs = new JobRunner(complete);
    const j = jobs.create('u', req(3));
    await jobs.whenDone('u', j.id);
    const v = jobs.get('u', j.id);
    expect(v.state).toBe('partial');
    expect(v.failed).toBe(1);
    expect(v.items[1].error).toEqual({ code: 'INVALID_KEY', message: 'bad key' });
    expect(v.items[1].text).toBeUndefined();
  });

  it('hides unexpected error details and is failed when everything fails', async () => {
    const jobs = new JobRunner(async () => { throw new Error('secret sk-123 leaked'); });
    const j = jobs.create('u', req(2));
    await jobs.whenDone('u', j.id);
    const v = jobs.get('u', j.id);
    expect(v.state).toBe('failed');
    expect(JSON.stringify(v)).not.toMatch(/sk-123/);
  });

  it('stops after a rate limit, marks the rest failed, and never retries or switches model on its own', async () => {
    let calls = 0;
    const jobs = new JobRunner(async () => { calls++; throw new GatewayError('RATE_LIMITED', 'slow down', 429); }, { concurrency: 1 });
    const j = jobs.create('u', req(4));
    await jobs.whenDone('u', j.id);
    const v = jobs.get('u', j.id);
    expect(calls).toBe(1);
    expect(v.state).toBe('failed');
    expect(v.items.map((i) => i.error?.code)).toEqual(['RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED']);
    expect(v.items[3].error?.message).toMatch(/Not attempted/);
  });

  it('cancels: aborts in-flight work, starts nothing new and marks items cancelled', async () => {
    let started = 0;
    const complete: CompleteFn = (_u, _r, signal) => new Promise((_res, rej) => { started++; signal?.addEventListener('abort', () => rej(new GatewayError('TIMEOUT', 'aborted'))); });
    const jobs = new JobRunner(complete, { concurrency: 2 });
    const j = jobs.create('u', req(4));
    expect(jobs.get('u', j.id).state).toBe('running');
    const c = jobs.cancel('u', j.id);
    expect(c.state).toBe('cancelled');
    await jobs.whenDone('u', j.id);
    const v = jobs.get('u', j.id);
    expect(v.items.every((i) => i.state === 'cancelled')).toBe(true);
    expect(started).toBe(2);
  });

  it('keeps jobs private to their owner and limits active jobs per user', async () => {
    const never: CompleteFn = (_u, _r, signal) => new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new GatewayError('TIMEOUT', 'aborted'))));
    const jobs = new JobRunner(never, { maxActivePerUser: 2 });
    const a = jobs.create('alice', req(1));
    jobs.create('alice', req(1));
    expect(() => jobs.create('alice', req(1))).toThrow(/already have 2 job/);
    expect(() => jobs.get('bob', a.id)).toThrow(GatewayError);
    expect(() => jobs.cancel('bob', a.id)).toThrow(GatewayError);
    expect(jobs.list('bob')).toEqual([]);
    expect(jobs.list('alice')).toHaveLength(2);
    jobs.create('bob', req(1)); // another user is not affected
    jobs.list('alice').forEach((j) => jobs.cancel('alice', j.id));
  });

  it('drops finished jobs after the retention period', async () => {
    let t = 1_000_000;
    const jobs = new JobRunner(async () => ok('x'), { retainMs: 1000, now: () => t });
    const j = jobs.create('u', req(1));
    await jobs.whenDone('u', j.id);
    expect(jobs.list('u')).toHaveLength(1);
    t += 5000;
    expect(jobs.list('u')).toHaveLength(0);
    expect(() => jobs.get('u', j.id)).toThrow(GatewayError);
  });
});

describe('parseJobRequest', () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({ id, request: { messages: [{ role: 'user', content: 'hi' }], json: true, maxTokens: 99999, ...over } });
  it('accepts and normalises a valid request', () => {
    const r = parseJobRequest({ kind: 'mapping-ai', label: 'x', items: [item('a')] });
    expect(r.items[0].request).toMatchObject({ json: true, maxTokens: 16000 });
    expect(r.kind).toBe('mapping-ai');
  });
  it('rejects bad kind, empty or oversized lists, duplicates, bad roles and unknown providers', () => {
    expect(() => parseJobRequest({ kind: 'Bad Kind', items: [item('a')] })).toThrow(GatewayError);
    expect(() => parseJobRequest({ kind: 'k', items: [] })).toThrow(GatewayError);
    expect(() => parseJobRequest({ kind: 'k', items: Array.from({ length: JOB_MAX_ITEMS + 1 }, (_, i) => item(`i${i}`)) })).toThrow(GatewayError);
    expect(() => parseJobRequest({ kind: 'k', items: [item('a'), item('a')] })).toThrow(/not unique/);
    expect(() => parseJobRequest({ kind: 'k', items: [{ id: 'a', request: { messages: [{ role: 'tool', content: 'x' }] } }] })).toThrow(GatewayError);
    expect(() => parseJobRequest({ kind: 'k', items: [item('a', { provider: 'nope' })] })).toThrow(GatewayError);
  });
});
