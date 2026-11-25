import { flowExplainPrompt, parseInsight, procedureExplainPrompt, tableBriefPrompt, validationReviewPrompt, type PromptSpec } from '@/domain/aiPrompts';
import { buildEmbeddingIndex as buildIndex, embeddingObjects } from '@/domain/embeddingObjects';
import { formatProposalInsight } from '@/domain/mappingProposals';
import type { ApiResult, FlowRequest, ReviewedMapping } from '@/types';
import type { AiInsight, CompletionResult, ModelChoice } from '@/types/ai';
import type { MappingProposalSet } from '@/types/mappingAi';
import type { EnrichmentOptions } from '@/types/profile';
import { getProcSources } from '../procSource';
import type { AiGatewayClient } from '../aiGateway';
import type { AgentAiService, MappingDecisionService, Services } from '../types';
import { buildMappingInput, parseMappingOutput } from './mappingInput';
import { fail, need } from './util';

type Deps = Pick<Services, 'dataModel' | 'lineage' | 'procedures' | 'mapping' | 'rules'>;

/** Texts per embedding request (the gateway accepts up to 500). */
const EMBED_BATCH = 400;

/**
 * AI features for Agents 1-5. Each method gathers workbook-derived context from the existing agent service, builds a
 * grounded prompt (domain/aiPrompts.ts) and sends it through the AI gateway, which applies the user's active
 * provider and model. Output is parsed and validated; unparseable output is an error, never a guess.
 */
export function createAgentAi(deps: Deps, gateway: AiGatewayClient, decisions?: MappingDecisionService): AgentAiService {
  async function run(prompt: PromptSpec, agent: string, parse: (text: string) => AiInsight | null, o?: ModelChoice): Promise<ApiResult<AiInsight>> {
    const r = await gateway.complete({ messages: prompt.messages, json: true, maxTokens: prompt.maxTokens, temperature: 0.2, agent, provider: o?.provider, model: o?.model });
    if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The AI request failed.' } };
    return finish(r.data, r.meta, parse);
  }
  const finish = (c: CompletionResult, meta: ApiResult<unknown>['meta'], parse: (t: string) => AiInsight | null): ApiResult<AiInsight> => {
    const insight = parse(c.text);
    if (!insight) return { data: null, meta, error: { code: 'BAD_OUTPUT', message: 'The model did not return the expected JSON. Try again, or choose a model that follows JSON instructions in AI Settings.' } };
    return { data: insight, meta: { ...meta, provider: c.provider, model: c.model, note: 'AI-generated from workbook context. Verify before relying on it.' } };
  };

  /**
   * Gather workbook context (plus few-shot examples and earlier human decisions), ask the model, then validate every
   * proposal against the schema and every transformation with the SQL parser. Survivors are AI_DRAFT.
   */
  async function propose(table: string, choice?: ModelChoice, enrich?: EnrichmentOptions): Promise<ApiResult<MappingProposalSet>> {
    const input = await buildMappingInput(deps, decisions, table, enrich); if (!input.ok) return input.error;
    const { prompt } = input.value;
    const r = await gateway.complete({ messages: prompt.messages, json: true, maxTokens: prompt.maxTokens, temperature: 0.2, agent: 'agent4-mapping', provider: choice?.provider, model: choice?.model });
    if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The AI request failed.' } };
    const set = parseMappingOutput(input.value, r.data.text);
    if (!set) return { data: null, meta: r.meta, error: { code: 'BAD_OUTPUT', message: 'The model did not return the expected JSON. Try again, or choose a model that follows JSON instructions in AI Settings.' } };
    return { data: set, meta: { ...r.meta, provider: r.data.provider, model: r.data.model, note: 'AI proposals checked against the workbook schema and SQL parser. Each is an AI_DRAFT until you approve it.' } };
  }

  return {
    async briefTable(name, choice) {
      const t = await need(deps.dataModel.getTable(name)); if (!t.ok) return t.error;
      const rels = await need(deps.dataModel.getRelationships(name)); if (!rels.ok) return rels.error;
      return run(tableBriefPrompt(t.value, rels.value), 'agent1-data-model', parseInsight, choice);
    },
    async explainFlow(req: FlowRequest, choice) {
      const f = await need(deps.lineage.getFlow(req)); if (!f.ok) return f.error;
      if (f.value.columnEdges.length === 0 && f.value.tableEdges.length === 0) return fail('NO_CONTEXT', 'The current selection has no mappings to explain.');
      return run(flowExplainPrompt(f.value), 'agent2-lineage', parseInsight, choice);
    },
    async explainProcedure(objectId, choice) {
      const objs = await need(deps.procedures.listObjects()); if (!objs.ok) return objs.error;
      const o = objs.value.find((x) => x.id === objectId);
      if (!o) return fail('NOT_FOUND', 'Object not found.');
      const short = o.name.replace(/^PRO\./i, '').toLowerCase();
      const src = await getProcSources().then((l) => l.find((p) => p.name.toLowerCase() === short)).catch(() => undefined);
      return run(procedureExplainPrompt(o, src), 'agent3-procedures', parseInsight, choice);
    },
    async explainSourceProcedure(name, choice) {
      const srcs = await need(deps.procedures.listSources()); if (!srcs.ok) return srcs.error;
      const src = srcs.value.find((p) => p.name === name);
      if (!src) return fail('NOT_FOUND', 'Procedure not found.');
      const objs = await need(deps.procedures.listObjects()); if (!objs.ok) return objs.error;
      const o = objs.value.find((x) => x.name.replace(/^PRO\./i, '').toLowerCase() === src.name.toLowerCase())
        ?? { id: src.id, name: src.name, kind: 'crismac-procedure' as const, references: [], sheets: [], operations: [], mentionedTables: [], related: [], sqlProvided: false as const };
      return run(procedureExplainPrompt(o, src), 'agent3-procedures', parseInsight, choice);
    },
    proposeMappings: propose,
    async rankMappings(table, choice, enrich) {
      const r = await propose(table, choice, enrich);
      if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The AI request failed.' } };
      return { data: formatProposalInsight(r.data, true), meta: r.meta };
    },
    async buildEmbeddingIndex(table, profile) {
      const m = await need(deps.dataModel.exportMetadata()); if (!m.ok) return m.error;
      const objects = embeddingObjects(m.value, table, profile);
      if (objects.length === 0) return fail('NO_CONTEXT', 'This table has no columns to embed.');
      const vectors: number[][] = [];
      let modelName = '';
      let meta: ApiResult<unknown>['meta'] | undefined;
      for (let i = 0; i < objects.length; i += EMBED_BATCH) {
        const r = await gateway.embed(objects.slice(i, i + EMBED_BATCH).map((o) => o.text));
        if (r.data === null) return { data: null, meta: r.meta, error: r.error ?? { code: 'PROVIDER_ERROR', message: 'The embedding request failed.' } };
        modelName = r.data.model; meta = r.meta; vectors.push(...r.data.vectors);
      }
      return { data: buildIndex(objects, vectors, modelName, profile), meta: { ...(meta as ApiResult<unknown>['meta']), note: 'Embeddings of column names, types and profile descriptions/statistics were requested from your embedding provider.' } };
    },
    async reviewValidation(reviewed: ReviewedMapping[], choice) {
      const rep = await need(deps.rules.validate({ reviewed })); if (!rep.ok) return rep.error;
      if (rep.value.totals.warn + rep.value.totals.fail === 0) return fail('NO_CONTEXT', 'All checks passed; there is nothing to review.');
      return run(validationReviewPrompt(rep.value), 'agent5-rules', parseInsight, choice);
    },
  };
}
