import type { ConvertedRule, WorkbookModel } from '@/types';
import { spec, type PromptSpec } from '../aiPrompts';
import { extractJson } from '../jsonExtract';
import { coverageColumns, isLoadPathTable } from '../selectors';
import { compat } from '../typeUtils';
import type { ColumnGap } from './gaps';

/*
 * "LLM proposes, validator checks" for the CrisMac columns that block rules (see gaps.ts). The model is shown each unmapped
 * CrisMac column with the rule logic that uses it, how the workbook already maps the same CrisMac table, and the in-scope
 * TRAQ columns it may choose from. Its answer is then checked here: a pick naming a TRAQ column that is not in that list, a
 * traqOnly column, a type-incompatible pair, or a TRAQ column already taken by another gap is DROPPED, never repaired. What
 * survives is an AI draft: nothing is saved until a person accepts it (the UI saves it as an Agent 4 manual mapping).
 */

/** Bounds the prompt: beyond this many TRAQ columns the listing is cut and says so. */
export const MAX_GAP_CANDIDATES = 700;
const MAX_GAPS = 60;
const MAX_EXAMPLES = 14;

export interface GapMappingProposal {
  gapKey: string;
  crismacTable: string;
  crismacColumn: string;
  traqTable: string;
  traqColumn: string;
  traqType: string;
  /** The model's own estimate (1-99). Not calibrated. */
  confidence: number;
  reason: string;
  /** Result of the deterministic type check. 'unknown' = the workbook has no CrisMac type for the column. */
  typeCheck: 'compatible' | 'warn' | 'unknown';
  typeNote: string;
}

export interface GapMappingSet {
  proposals: GapMappingProposal[];
  /** Picks that failed validation, with the reason (kept visible so nothing disappears silently). */
  rejected: { gapKey: string; traq: string; reason: string }[];
  /** Gaps the model said it could not map (or did not answer). */
  unresolved: { gapKey: string; reason: string }[];
  asked: number;
}

export interface GapMappingInput {
  prompt: PromptSpec;
  gaps: ColumnGap[];
  /** Upper-cased `TABLE.COLUMN` -> the TRAQ column the model may pick. */
  pool: Map<string, { table: string; column: string; type: string }>;
  model: WorkbookModel;
}

const up = (s: string) => s.toUpperCase();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

function crismacType(model: WorkbookModel, table: string, column: string): string {
  const t = model.tables.find((x) => x.system !== 'TRAQ' && up(x.name) === up(table));
  return t?.columns.find((c) => up(c.name) === up(column))?.dataType ?? '';
}

/** TRAQ columns a gap may map to: tables the rules already resolve to first (their own entity), then every other load-path table. */
export function gapCandidatePool(model: WorkbookModel, rules: ConvertedRule[]): { pool: GapMappingInput['pool']; shown: number; total: number; listing: string } {
  const touched = new Set<string>();
  for (const r of rules) {
    if (r.target.chosen) touched.add(up(r.target.chosen.table));
    for (const x of r.references) if (x.chosen) touched.add(up(x.chosen.table));
  }
  const tables = model.tables.filter(isLoadPathTable).sort((a, b) => Number(touched.has(up(b.name))) - Number(touched.has(up(a.name))) || a.name.localeCompare(b.name));
  const pool: GapMappingInput['pool'] = new Map();
  const blocks: string[] = [];
  let total = 0;
  for (const t of tables) total += coverageColumns(t).length;
  let shown = 0;
  for (const t of tables) {
    const room = MAX_GAP_CANDIDATES - shown;
    if (room <= 0) break;
    const cols = coverageColumns(t).slice(0, room);
    if (cols.length === 0) continue;
    shown += cols.length;
    for (const c of cols) pool.set(`${up(t.name)}.${up(c.name)}`, { table: t.name, column: c.name, type: c.dataType });
    blocks.push(`${t.name}${touched.has(up(t.name)) ? ' (used by these rules)' : ''}\n${cols.map((c) => `  - ${c.name} ${c.dataType || '(type not provided)'}`).join('\n')}`);
  }
  return { pool, shown, total, listing: blocks.join('\n') };
}

