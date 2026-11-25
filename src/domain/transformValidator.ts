import type { WorkbookModel } from '@/types';
import type { ProposalSource } from '@/types/mappingAi';
import type { TransformationCheck } from './mappingProposals';
import { analyzeProcSql, KNOWN_FUNCTIONS, maskSql } from './sqlParse';

/*
 * Validates an AI-suggested transformation expression BEFORE it is shown. It is a single T-SQL value expression over the
 * proposed source columns (a cast, a CASE lookup, a concatenation, a conditional). The project's own parser (`sqlParse.ts`)
 * must read it back as exactly one column of one INSERT ... SELECT, and every identifier in it must be a real column of
 * a source table in the workbook. This checks structure and names; it does NOT prove the logic is right and it is not
 * checked against the TRAQ rule-engine syntax. Valid output is an AI_DRAFT that a human reviews.
 */

const MAX_LENGTH = 600;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Never allowed anywhere: this must be a value expression, not a statement. */
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|EXEC|EXECUTE|MERGE|ALTER|CREATE|GRANT|REVOKE|DECLARE|WAITFOR|OPENROWSET|XP_CMDSHELL)\b/i;
/** Not allowed at the top level (inside parentheses a scalar form such as EXISTS-free CASE is the only thing the parser reads back safely). */
const TOP_LEVEL_FORBIDDEN = /\b(SELECT|FROM|WHERE|JOIN|UNION|INTO|GROUP|ORDER|HAVING)\b/i;

const WORDS = new Set([
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'AS', 'DISTINCT', 'ASC', 'DESC', 'TRUE', 'FALSE',
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'BIT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'REAL', 'MONEY', 'VARCHAR', 'NVARCHAR', 'CHAR', 'NCHAR',
  'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'TIME', 'MAX', 'DAY', 'MONTH', 'YEAR', 'HOUR', 'MINUTE', 'SECOND', 'WEEK', 'QUARTER',
]);

/** Ordinary T-SQL scalar functions beyond sqlParse's list, so they do not raise a warning. */
const COMMON_FUNCTIONS = new Set(['CONCAT', 'CONCAT_WS', 'TRIM', 'TRY_CAST', 'TRY_CONVERT', 'LEFT', 'RIGHT', 'STUFF', 'REPLICATE', 'ISDATE', 'ISNUMERIC', 'SIGN', 'POWER']);

function topLevelText(code: string): string {
  let depth = 0;
  let out = '';
  for (const c of code) {
    if (c === '(') { depth++; out += ' '; } else if (c === ')') { depth--; out += ' '; } else out += depth <= 0 ? c : ' ';
  }
  return out;
}

export interface TransformationInput {
  expression: string;
  target: { table: string; column: string };
  sources: ProposalSource[];
  model: WorkbookModel;
}

