import { mappingPrompt, type PromptSpec } from '@/domain/aiPrompts';
import { candidateSchema } from '@/domain/mappingContext';
import { parseMappingProposals } from '@/domain/mappingProposals';
import { transformationExamples } from '@/domain/transformExamples';
import { validateTransformation } from '@/domain/transformValidator';
import type { ApiResult, Suggestion, WorkbookModel } from '@/types';
import type { MappingProposalSet } from '@/types/mappingAi';
import type { EnrichmentOptions } from '@/types/profile';
import { getProcSources } from '../procSource';
import type { MappingDecisionService, Services } from '../types';
import { fail, need } from './util';

/** Everything needed to ask the model about one target table and to validate its answer. Shared by the single-table and bulk-job paths. */
export interface MappingInput {
  table: string;
  prompt: PromptSpec;
  suggestions: Suggestion[];
  offered: Set<string>;
  model: WorkbookModel;
}

type Deps = Pick<Services, 'dataModel' | 'mapping'>;

export async function buildMappingInput(
  deps: Deps, decisions: MappingDecisionService | undefined, table: string, enrich?: EnrichmentOptions,
): Promise<{ ok: true; value: MappingInput } | { ok: false; error: ApiResult<never> }> {
  const unfed = await need(deps.mapping.getUnfed(table)); if (!unfed.ok) return unfed;
  const sugg = await need(deps.mapping.getSuggestions(table, enrich)); if (!sugg.ok) return sugg;
  const analysis = await need(deps.mapping.getAnalysis(table, undefined, enrich)); if (!analysis.ok) return analysis;
  const meta = await need(deps.dataModel.exportMetadata()); if (!meta.ok) return meta;
  const schema = candidateSchema(meta.value, table);
  // Few-shot context is optional: without the sample SQL or any stored decisions the prompt simply says so.
  const procs = await getProcSources().catch(() => undefined);
  const stored = decisions ? (await decisions.list()).data ?? undefined : undefined;
  const { examples, decisionNotes } = transformationExamples(meta.value, table, procs, stored);
  const { prompt, candidateIds } = mappingPrompt({ table, unfed: unfed.value, suggestions: sugg.value, analysis: analysis.value, schema, profile: enrich?.profile, examples, decisionNotes });
  if (unfed.value.length === 0 || (candidateIds.size === 0 && schema.length === 0)) return { ok: false, error: fail('NO_CONTEXT', `No unfed columns with candidate source columns for ${table}.`) as ApiResult<never> };
  return { ok: true, value: { table, prompt, suggestions: sugg.value, offered: candidateIds, model: meta.value } };
}

/** Parse the model's text: heuristic picks, schema-validated discoveries, and parser-validated transformations (AI_DRAFT). */
export function parseMappingOutput(input: MappingInput, text: string): MappingProposalSet | null {
  return parseMappingProposals(text, {
    table: input.table, suggestions: input.suggestions, offered: input.offered, model: input.model,
    validateTransformation: (t) => validateTransformation({ ...t, model: input.model }),
  });
}