/** Lines of the original CrisMac logic that mention the column (the evidence for what it means). */
function usage(gap: ColumnGap, rulesById: Map<string, ConvertedRule>): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${gap.crismacColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  for (const ref of gap.rules) {
    const rule = rulesById.get(ref.ruleId);
    if (!rule) continue;
    const line = rule.crismacLogic.split('\n').find((l) => re.test(l));
    if (line) out.push(`${ref.label} (${ref.role}): ${clip(line.trim(), 200)}`);
    if (out.length >= 2) break;
  }
  return out;
}

/** How the workbook already maps columns of the same CrisMac table: the strongest evidence of this bank's naming. */
function workbookExamples(model: WorkbookModel, gaps: ColumnGap[]): string[] {
  const tables = new Set(gaps.map((g) => up(g.crismacTable)));
  const out: string[] = [];
  for (const m of model.mappings) {
    if (out.length >= MAX_EXAMPLES) break;
    if (!m.sourceColumn || !m.targetTable || !m.targetColumn || !tables.has(up(m.sourceTable))) continue;
    out.push(`${m.sourceTable}.${m.sourceColumn} -> ${m.targetTable}.${m.targetColumn} (${m.mapType || 'no map type'}, ${m.sheet} row ${m.rowNo})`);
  }
  return out;
}

const SCHEMA = [
  'JSON schema: {"picks": [{"gap": string (the gap id copied exactly), "traqTable": string, "traqColumn": string (both copied exactly from TRAQ COLUMNS),',
  '"confidence": integer 0-100, "reason": string (one sentence naming the evidence)}], "unresolved": [{"gap": string, "reason": string}]}.',
  'Pick a TRAQ column only when the name, data type, the rule logic that uses the column and the documented examples support it. Never pick a column that is not in TRAQ COLUMNS',
  '(it is discarded automatically). Different CrisMac columns must not share one TRAQ column. If nothing is clearly right, put the gap in "unresolved": a missing mapping is better than a wrong one.',
].join(' ');

