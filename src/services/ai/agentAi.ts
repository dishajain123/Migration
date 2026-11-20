import { flowExplainPrompt, mappingPrompt, parseInsight, parseMappingInsight, procedureExplainPrompt, tableBriefPrompt, validationReviewPrompt, type PromptSpec } from '@/domain/aiPrompts';
import type { ApiResult, FlowRequest, ReviewedMapping } from '@/types';
import type { AiInsight, CompletionResult, ModelChoice } from '@/types/ai';
import { getProcSources } from '../procSource';
import type { AiGatewayClient } from '../aiGateway';
import type { AgentAiService, Services } from '../types';

type Deps = Pick<Services, 'dataModel' | 'lineage' | 'procedures' | 'mapping' | 'rules'>;

const fail = <T>(code: string, message: string): ApiResult<T> => ({ data: null, meta: { simulated: false, requestId: '', latencyMs: 0 }, error: { code, message } });

/** Unwrap an upstream service result or turn its failure into this call's failure. */
async function need<T>(p: Promise<ApiResult<T>>): Promise<{ ok: true; value: T } | { ok: false; error: ApiResult<never> }> {
  const r = await p;
  if (r.data === null) return { ok: false, error: fail(r.error?.code ?? 'UPSTREAM', r.error?.message ?? 'Could not load the workbook data for this request.') as ApiResult<never> };
  return { ok: true, value: r.data };
}

/**
 * AI features for Agents 1-5. Each method gathers workbook-derived context from the existing agent service, builds a
 * grounded prompt (domain/aiPrompts.ts) and sends it through the AI gateway, which applies the user's active
 * provider and model. Output is parsed and validated; unparseable output is an error, never a guess.
 */
export function createAgentAi(deps: Deps, gateway: AiGatewayClient): AgentAiService {
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
    async rankMappings(table, choice) {
      const unfed = await need(deps.mapping.getUnfed(table)); if (!unfed.ok) return unfed.error;
      const sugg = await need(deps.mapping.getSuggestions(table)); if (!sugg.ok) return sugg.error;
      const analysis = await need(deps.mapping.getAnalysis(table)); if (!analysis.ok) return analysis.error;
      const { prompt, candidateIds } = mappingPrompt({ table, unfed: unfed.value, suggestions: sugg.value, analysis: analysis.value });
      if (candidateIds.size === 0) return fail('NO_CONTEXT', 'No unfed columns with candidate source columns for this table.');
      return run(prompt, 'agent4-mapping', (t) => parseMappingInsight(t, sugg.value, candidateIds), choice);
    },
    async reviewValidation(reviewed: ReviewedMapping[], choice) {
      const rep = await need(deps.rules.validate({ reviewed })); if (!rep.ok) return rep.error;
      if (rep.value.totals.warn + rep.value.totals.fail === 0) return fail('NO_CONTEXT', 'All checks passed; there is nothing to review.');
      return run(validationReviewPrompt(rep.value), 'agent5-rules', parseInsight, choice);
    },
  };
}