export function validateTransformation(input: TransformationInput): TransformationCheck {
  const { model } = input;
  const problems: string[] = [];
  const checks: string[] = [];
  const expr = input.expression.trim();
  const fail = (): TransformationCheck => ({ valid: false, checks, problems });

  if (!expr) { problems.push('the expression is empty'); return fail(); }
  if (expr.length > MAX_LENGTH) { problems.push(`the expression is longer than ${MAX_LENGTH} characters`); return fail(); }
  if (input.sources.length === 0) { problems.push('no source columns to apply it to'); return fail(); }

  const { code, text } = maskSql(expr);
  if (text !== expr) problems.push('comments are not allowed in a transformation');
  if (code.includes(';')) problems.push('it must be a single expression (found ";")');
  if ((code.match(/'/g) ?? []).length % 2 !== 0) problems.push('a string literal is not closed');
  let depth = 0;
  for (const c of code) { if (c === '(') depth++; else if (c === ')') depth--; if (depth < 0) break; }
  if (depth !== 0) problems.push('parentheses are not balanced');
  const forbidden = FORBIDDEN.exec(code);
  if (forbidden) problems.push(`"${forbidden[1].toUpperCase()}" is not allowed: this must be a value expression, not a statement`);
  const topWord = TOP_LEVEL_FORBIDDEN.exec(topLevelText(code));
  if (topWord) problems.push(`"${topWord[1].toUpperCase()}" at the top level: this must be one value expression`);
  if (problems.length) return fail();

  // Let the project's own parser read it back: one INSERT ... SELECT with exactly one column whose expression is ours.
  const primary = input.sources[0];
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const sql = `INSERT INTO ${safe(input.target.table)} (${safe(input.target.column)})\nSELECT ${expr}\nFROM ${safe(primary.table)};`;
  const parsed = analyzeProcSql({ name: 'transformation', folder: '', file: 'transformation.sql' }, sql);
  const steps = parsed.steps.filter((s) => !s.housekeeping);
  const step = steps[0];
  if (steps.length !== 1 || !step || step.type !== 'INSERT') {
    problems.push(steps.length > 1 ? 'it contains a nested SELECT or extra statement; express a lookup with CASE or COALESCE instead' : 'sqlParse could not read it as one value expression');
    return fail();
  }
  const col = step.columns[0];
  if (step.columns.length !== 1 || !col?.expressionFull) { problems.push('sqlParse found more than one expression (a top-level comma?)'); return fail(); }
  if (squash(col.expressionFull) !== squash(expr)) { problems.push('sqlParse read the expression back differently (check for a stray comma or alias)'); return fail(); }
  checks.push('Read back by sqlParse as exactly one value expression (INSERT ... SELECT form)');

  // Every identifier must be a real column of one of the source tables; nothing is invented.
  const tables = new Map(model.tables.map((t) => [t.name.toUpperCase(), t]));
  const srcTables = Array.from(new Set(input.sources.map((s) => s.table.toUpperCase())));
  const allowed = new Set<string>();
  const known = new Set<string>();
  for (const tn of srcTables) {
    const t = tables.get(tn);
    if (!t) { problems.push(`source table ${tn} is not in the workbook`); continue; }
    known.add(tn);
    for (const c of t.columns) allowed.add(c.name.toUpperCase());
  }
  const bare = code.replace(/'[^']*'/g, ' ').replace(/\b\d+(?:\.\d+)?\b/g, ' ');
  const used = new Set<string>();
  const functions = new Set<string>();
  const unknown = new Set<string>();
  for (const m of bare.matchAll(/(@?)([A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*)(\s*\()?/g)) {
    if (m[1]) { problems.push(`variables (${m[1]}${m[2]}) are not allowed`); continue; }
    const parts = m[2].split('.').map((p) => p.trim().toUpperCase());
    const last = parts[parts.length - 1];
    if (parts.length === 1 && WORDS.has(last)) continue; // keywords and type names, including VARCHAR(10) / DECIMAL(9,2)
    if (m[3] && parts.length === 1) { functions.add(last); continue; }
    for (const q of parts.slice(0, -1)) if (!known.has(q) && !tables.has(q)) unknown.add(q);
    if (allowed.has(last)) used.add(last); else unknown.add(m[2].replace(/\s+/g, ''));
  }
  if (unknown.size) problems.push(`not a column of the source table(s) ${srcTables.join(', ')}: ${Array.from(unknown).slice(0, 6).join(', ')}`);
  if (problems.length) return fail();
  checks.push(`${used.size} column reference(s), all found in ${srcTables.join(', ')}`);

  for (const s of input.sources) if (!used.has(s.column.toUpperCase())) checks.push(`Warning: the expression does not use the proposed source column ${s.table}.${s.column}`);
  const odd = Array.from(functions).filter((f) => !KNOWN_FUNCTIONS.has(f) && !COMMON_FUNCTIONS.has(f));
  if (odd.length) checks.push(`Warning: function(s) ${odd.join(', ')} are not in the project's known T-SQL list; confirm they exist in TRAQ`);
  checks.push('Syntax is checked as T-SQL, not against the TRAQ rule engine; a reviewer must confirm the logic');
  return { valid: true, checks, problems: [] };
}
