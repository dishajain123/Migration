import type { Suggestion, WorkbookModel } from '@/types';
import type { AiInsight } from '@/types/ai';
import type { AiMappingProposal, DiscardedProposal, MappingProposalSet, ProposalSource } from '@/types/mappingAi';
import { extractJson } from './jsonExtract';
import { validateCandidateMapping } from './mappingValidator';

/*
 * "LLM proposes, validator checks". The model may name a heuristic candidate OR any column from the schema listing it was
 * given (so it can find matches with different names, many-to-one and one-to-many). Every proposal then passes the
 * deterministic `validateCandidateMapping`; anything naming a table/column that does not exist, or with an incompatible
 * type, never reaches the reviewer. Survivors are AI_DRAFT: nothing is applied until a human approves it.
 */

export interface TransformationCheck { valid: boolean; checks: string[]; problems: string[] }

export interface ProposalParseInput {
  table: string;
  /** Heuristic candidates, looked up by id when the model answers with a `candidateId`. */
  suggestions: Suggestion[];
  /** Candidate ids that were actually shown to the model. */
  offered: Set<string>;
  /** The parsed workbook. Without it only heuristic candidates can be surfaced (nothing else can be verified). */
  model?: WorkbookModel;
  /** Validates a transformation expression (Phase 4). Without it any transformation is dropped as unverified. */
  validateTransformation?: (t: { expression: string; target: { table: string; column: string }; sources: ProposalSource[] }) => TransformationCheck;
}

export const NOT_OFFERED = 'the model named a candidate that was not offered';
const MAX_SOURCES = 5;
const MAX_TRANSFORMATION = 600;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const label = (s: ProposalSource) => `${s.table}.${s.column}`;

function readSources(v: unknown): ProposalSource[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_SOURCES) return null;
  const out: ProposalSource[] = [];
  for (const s of v) {
    if (!isObj(s) || typeof s.table !== 'string' || typeof s.column !== 'string' || !s.table.trim() || !s.column.trim()) return null;
    out.push({ table: s.table.trim(), column: s.column.trim() });
  }
  return out;
}