export function buildGapMappingInput(model: WorkbookModel, gaps: ColumnGap[], rules: ConvertedRule[]): GapMappingInput | null {
  const picked = gaps.slice(0, MAX_GAPS);
  if (picked.length === 0) return null;
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const { pool, shown, total, listing } = gapCandidatePool(model, rules);
  if (pool.size === 0) return null;
  const gapBlock = picked.map((g) => {
    const type = crismacType(model, g.crismacTable, g.crismacColumn);
    const lines = usage(g, rulesById);
    return [
      `- gap=${g.key}: ${g.crismacTable}.${g.crismacColumn} (CrisMac type: ${type || 'not provided in workbook'}; ${g.writtenBy} rule(s) write it, ${g.readBy} read it; status: ${g.kind})`,
      g.suggestion ? `   heuristic suggestion (unverified): ${g.suggestion}` : '',
      ...lines.map((l) => `   used in ${l}`),
    ].filter(Boolean).join('\n');
  }).join('\n');
  const examples = workbookExamples(model, picked);
  const context = [
    `CrisMac columns with no confirmed TRAQ column (${picked.length}${gaps.length > picked.length ? ` of ${gaps.length}` : ''}):\n${gapBlock}`,
    examples.length ? `HOW THE WORKBOOK ALREADY MAPS THESE CrisMac TABLES (verbatim evidence of the naming used):\n${examples.map((e) => `- ${e}`).join('\n')}` : 'HOW THE WORKBOOK ALREADY MAPS THESE CrisMac TABLES: Not provided in workbook.',
    `TRAQ COLUMNS (the only columns you may use)${total > shown ? ` - showing ${shown} of ${total}` : ''}:\n${listing}`,
  ].join('\n\n');
  return {
    gaps: picked, pool, model,
    prompt: spec('For each CrisMac column choose the TRAQ column it feeds, or report it as unresolved. Your confidence is an estimate, not a measurement. Every pick is validated and stays a draft until a person accepts it.', SCHEMA, context),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate the model's answer. Returns null only when it is not the expected JSON at all. */
export function parseGapMappingOutput(input: GapMappingInput, text: string): GapMappingSet | null {
  const o = extractJson(text);
  if (!isObj(o) || !Array.isArray(o.picks)) return null;
  const byKey = new Map(input.gaps.map((g) => [g.key, g]));
  const set: GapMappingSet = { proposals: [], rejected: [], unresolved: [], asked: input.gaps.length };
  const answered = new Set<string>();
  const taken = new Map<string, string>(); // TRAQ column -> gap that already claimed it

  const picks = o.picks.filter(isObj).map((p) => ({
    gap: typeof p.gap === 'string' ? p.gap.trim() : '', table: typeof p.traqTable === 'string' ? p.traqTable.trim() : '', column: typeof p.traqColumn === 'string' ? p.traqColumn.trim() : '',
    confidence: typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? Math.max(1, Math.min(99, Math.round(p.confidence))) : 0,
    reason: typeof p.reason === 'string' ? p.reason.trim() : '',
  })).sort((a, b) => b.confidence - a.confidence);

  for (const p of picks) {
    const traq = `${p.table}.${p.column}`;
    const gap = byKey.get(p.gap);
    if (!gap) { set.rejected.push({ gapKey: p.gap || '(none)', traq, reason: 'Names a gap that was not asked about.' }); continue; }
    if (answered.has(gap.key)) { set.rejected.push({ gapKey: gap.key, traq, reason: 'A second pick for the same column; only the most confident one is kept.' }); continue; }
    const cand = input.pool.get(`${up(p.table)}.${up(p.column)}`);
    if (!cand) { set.rejected.push({ gapKey: gap.key, traq, reason: 'Not an in-scope TRAQ column (invented, out of scope, or a TRAQ-only column with no CrisMac source).' }); continue; }
    const owner = taken.get(`${up(cand.table)}.${up(cand.column)}`);
    if (owner) { set.rejected.push({ gapKey: gap.key, traq, reason: `${cand.table}.${cand.column} is already proposed for ${owner}; two CrisMac columns cannot feed one TRAQ column here.` }); continue; }
    const sourceType = crismacType(input.model, gap.crismacTable, gap.crismacColumn);
    const cmp = sourceType ? compat(sourceType, cand.type) : { level: 'unknown' as const, note: 'CrisMac type not provided in workbook, so the type check could not run' };
    if (cmp.level === 'incompatible') { set.rejected.push({ gapKey: gap.key, traq, reason: `Type check failed: ${cmp.note}` }); continue; }
    answered.add(gap.key);
    taken.set(`${up(cand.table)}.${up(cand.column)}`, gap.key);
    set.proposals.push({
      gapKey: gap.key, crismacTable: gap.crismacTable, crismacColumn: gap.crismacColumn, traqTable: cand.table, traqColumn: cand.column, traqType: cand.type,
      confidence: p.confidence || 50, reason: p.reason || 'No reason given.',
      typeCheck: cmp.level === 'compatible' ? 'compatible' : cmp.level === 'warn' ? 'warn' : 'unknown', typeNote: cmp.note,
    });
  }

  const said = new Map<string, string>();
  for (const u of Array.isArray(o.unresolved) ? o.unresolved.filter(isObj) : []) if (typeof u.gap === 'string') said.set(u.gap.trim(), typeof u.reason === 'string' ? u.reason.trim() : '');
  for (const g of input.gaps) {
    if (answered.has(g.key)) continue;
    set.unresolved.push({ gapKey: g.key, reason: said.get(g.key) || 'The model gave no usable answer for this column.' });
  }
  set.proposals.sort((a, b) => b.confidence - a.confidence);
  return set;
}
