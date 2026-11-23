import type {
  ApprovalMappingRef, ColumnResolution, ConvertedRule, ManualMapping, MappingCandidate, ReviewedMapping, RuleApproval, RuleEdit,
} from '@/types';
import { logicalTable } from './resolve';

/** The reviewer's edits on top of the generated fields (kept local so this module does not depend on templates.ts). */
const fieldsOf = (rule: ConvertedRule, edit: RuleEdit | undefined) => ({ ...rule.traq, ...(edit?.traq ?? {}) });

/*
 * Rule approval -> Agent 4 mappings. Pure logic (no stores, no I/O) so the same rules can later run behind a backend endpoint.
 *
 * Approving a rule never invents a mapping. For every CrisMac column the rule writes or reads it only
 *   - REUSES a mapping that already exists (Agent 4 manual / approved, or a documented workbook row), or
 *   - SAVES the one TRAQ column the resolver found by exact name, or that the reviewer picked among ambiguous candidates,
 *     because approving the rule (after the confirmation dialog lists it) is the reviewer's explicit decision.
 * A rule is NOT eligible when any column is unmapped, only a Simulated suggestion, ambiguous (and not picked), conflicts with an
 * existing mapping, or the expression still has [[...]] placeholders. Nothing is overwritten: conflicts are reported.
 */

/** Issue codes that restate a mapping problem already reported per column. */
const MAPPING_CODES = new Set(['UNMAPPED', 'SUGGESTED', 'NO_TARGET', 'TARGET_SUGGESTED', 'REF_SUGGESTED', 'TARGET_AMBIGUOUS', 'REF_AMBIGUOUS', 'TARGET_NAME_MATCH', 'REF_NAME_MATCH']);
const MAX_ERRORS_SHOWN = 3;

export interface RuleAssessment {
  ruleId: string;
  procedure: string;
  /** `CRISMAC_TABLE.COLUMN` the rule writes, for messages. */
  label: string;
  eligible: boolean;
  /** Plain-language reasons the rule cannot be approved (empty when eligible). */
  blockers: string[];
  mappings: ApprovalMappingRef[];
}

export interface ApprovalPlan {
  eligible: RuleAssessment[];
  ineligible: RuleAssessment[];
  alreadyApproved: string[];
  /** New Agent 4 mappings this approval would save (one per distinct pair; duplicates and reuse excluded). */
  newMappings: ApprovalMappingRef[];
  /** Pairs already covered by an existing mapping. */
  reusedCount: number;
}

export interface ApprovalSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Pending rules that could be approved right now. */
  eligiblePending: number;
  /** Rules not approved or rejected that have at least one blocker. */
  attention: number;
}

interface Ctx {
  /** Agent 4 mappings (manual + approved suggestions) by `${SOURCE_TABLE}.${SOURCE_COLUMN}`. */
  byPair: Map<string, ReviewedMapping[]>;
}

const norm = (s: string) => s.toUpperCase();
export const pairKey = (table: string, column: string) => `${logicalTable(table)}.${norm(column)}`;
const sameTarget = (a: { targetTable: string; targetColumn: string }, b: { targetTable: string; targetColumn: string }) =>
  norm(a.targetTable) === norm(b.targetTable) && norm(a.targetColumn) === norm(b.targetColumn);
const targetText = (t: { targetTable: string; targetColumn: string }) => `${t.targetTable}.${t.targetColumn}`;

export function buildCtx(reviewed: ReviewedMapping[]): Ctx {
  const byPair = new Map<string, ReviewedMapping[]>();
  for (const r of reviewed) {
    const k = pairKey(r.sourceTable, r.sourceColumn);
    byPair.set(k, [...(byPair.get(k) ?? []), r]);
  }
  return { byPair };
}