export function parseMappingProposals(text: string, input: ProposalParseInput): MappingProposalSet | null {
  const o = extractJson(text);
  if (!isObj(o) || !Array.isArray(o.picks)) return null;
  const byId = new Map(input.suggestions.map((s) => [s.id, s]));
  const proposals: AiMappingProposal[] = [];
  const discarded: DiscardedProposal[] = [];
  const seen = new Set<string>();

  for (const raw of o.picks as unknown[]) {
    if (!isObj(raw)) { discarded.push({ targetColumn: '?', reason: 'not an object' }); continue; }
    const targetColumn = typeof raw.targetColumn === 'string' ? raw.targetColumn.trim() : '';
    let sources: ProposalSource[] | null = null;
    let origin: AiMappingProposal['origin'] = 'heuristic-candidate';
    let heuristicTarget = targetColumn;
    let targetType = '';
    if (typeof raw.candidateId === 'string') {
      const s = input.offered.has(raw.candidateId) ? byId.get(raw.candidateId) : undefined;
      if (!s) { discarded.push({ targetColumn: targetColumn || '?', reason: NOT_OFFERED }); continue; }
      sources = [{ table: s.sourceTable, column: s.sourceColumn, type: s.sourceType }];
      heuristicTarget = s.targetColumn;
      targetType = s.targetType;
    } else if (raw.sources !== undefined) {
      sources = readSources(raw.sources);
      origin = 'ai-discovered';
      if (!sources) { discarded.push({ targetColumn: targetColumn || '?', reason: `"sources" must list 1-${MAX_SOURCES} { table, column } objects` }); continue; }
    }
    if (!sources || !heuristicTarget) { discarded.push({ targetColumn: targetColumn || '?', reason: 'no candidateId or sources given' }); continue; }
    if (!input.model && origin === 'ai-discovered') { discarded.push({ targetColumn: heuristicTarget, source: sources.map(label).join(' + '), reason: 'cannot be verified without the workbook schema' }); continue; }

    const warnings: string[] = [];
    let resolvedTarget = heuristicTarget;
    let resolvedSources = sources;
    if (input.model) {
      const results = sources.map((s) => validateCandidateMapping(input.model as WorkbookModel, {
        targetTable: input.table, targetColumn: heuristicTarget, sourceTable: s.table, sourceColumn: s.column, origin: 'llm',
      }));
      const bad = results.find((r) => !r.valid);
      if (bad) {
        discarded.push({ targetColumn: heuristicTarget, source: sources.map(label).join(' + '), reason: bad.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' ') });
        continue;
      }
      resolvedSources = results.map((r, i) => (r.resolved ? { table: r.resolved.sourceTable, column: r.resolved.sourceColumn, type: r.resolved.sourceType } : sources[i]));
      resolvedTarget = results[0].resolved?.targetColumn ?? heuristicTarget;
      targetType = results[0].resolved?.targetType ?? targetType;
      for (const r of results) for (const i of r.issues) if (i.severity === 'warning' && !warnings.includes(i.message)) warnings.push(i.message);
    }

    const id = `ai:${input.table}.${resolvedTarget}<-${resolvedSources.map(label).join('+')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (resolvedSources.length > 1 && !(typeof raw.transformation === 'string' && raw.transformation.trim())) {
      warnings.push('Several sources were proposed without a transformation that says how they combine.');
    }

    let transformation: AiMappingProposal['transformation'];
    const expr = typeof raw.transformation === 'string' ? raw.transformation.trim().slice(0, MAX_TRANSFORMATION) : '';
    if (expr) {
      if (!input.validateTransformation) {
        discarded.push({ targetColumn: resolvedTarget, source: expr, reason: 'transformation dropped: no parser available to verify it' });
      } else {
        const t = input.validateTransformation({ expression: expr, target: { table: input.table, column: resolvedTarget }, sources: resolvedSources });
        if (t.valid) transformation = { text: expr, status: 'AI_DRAFT', checks: t.checks };
        else discarded.push({ targetColumn: resolvedTarget, source: expr, reason: `transformation dropped: ${t.problems.join('; ')}` });
      }
    }

    const conf = typeof raw.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(raw.confidence))) : null;
    proposals.push({
      id, targetTable: input.table, targetColumn: resolvedTarget, targetType, sources: resolvedSources, origin, confidence: conf,
      reason: typeof raw.reason === 'string' ? raw.reason : 'no reason given',
      ...(transformation ? { transformation } : {}),
      validation: warnings.length ? 'valid_with_warnings' : 'valid', warnings, status: 'AI_DRAFT',
    });
  }

  // Relations between proposals: alternatives for one target, one source serving several targets.
  const note = (p: AiMappingProposal, w: string) => { if (!p.warnings.includes(w)) p.warnings.push(w); p.validation = 'valid_with_warnings'; };
  for (const p of proposals) {
    const rivals = proposals.filter((q) => q !== p && q.targetColumn.toUpperCase() === p.targetColumn.toUpperCase());
    if (rivals.length) note(p, `${rivals.length + 1} different proposals exist for ${p.targetColumn}; a human must choose one.`);
    for (const s of p.sources) {
      const also = proposals.filter((q) => q !== p && q.targetColumn !== p.targetColumn && q.sources.some((x) => label(x).toUpperCase() === label(s).toUpperCase()));
      if (also.length) note(p, `One-to-many: ${label(s)} is also proposed for ${also.map((q) => q.targetColumn).join(', ')}.`);
    }
  }

  const unresolved = (Array.isArray(o.unresolved) ? o.unresolved : []).map((u: unknown) => ({
    targetColumn: String(isObj(u) ? u.targetColumn ?? '?' : '?'), reason: String(isObj(u) ? u.reason ?? 'no plausible candidate' : 'no plausible candidate'),
  }));
  return { table: input.table, proposals, unresolved, discarded };
}

/** AiInsight form (summary + sections) of a proposal set, for panels that only render text. `tagged` adds the AI_DRAFT / warning tags. */
export function formatProposalInsight(set: MappingProposalSet, tagged: boolean): AiInsight {
  const line = (p: AiMappingProposal) => {
    const conf = p.confidence === null ? '' : ` (AI-estimated ${p.confidence}%)`;
    const tag = tagged ? ` [AI_DRAFT${p.warnings.length ? `; ${p.warnings.length} warning(s)` : ''}]` : '';
    const tr = p.transformation ? ` | transformation (AI_DRAFT): ${p.transformation.text}` : '';
    return `${p.targetColumn} <- ${p.sources.map(label).join(' + ')}${conf}${tag}: ${p.reason}${tr}`;
  };
  const heuristic = set.proposals.filter((p) => p.origin === 'heuristic-candidate');
  const discovered = set.proposals.filter((p) => p.origin === 'ai-discovered');
  const sections: AiInsight['sections'] = [];
  if (heuristic.length) sections.push({ title: 'Recommended mappings', points: heuristic.map(line) });
  if (discovered.length) sections.push({ title: 'Found beyond the heuristic candidates (validated against the schema)', points: discovered.map(line) });
  const warn = set.proposals.flatMap((p) => p.warnings.map((w) => `${p.targetColumn}: ${w}`));
  if (warn.length) sections.push({ title: 'Validator warnings', points: warn.slice(0, 20) });
  const dropped = set.discarded.filter((d) => d.reason !== NOT_OFFERED);
  if (dropped.length) sections.push({ title: 'Discarded by the validator', points: dropped.slice(0, 20).map((d) => `${d.targetColumn}${d.source ? ` <- ${d.source}` : ''}: ${d.reason}`) });
  if (set.unresolved.length) sections.push({ title: 'No plausible candidate', points: set.unresolved.map((u) => `${u.targetColumn}: ${u.reason}`) });
  const notOffered = set.discarded.filter((d) => d.reason === NOT_OFFERED).length;
  const rejected = dropped.length;
  return {
    summary: `${set.proposals.length} recommendation(s) among the heuristic candidates${discovered.length ? ` and ${discovered.length} found beyond them (validated against the schema)` : ''}; ${set.unresolved.length} unresolved`
      + `${notOffered ? `; ${notOffered} discarded because ${NOT_OFFERED}` : ''}${rejected ? `; ${rejected} discarded by the validator` : ''}. Recommendations are not applied until a human approves them.`,
    sections,
  };
}
