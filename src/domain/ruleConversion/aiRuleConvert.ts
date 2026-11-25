import type { ConvertedRule, WorkbookModel } from '@/types';
import { spec, type PromptSpec } from '../aiPrompts';
import { extractJson } from '../jsonExtract';
import { gapCandidatePool } from './aiGapMapping';
import { EVIDENCED_FUNCTIONS } from './translate';

/*
 * "LLM proposes, validator checks" for the conversion itself. The deterministic converter (convert.ts) stays the first pass; the
 * rules it could not finish (open issues, [[...]] placeholders) are sent to the model together with the original CrisMac logic,
 * the partial TRAQ expression, the columns already mapped and the in-scope TRAQ columns. The answer is accepted only if it is a
 * well-formed TRAQ expression built from the documented function palette and in-scope TRAQ columns. Anything else is DROPPED,
 * never repaired. Mapping blockers are untouched: a rule still needs confirmed column mappings and approval to be Ready.
 */

export const MAX_AI_RULES = 12;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const up = (s: string) => s.toUpperCase();

/** Function words the TRAQ rule engine documents (see translate.ts and the TRAQ rule reference), plus the IF/THEN/ELSE layout. */
const ALLOWED_WORDS = new Set([
  ...EVIDENCED_FUNCTIONS, 'IF', 'THEN', 'ELSE', 'AND', 'OR', 'NOT', 'CONTAINS', 'BEGINSWITH', 'ENDSWITH', 'REGEX', 'SUBSTR', 'ADDDAY', 'DATEPART', 'FLOOR', 'CEIL',
]);

export interface AiRuleProposal { ruleId: string; expression: string; explanation: string; confidence: number }
export interface AiRuleSet {
  proposals: AiRuleProposal[];
  rejected: { ruleId: string; reason: string }[];
  unresolved: { ruleId: string; reason: string }[];
  asked: number;
  /** Ids of the rules this call actually covered (a call takes as many as fit the prompt budget). */
  askedIds: string[];
}
export interface AiRuleInput { prompt: PromptSpec; rules: ConvertedRule[]; pool: Map<string, { table: string; column: string; type: string }> }