const hasPlaceholder = (expression: string) => /\[\[(UNMAPPED|PARAM|UNSUPPORTED)/.test(expression);

function evidenceFor(c: MappingCandidate, picked: boolean, count: number): string {
  if (picked) return `Target chosen by the reviewer among ${count} candidate TRAQ columns, confirmed by approving the rule.`;
  switch (c.basis) {
    case 'workbook': return `Documented in the workbook${c.sheet ? `: ${c.sheet} row ${c.rowNo ?? '?'}` : ''}${c.mapType ? ` (${c.mapType})` : ''}.`;
    case 'agent4-manual': return 'Manual mapping already in Agent 4.';
    case 'agent4-approved': return 'Suggestion already approved in Agent 4.';
    case 'name-match': return `Exact same column name in TRAQ (${c.table}.${c.column}), confirmed by approving the rule.`;
    default: return 'Agent 4 heuristic (not a confirmed mapping).';
  }
}

function resolveRef(
  r: ColumnResolution, role: 'writes' | 'reads', edit: RuleEdit | undefined, ctx: Ctx, blockers: string[],
): ApprovalMappingRef | null {
  const label = `${r.crismacTable}.${r.crismacColumn}`;
  let chosen = r.chosen;
  let picked = false;
  if (r.status === 'ambiguous' && role === 'writes') {
    const t = edit?.traq;
    const pick = t?.entity && t.column ? r.candidates.find((c) => c.table === t.entity && c.column === t.column) : undefined;
    if (pick) { chosen = pick; picked = true; }
  }
  if (!picked) {
    if (r.status === 'missing' || !chosen) {
      blockers.push(role === 'writes' ? `${label} has no TRAQ column to write to (not mapped in Agent 4 or the workbook).` : `${label} is not mapped to any TRAQ column. Map it in Agent 4.`);
      return null;
    }
    if (r.status === 'suggested') {
      blockers.push(`${label} only has a Simulated suggestion (${chosen.table}.${chosen.column}, ${chosen.confidence ?? '?'}% confidence). Confirm it in Agent 4 first.`);
      return null;
    }
    if (r.status === 'ambiguous') {
      const names = r.candidates.slice(0, 3).map((c) => `${c.table}.${c.column}`).join(', ');
      blockers.push(`${label} could map to ${new Set(r.candidates.map((c) => `${c.table}.${c.column}`)).size} TRAQ columns (${names}${r.candidates.length > 3 ? ', ...' : ''}). ${role === 'writes' ? 'Pick one in the rule\'s target selector' : 'Map it in Agent 4'}.`);
      return null;
    }
  }
  if (!chosen) return null;
  const existing = ctx.byPair.get(pairKey(r.crismacTable, r.crismacColumn)) ?? [];
  const conflict = existing.find((m) => !sameTarget(m, { targetTable: chosen.table, targetColumn: chosen.column }));
  const match = existing.find((m) => sameTarget(m, { targetTable: chosen.table, targetColumn: chosen.column }));
  if (conflict && !match) {
    blockers.push(`${label} -> ${chosen.table}.${chosen.column} conflicts with the Agent 4 mapping to ${targetText(conflict)}. Remove or correct one of them in Agent 4; nothing is overwritten.`);
    return null;
  }
  const decision = picked || chosen.basis === 'name-match';
  return {
    key: label, role, sourceTable: r.crismacTable, sourceColumn: r.crismacColumn,
    targetTable: chosen.table, targetColumn: chosen.column, targetType: chosen.dataType,
    basis: chosen.basis, action: decision && !match ? 'created' : 'reused', mappingId: match?.id,
    evidence: evidenceFor(chosen, picked, r.candidates.length),
  };
}

export function assessRule(rule: ConvertedRule, edit: RuleEdit | undefined, ctx: Ctx): RuleAssessment {
  const blockers: string[] = [];
  const mappings: ApprovalMappingRef[] = [];
  const add = (m: ApprovalMappingRef | null) => { if (m && !mappings.some((x) => x.key === m.key)) mappings.push(m); };
  add(resolveRef(rule.target, 'writes', edit, ctx, blockers));
  for (const r of rule.references) add(resolveRef(r, 'reads', edit, ctx, blockers));

  const f = fieldsOf(rule, edit);
  if (/\[\[(PARAM|UNSUPPORTED)/.test(f.expression)) blockers.push('The TRAQ expression still contains [[PARAM]] or [[UNSUPPORTED]] placeholders (a parameter with no value or SQL without a TRAQ form).');
  if (!edit?.traq?.expression) {
    const errors = rule.issues.filter((i) => i.severity === 'error' && !MAPPING_CODES.has(i.code));
    errors.slice(0, MAX_ERRORS_SHOWN).forEach((i) => blockers.push(i.message));
    if (errors.length > MAX_ERRORS_SHOWN) blockers.push(`${errors.length - MAX_ERRORS_SHOWN} more error(s) in the conversion issues.`);
  }
  return { ruleId: rule.id, procedure: rule.procedure, label: `${rule.crismacTable}.${rule.crismacColumn}`, eligible: blockers.length === 0, blockers, mappings: blockers.length ? [] : mappings };
}

/** What approving `ids` would do, without changing anything (feeds the confirmation dialog and the commit). */
export function planApproval(rules: ConvertedRule[], ids: string[], edits: Record<string, RuleEdit>, reviewed: ReviewedMapping[]): ApprovalPlan {
  const ctx = buildCtx(reviewed);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const plan: ApprovalPlan = { eligible: [], ineligible: [], alreadyApproved: [], newMappings: [], reusedCount: 0 };
  const claimed = new Map<string, { target: string; rule: string }>();
  const created = new Map<string, ApprovalMappingRef>();
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rule = byId.get(id);
    if (!rule) continue;
    if (edits[id]?.decision === 'approved') { plan.alreadyApproved.push(id); continue; }
    const a = assessRule(rule, edits[id], ctx);
    if (a.eligible) {
      // two rules of the same batch must not ask for different targets for one CrisMac column
      for (const m of a.mappings) {
        const prior = claimed.get(m.key);
        const t = norm(targetText(m));
        if (prior && prior.target !== t) a.blockers.push(`${m.key} -> ${targetText(m)} conflicts with ${prior.target} chosen for another rule in this batch (${prior.rule}).`);
      }
      a.eligible = a.blockers.length === 0;
      if (!a.eligible) a.mappings = [];
    }
    if (!a.eligible) { plan.ineligible.push(a); continue; }
    for (const m of a.mappings) {
      claimed.set(m.key, { target: norm(targetText(m)), rule: a.label });
      const dedupe = `${m.key}>${norm(targetText(m))}`;
      if (m.action === 'created') { if (!created.has(dedupe)) created.set(dedupe, m); } else plan.reusedCount++;
    }
    plan.eligible.push(a);
  }
  plan.newMappings = Array.from(created.values());
  return plan;
}

/** Every rule's assessment, computed once (the Review table shows blockers per row and the roll-up counts). */
export function assessAll(rules: ConvertedRule[], edits: Record<string, RuleEdit>, reviewed: ReviewedMapping[]): Map<string, RuleAssessment> {
  const ctx = buildCtx(reviewed);
  return new Map(rules.map((r) => [r.id, assessRule(r, edits[r.id], ctx)]));
}

export function summarize(rules: ConvertedRule[], edits: Record<string, RuleEdit>, assessments: Map<string, RuleAssessment>): ApprovalSummary {
  const s: ApprovalSummary = { total: rules.length, approved: 0, rejected: 0, pending: 0, eligiblePending: 0, attention: 0 };
  for (const r of rules) {
    const d = edits[r.id]?.decision;
    if (d === 'approved') { s.approved++; continue; }
    if (d === 'rejected') { s.rejected++; continue; }
    s.pending++;
    if (assessments.get(r.id)?.eligible) s.eligiblePending++; else s.attention++;
  }
  return s;
}

export function approvalSummary(rules: ConvertedRule[], edits: Record<string, RuleEdit>, reviewed: ReviewedMapping[]): ApprovalSummary {
  return summarize(rules, edits, assessAll(rules, edits, reviewed));
}

export interface ApplyResult {
  manualMappings: ManualMapping[];
  approvals: Record<string, RuleApproval>;
  created: number;
  reused: number;
}

const autoId = (m: ApprovalMappingRef) => `manual:auto:${m.key}>${norm(m.targetTable)}.${norm(m.targetColumn)}`;
const withRule = (ids: string[] | undefined, id: string) => (ids?.includes(id) ? ids : [...(ids ?? []), id]);

/**
 * Pure state transition for an approved plan: saves the new mappings (never a duplicate of an existing pair), links every
 * reused mapping to the rule, and records the approval with its evidence. Existing mappings are never modified except for
 * the rule link.
 */
export function applyPlan(
  manual: ManualMapping[], approvals: Record<string, RuleApproval>, plan: ApprovalPlan, meta: { via: RuleApproval['via']; comment: string; at: string },
): ApplyResult {
  let list = manual.map((m) => ({ ...m }));
  const nextApprovals = { ...approvals };
  let created = 0;
  let reused = 0;
  for (const a of plan.eligible) {
    const refs: ApprovalMappingRef[] = [];
    for (const m of a.mappings) {
      const existing = list.find((x) => pairKey(x.sourceTable, x.sourceColumn) === m.key && sameTarget(x, { targetTable: m.targetTable, targetColumn: m.targetColumn }));
      if (existing) {
        existing.ruleIds = withRule(existing.ruleIds, a.ruleId);
        reused++;
        refs.push({ ...m, action: 'reused', mappingId: existing.id });
      } else if (m.action === 'created') {
        const entry: ManualMapping = {
          id: autoId(m), targetTable: m.targetTable, targetColumn: m.targetColumn, targetType: m.targetType,
          sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, sourceType: '',
          note: m.evidence, createdAt: meta.at, origin: 'rule-approval', ruleIds: [a.ruleId], evidence: m.evidence, basis: m.basis,
        };
        list = [...list, entry];
        created++;
        refs.push({ ...m, action: 'created', mappingId: entry.id });
      } else {
        reused++;
        refs.push(m);
      }
    }
    nextApprovals[a.ruleId] = { ruleId: a.ruleId, at: meta.at, via: meta.via, comment: meta.comment, mappings: refs };
  }
  return { manualMappings: list, approvals: nextApprovals, created, reused };
}

/** Drop approval records (rule rejected, reset or re-validated). The mappings stay in Agent 4; only their rule link is removed. */
export function withdraw(manual: ManualMapping[], approvals: Record<string, RuleApproval>, ruleIds: string[]): { manualMappings: ManualMapping[]; approvals: Record<string, RuleApproval> } {
  const drop = new Set(ruleIds);
  const next = { ...approvals };
  for (const id of drop) delete next[id];
  return {
    manualMappings: manual.map((m) => (m.ruleIds?.some((id) => drop.has(id)) ? { ...m, ruleIds: m.ruleIds.filter((id) => !drop.has(id)) } : m)),
    approvals: next,
  };
}

/** Approved rules that rely on the mapping `mappingId` (to re-validate them when it is removed). */
export function rulesDependingOn(approvals: Record<string, RuleApproval>, manual: ManualMapping[], mappingId: string): string[] {
  const out = new Set<string>(manual.find((m) => m.id === mappingId)?.ruleIds ?? []);
  for (const a of Object.values(approvals)) if (a.mappings.some((m) => m.mappingId === mappingId)) out.add(a.ruleId);
  return Array.from(out);
}

/** Why a rule is not Ready for TRAQ (empty = ready): approval plus fully confirmed mappings and a clean expression. */
export function exportBlockers(rule: ConvertedRule, edit: RuleEdit | undefined): string[] {
  const out: string[] = [];
  if (edit?.decision === 'rejected') return ['Rejected'];
  if (edit?.decision !== 'approved') out.push('Not approved yet');
  const cols: { writes: boolean; r: ColumnResolution }[] = [{ writes: true, r: rule.target }, ...rule.references.map((r) => ({ writes: false, r }))];
  for (const { writes, r } of cols) {
    if (r.status === 'approved' || r.status === 'documented') continue;
    const what = r.status === 'name-match' ? 'name match only, not yet confirmed' : r.status === 'missing' ? 'not mapped' : r.status === 'suggested' ? 'Simulated suggestion only' : 'ambiguous';
    out.push(`${writes ? 'Writes' : 'Reads'} ${r.crismacTable}.${r.crismacColumn}: ${what}`);
  }
  const f = fieldsOf(rule, edit);
  if (hasPlaceholder(f.expression)) out.push('Expression still has [[...]] placeholders');
  if (rule.status === 'failed' && !edit?.traq?.expression) out.push('Conversion failed and was not corrected by hand');
  return out;
}
