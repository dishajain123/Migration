import type { ApiResult } from '@/types';
import type { JobCreateRequest, JobItemView, JobView, MappingJobStatus } from '@/types/jobs';
import type { MappingProposalSet } from '@/types/mappingAi';
import type { EnrichmentOptions } from '@/types/profile';
import type { AiGatewayClient } from '../aiGateway';
import type { MappingDecisionService, MappingJobService, Services } from '../types';
import { buildMappingInput, parseMappingOutput } from './mappingInput';
import { fail } from './util';

type Deps = Pick<Services, 'dataModel' | 'mapping'>;

/**
 * Bulk Agent 4 AI run as a gateway job. The gateway only runs prompts and tracks status; parsing and validation happen
 * here, after each item finishes, with the same validators as a single-table run. Parsed results are cached per job.
 */
export function createMappingJobs(deps: Deps, gateway: AiGatewayClient, decisions?: MappingDecisionService): MappingJobService {
  const enrichByJob = new Map<string, EnrichmentOptions | undefined>();
  const parsed = new Map<string, MappingProposalSet | { error: string }>();

  async function parseItem(jobId: string, item: JobItemView): Promise<MappingProposalSet | { error: string } | null> {
    if (item.state !== 'succeeded' || item.text === undefined) return null;
    const key = `${jobId}:${item.id}`;
    const cached = parsed.get(key);
    if (cached) return cached;
    const input = await buildMappingInput(deps, decisions, item.id, enrichByJob.get(jobId));
    const out = !input.ok ? { error: input.error.error?.message ?? 'Could not rebuild the workbook context.' }
      : parseMappingOutput(input.value, item.text) ?? { error: 'The model did not return the expected JSON.' };
    parsed.set(key, out);
    return out;
  }

  async function toStatus(job: JobView): Promise<MappingJobStatus> {
    const items = await Promise.all(job.items.map(async (it) => {
      const p = await parseItem(job.id, it);
      const bad = p && 'error' in p ? p.error : undefined;
      return {
        table: it.id,
        // A finished item whose output could not be used is shown as failed, with the reason.
        state: bad ? ('failed' as const) : it.state,
        ...(it.error ? { error: it.error } : bad ? { error: { code: 'BAD_OUTPUT', message: bad } } : {}),
        ...(p && !('error' in p) ? { proposalCount: p.proposals.length, discardedCount: p.discarded.length } : {}),
      };
    }));
    return {
      id: job.id, state: job.state, total: job.total, done: job.done, failed: job.failed + items.filter((i, n) => i.state === 'failed' && job.items[n].state === 'succeeded').length,
      createdAt: job.createdAt, ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}), items,
    };
  }

  const wrap = async (r: ApiResult<JobView>): Promise<ApiResult<MappingJobStatus>> =>
    r.data === null ? { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The job request failed.' } } : { data: await toStatus(r.data), meta: r.meta };

  return {
    async start(tables, o, enrich) {
      const unique = Array.from(new Set(tables));
      if (unique.length === 0) return fail('NO_CONTEXT', 'Choose at least one table.');
      const items: JobCreateRequest['items'] = [];
      const skipped: string[] = [];
      for (const t of unique) {
        const input = await buildMappingInput(deps, decisions, t, enrich);
        if (!input.ok) { skipped.push(t); continue; }
        const { prompt } = input.value;
        items.push({ id: t, request: { messages: prompt.messages, json: true, maxTokens: prompt.maxTokens, temperature: 0.2, agent: 'agent4-mapping', provider: o?.provider, model: o?.model } });
      }
      if (items.length === 0) return fail('NO_CONTEXT', 'None of the selected tables has unfed columns with source candidates.');
      const r = await gateway.createJob({ kind: 'mapping-ai', label: `Agent 4 mapping: ${items.length} table(s)`, items });
      if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The job could not be started.' } };
      enrichByJob.set(r.data.id, enrich);
      return { data: { jobId: r.data.id }, meta: { ...r.meta, note: skipped.length ? `Skipped ${skipped.length} table(s) with nothing to map: ${skipped.slice(0, 5).join(', ')}` : r.meta.note } };
    },
    async status(jobId) { return wrap(await gateway.getJob(jobId)); },
    async cancel(jobId) { return wrap(await gateway.cancelJob(jobId)); },
    async result(jobId, table) {
      const r = await gateway.getJob(jobId);
      if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The job request failed.' } };
      const item = r.data.items.find((i) => i.id === table);
      if (!item) return fail('NOT_FOUND', `Table ${table} is not part of this job.`);
      if (item.state !== 'succeeded') return fail(item.error?.code ?? 'NOT_READY', item.error?.message ?? `The result for ${table} is not ready (${item.state}).`);
      const p = await parseItem(jobId, item);
      if (!p || 'error' in p) return fail('BAD_OUTPUT', p && 'error' in p ? p.error : 'No result.');
      return { data: p, meta: { ...r.meta, provider: item.provider, model: item.model, note: 'AI proposals checked against the workbook schema and SQL parser. Each is an AI_DRAFT until you approve it.' } };
    },
  };
}