/** Rules the deterministic pass did not finish. */
export const isOpenRule = (r: ConvertedRule) => r.status !== 'converted' || /\[\[(UNMAPPED|PARAM|UNSUPPORTED)/.test(r.traq.expression);

const SCHEMA = [
  'JSON schema: {"rules": [{"id": string (copied exactly), "expression": string, "explanation": string (one or two sentences), "confidence": integer 0-100}],',
  '"unresolved": [{"id": string, "reason": string}]}.',
  'Write the expression in the same layout as "TRAQ expression so far": IF(condition)THEN(value)ELSE(other), columns as "ENTITY"."COLUMN", only the listed functions,',
  'comparison with ==, != and so on. Use only columns from TRAQ COLUMNS. If the logic needs a CrisMac column that has no TRAQ column in the list, a parameter with no value, or SQL',
  'with no TRAQ form, do NOT guess: put the rule in "unresolved" and say what is missing. A rule left unresolved is better than a wrong expression.',
].join(' ');

/** Default size (characters) of the CONTEXT block. ~4 chars per token, so this is ~2.5k tokens: fits a 4096-token local model with room for the answer. */
export const DEFAULT_AI_BUDGET = 10000;
export const MIN_AI_BUDGET = 2500;
const FIXED_CHARS = 900; // allowed-function line, headings and the system prompt's schema

function ruleBlock(r: ConvertedRule, logicMax: number, exprMax: number): string {
  const mapped = [r.target, ...r.references].filter((x) => x.chosen).map((x) => `${x.crismacTable}.${x.crismacColumn} -> "${x.chosen?.table}"."${x.chosen?.column}"`);
  const missing = [r.target, ...r.references].filter((x) => !x.chosen).map((x) => `${x.crismacTable}.${x.crismacColumn}`);
  return [
    `- rule=${r.id}`,
    `  writes: ${r.target.chosen ? `"${r.target.chosen.table}"."${r.target.chosen.column}"` : `${r.crismacTable}.${r.crismacColumn} (no TRAQ column)`}`,
    `  CrisMac logic:\n${clip(r.crismacLogic, logicMax).split('\n').map((l) => `    ${l}`).join('\n')}`,
    `  TRAQ expression so far: ${clip(r.traq.expression, exprMax) || '(none)'}`,
    `  mapped columns: ${clip(mapped.join('; '), 600) || 'none'}`,
    `  columns with no TRAQ column: ${clip(missing.join('; '), 400) || 'none'}`,
  ].join('\n');
}

/**
 * Builds the prompt for as many open rules as fit in `budget` characters (always at least one). The TRAQ column list is limited
 * to the tables these rules already resolve to (plus any table named in their logic) and written compactly, so the prompt stays
 * small enough for models with a short context window (e.g. a local Ollama model at its default 4096 tokens). `rules` in the
 * result are exactly the rules the model was asked about; the caller sends the rest in the next call.
 */
export function buildAiRuleInput(model: WorkbookModel, rules: ConvertedRule[], budget = DEFAULT_AI_BUDGET): AiRuleInput | null {
  const open = rules.filter(isOpenRule);
  if (open.length === 0) return null;
  const b = Math.max(MIN_AI_BUDGET, budget);
  const small = b < DEFAULT_AI_BUDGET;
  const logicMax = small ? 700 : 1800;
  const exprMax = small ? 500 : 1200;
  const ruleBudget = Math.floor((b - FIXED_CHARS) * 0.6);
  const picked: ConvertedRule[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const r of open.slice(0, MAX_AI_RULES)) {
    const blk = ruleBlock(r, logicMax, exprMax);
    if (picked.length > 0 && used + blk.length > ruleBudget) break;
    picked.push(r); blocks.push(blk); used += blk.length + 1;
  }
  const { pool, total, listing } = gapCandidatePool(model, picked, { onlyUsed: true, maxChars: b - FIXED_CHARS - used });
  if (pool.size === 0) return null;
  const context = [
    `RULES TO COMPLETE (${picked.length}${open.length > picked.length ? ` of ${open.length}` : ''}):\n${blocks.join('\n')}`,
    `ALLOWED FUNCTIONS: ${[...ALLOWED_WORDS].filter((w) => !['IF', 'THEN', 'ELSE'].includes(w)).join(', ')}.`,
    `TRAQ COLUMNS (the only columns you may use)${total > pool.size ? ` - showing ${pool.size} of ${total}` : ''}:\n${listing}`,
  ].join('\n\n');
  const p = spec('Complete each CrisMac rule as a TRAQ expression using only the documented functions and the listed TRAQ columns, or report it as unresolved. Every expression is validated and stays a draft until a person approves the rule.', SCHEMA, context, small ? 1536 : 3072);
  return { rules: picked, pool, prompt: p };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Structural check of an expression; returns the reason it is not acceptable, or null. */
export function expressionProblem(expr: string, pool: AiRuleInput['pool']): string | null {
  const e = expr.trim();
  if (!e) return 'Empty expression.';
  if (/\[\[|\]\]/.test(e)) return 'Still contains [[...]] placeholders.';
  if (/@\w/.test(e)) return 'Contains a CrisMac @variable that was not resolved.';
  const noStrings = e.replace(/'[^']*'/g, "''");
  let depth = 0;
  for (const ch of noStrings) { if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--; if (depth < 0) break; }
  if (depth !== 0) return 'Unbalanced brackets.';
  if ((noStrings.match(/"/g) ?? []).length % 2 !== 0) return 'Unbalanced double quotes.';
  const noVars = noStrings.replace(/"[^"]+"\."var"\."BUSINESS_DATE"/g, '');
  for (const m of noVars.matchAll(/"([^"]+)"\."([^"]+)"/g)) {
    if (!pool.has(`${up(m[1])}.${up(m[2])}`)) return `"${m[1]}"."${m[2]}" is not an in-scope TRAQ column.`;
  }
  const bare = noVars.replace(/"[^"]*"/g, '');
  for (const m of bare.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (!ALLOWED_WORDS.has(up(m[1]))) return `${m[1]}( is not a documented TRAQ function.`;
  }
  return null;
}

/** Validate the model's answer. Returns null only when it is not the expected JSON at all. */
export function parseAiRuleOutput(input: AiRuleInput, text: string): AiRuleSet | null {
  const o = extractJson(text);
  if (!isObj(o) || !Array.isArray(o.rules)) return null;
  const byId = new Map(input.rules.map((r) => [r.id, r]));
  const set: AiRuleSet = { proposals: [], rejected: [], unresolved: [], asked: input.rules.length, askedIds: input.rules.map((r) => r.id) };
  const answered = new Set<string>();
  for (const p of o.rules.filter(isObj)) {
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    const expression = typeof p.expression === 'string' ? p.expression.trim() : '';
    if (!byId.has(id)) { set.rejected.push({ ruleId: id || '(none)', reason: 'Names a rule that was not asked about.' }); continue; }
    if (answered.has(id)) { set.rejected.push({ ruleId: id, reason: 'A second answer for the same rule; the first is kept.' }); continue; }
    const problem = expressionProblem(expression, input.pool);
    if (problem) { set.rejected.push({ ruleId: id, reason: problem }); continue; }
    answered.add(id);
    set.proposals.push({
      ruleId: id, expression,
      explanation: typeof p.explanation === 'string' && p.explanation.trim() ? p.explanation.trim() : 'No explanation given.',
      confidence: typeof p.confidence === 'number' && Number.isFinite(p.confidence) ? Math.max(1, Math.min(99, Math.round(p.confidence))) : 50,
    });
  }
  const said = new Map<string, string>();
  for (const u of Array.isArray(o.unresolved) ? o.unresolved.filter(isObj) : []) if (typeof u.id === 'string') said.set(u.id.trim(), typeof u.reason === 'string' ? u.reason.trim() : '');
  for (const r of input.rules) if (!answered.has(r.id)) set.unresolved.push({ ruleId: r.id, reason: said.get(r.id) || 'The model gave no usable answer for this rule.' });
  return set;
}
