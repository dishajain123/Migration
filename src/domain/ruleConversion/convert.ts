import type {
  ColumnResolution, ConversionIssue, ConversionRequest, ConversionResult, ConversionSettings, ConvertedRule, ParamResolution,
  ProcDependency, ProcSource, SourceStatementRef, SqlColumnWrite, SqlStep, WorkbookModel,
} from '@/types';
import { tableByName } from '../selectors';
import { buildMappingIndex, logicalTable, placeColumn, resolveColumn, type MappingIndex } from './resolve';
import { mapExpr, parseSqlExpr, sqlText, walkExpr, type Expr } from './sqlExpr';
import { foldConstants, translate } from './translate';
import { DEFAULT_PARAM_MAPPINGS } from './timeKey';

/*
 * CrisMac procedure -> TRAQ rules. Pipeline per written column:
 *   1. collect every statement in the procedure that assigns the column (UPDATE, INSERT, MERGE, SELECT INTO), in order;
 *   2. parse each assignment, its WHERE, INNER JOIN conditions and enclosing IF/ELSE into expression trees and qualify
 *      every column with its CrisMac table;
 *   3. compose them: value = IF(condition)THEN(new value)ELSE(previous value), so later statements see earlier results,
 *      exactly as the procedure runs them (TRAQ keeps one derivation per column);
 *   4. resolve the written column and every column read to TRAQ through Agent 4 / workbook mappings;
 *   5. translate to TRAQ expression syntax and record every assumption as an issue.
 * Deterministic and rule-based; nothing is produced by a language model.
 */

export const DEFAULT_SETTINGS: ConversionSettings = {
  effectiveStartDate: '',
  paramValues: { '@TIMEKEY': '' },
  paramMappings: { ...DEFAULT_PARAM_MAPPINGS },
};
const RUN_DATE_NOTE = 'default: the run-date variable BUSINESS_DATE of FPM_DA_RULES row 6 (CRISMAC column: "the run date"); it is defined on FCT_PRODUCT_MASTER. The procedure sets it from SysDayMatrix at TimeKey = @TIMEKEY';
const PARAM_NOTES: Record<string, string> = { '@PROCESSDATE': RUN_DATE_NOTE, '@PROCESSINGDATE': RUN_DATE_NOTE };

const WRITE_TYPES = new Set(['UPDATE', 'INSERT', 'MERGE', 'SELECT_INTO']);
const DATE_PARTS = new Set(['DAY', 'DD', 'D', 'DY', 'DAYOFYEAR', 'MONTH', 'MM', 'M', 'YEAR', 'YY', 'YYYY', 'WEEK', 'WK', 'WW', 'QUARTER', 'QQ', 'Q', 'HOUR', 'HH', 'MINUTE', 'MI', 'N', 'SECOND', 'SS', 'S']);
const MAX_EXPRESSION = 8000;
const MAX_NODES = 1500;

function nodeCount(e: Expr): number {
  let n = 0;
  walkExpr(e, () => { n++; });
  return n;
}

interface Write { step: SqlStep; col: SqlColumnWrite }

/** Every column reference becomes [LOGICAL_TABLE, COLUMN]; date-part keywords stay single. */
function qualify(e: Expr, step: SqlStep, index: MappingIndex): Expr {
  const joinTables = (step.joins ?? []).map((j) => j.table).filter((t) => t !== '(subquery)');
  const tables = [step.table, ...joinTables];
  return mapExpr(e, (n) => {
    if (n.k !== 'col') return n;
    const p = n.parts;
    if (p.length === 1) {
      if (DATE_PARTS.has(p[0]) || p[0] === '*') return n;
      return { k: 'col', parts: [logicalTable(placeColumn(index, p[0], tables) || step.table), p[0]] };
    }
    const qualifier = p[p.length - 2];
    const table = step.aliases?.[qualifier] ?? logicalTable(qualifier);
    return { k: 'col', parts: [logicalTable(table), p[p.length - 1]] };
  });
}

function dataTypeLabel(oracleType: string): string {
  const t = oracleType.toUpperCase();
  if (!t) return '';
  if (/DATE|TIMESTAMP/.test(t)) return 'Date';
  if (/CHAR|CLOB|TEXT|STRING/.test(t)) return 'String';
  const m = /NUMBER\s*\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(t);
  if (m) return Number(m[1]) > 0 ? 'Decimal' : 'Integer';
  if (/NUMBER|INT|NUMERIC|DECIMAL/.test(t)) return /DECIMAL|NUMERIC/.test(t) ? 'Decimal' : 'Integer';
  return '';
}

function tryParse(text: string, what: string, issues: ConversionIssue[]): Expr | null {
  try {
    return parseSqlExpr(text);
  } catch (e) {
    issues.push({ severity: 'error', code: 'PARSE', message: `Could not read the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    return { k: 'unsupported', text: text.slice(0, 200), reason: `unparsed ${what}` };
  }
}

function confidenceOf(target: ColumnResolution, refs: ColumnResolution[], issues: ConversionIssue[]): { value: number; basis: string[] } {
  if (!target.chosen) return { value: 0, basis: ['no TRAQ target column'] };
  let v = 100;
  const basis: string[] = [];
  const hit = (n: number, why: string) => { v -= n; basis.push(`-${n} ${why}`); };
  if (target.status === 'name-match') hit(35, 'target matched by name only');
  if (target.status === 'ambiguous') hit(30, 'target ambiguous');
  for (const r of refs) {
    if (r.status === 'missing') hit(20, `${r.crismacTable}.${r.crismacColumn} unmapped`);
    else if (r.status === 'name-match') hit(10, `${r.crismacTable}.${r.crismacColumn} matched by name`);
    else if (r.status === 'ambiguous') hit(10, `${r.crismacTable}.${r.crismacColumn} ambiguous`);
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  if (errors) hit(25 * errors, `${errors} error(s)`);
  if (warnings) hit(5 * warnings, `${warnings} warning(s)`);
  return { value: Math.max(0, Math.min(100, v)), basis: basis.length ? basis : ['all columns mapped by approved/documented mappings, no issues'] };
}

function buildRule(
  model: WorkbookModel, index: MappingIndex, settings: ConversionSettings, proc: ProcSource, table: string, column: string,
  writes: Write[], writers: Map<string, Set<string>>, earlier: Map<string, number>,
): ConvertedRule {
  const issues: ConversionIssue[] = [];
  const target = resolveColumn(model, index, table, column);
  const entity = target.chosen?.table ?? '';
  const entityDef = tableByName(model).get(entity);

  // ---- compose the statements ----
  let value: Expr = { k: 'col', parts: [table, column] };
  let capped = false;
  const statements: SourceStatementRef[] = [];
  const notes: string[] = [];
  for (const { step, col } of writes) {
    statements.push({
      stepId: step.id, stepIndex: step.index, type: step.type, lineStart: step.lineStart, lineEnd: step.lineEnd,
      expression: col.expressionFull ?? col.expression, where: step.where ?? '', guards: step.guards ?? [], joins: step.joins ?? [],
    });
    if (step.note && !notes.includes(step.note)) notes.push(step.note);
    const text = col.expressionFull ?? (col.expression.endsWith('...') ? '' : col.expression);
    if (!text) {
      issues.push({ severity: 'error', code: 'EXPR_MISSING', message: `Step ${step.index} (line ${step.lineStart}): the value assigned to ${column} could not be paired with the column list.` });
      continue;
    }
    const isSelf = (n: Expr) => n.k === 'col' && n.parts[0] === table && n.parts[1] === column;
    if (!capped && nodeCount(value) > MAX_NODES) {
      capped = true;
      value = { k: 'col', parts: [table, column] };
      issues.push({ severity: 'error', code: 'TOO_COMPLEX', message: `From step ${step.index} on, the composed logic grew too large to inline; later statements read the column's stored value instead of the earlier steps' result. Split it into Temporary variables.` });
    }
    const current = value;
    const sub = (x: Expr) => (step.type === 'UPDATE' || step.type === 'MERGE' ? mapExpr(x, (n) => (isSelf(n) ? current : n)) : x);
    const rhs = sub(qualify(tryParse(text, `value of ${column} at line ${step.lineStart}`, issues) as Expr, step, index));

    const conds: Expr[] = [];
    for (const g of step.guards ?? []) {
      if (g.startsWith('__WHILE__')) {
        issues.push({ severity: 'error', code: 'LOOP', message: `Step ${step.index} runs inside a WHILE loop; a TRAQ rule cannot repeat. Rewrite by hand.` });
        continue;
      }
      conds.push(sub(qualify(tryParse(g, `IF condition around line ${step.lineStart}`, issues) as Expr, step, index)));
    }
    for (const j of step.joins ?? []) {
      if (j.table === '(subquery)') {
        issues.push({ severity: 'error', code: 'JOIN_SUBQUERY', message: `Step ${step.index} joins a sub-query (alias ${j.alias || '?'}); model it as a TRAQ link or a separate rule.` });
        continue;
      }
      if ((j.kind === 'INNER' || j.kind === 'USING') && j.on) conds.push(sub(qualify(tryParse(j.on, `JOIN condition with ${j.table}`, issues) as Expr, step, index)));
    }
    if (step.where) conds.push(sub(qualify(tryParse(step.where, `WHERE clause at line ${step.lineStart}`, issues) as Expr, step, index)));
    const cond: Expr | null = conds.length === 0 ? null : conds.length === 1 ? conds[0] : { k: 'and', items: conds };

    if (step.type === 'INSERT' || step.type === 'SELECT_INTO') {
      if (cond) issues.push({ severity: 'warning', code: 'INSERT_FILTER', message: `Step ${step.index} inserts rows only where its WHERE/JOIN holds; a TRAQ rule derives a value for every row. The filter is kept as an IF with NULL otherwise.` });
      value = cond ? { k: 'case', operand: null, whens: [{ when: cond, then: rhs }], else: { k: 'null' } } : rhs;
    } else {
      value = cond ? { k: 'case', operand: null, whens: [{ when: cond, then: rhs }], else: value } : rhs;
    }
  }
  const crismacLogic = sqlText(value);

  // ---- parameters ----
  const values = Object.fromEntries(Object.entries(settings.paramValues).map(([k, v]) => [k.toUpperCase(), v]));
  const mappings = { ...DEFAULT_PARAM_MAPPINGS, ...Object.fromEntries(Object.entries(settings.paramMappings).map(([k, v]) => [k.toUpperCase(), v])) };

  // @TIMEKEY has no TRAQ equivalent and the workbook has no SysDayMatrix rows, so a cut-off such as @TIMEKEY > 26267 cannot be turned
  // into a date without guessing a calendar. It stays unresolved ([[PARAM @TIMEKEY]], blocking export) unless the user gives it a value.
  const vars = new Set<string>();
  walkExpr(value, (n) => { if (n.k === 'var') vars.add(n.name); });
  const params: ParamResolution[] = Array.from(vars).sort().map((name) => {
    if (values[name]?.trim()) return { name, status: 'folded', value: values[name].trim(), note: 'value set in the conversion settings; comparisons with it were evaluated' };
    if (mappings[name]?.trim()) return { name, status: 'mapped', value: mappings[name].replace(/\{ENTITY\}/g, entity || 'TABLE'), note: PARAM_NOTES[name] ?? 'mapping set in the conversion settings' };
    return { name, status: 'unresolved', value: '', note: 'no value or TRAQ expression configured' };
  });
  const paramByName = new Map(params.map((p) => [p.name, p]));

  // ---- translate ----
  const refs = new Map<string, ColumnResolution>();
  const folded = foldConstants(value, values);
  const tr = translate(folded, {
    entity,
    param: (name) => paramByName.get(name) ?? { name, status: 'unresolved', value: '', note: '' },
    column: (parts) => {
      if (parts.length === 1) return { text: parts[0], resolution: null };
      const [t, c] = parts;
      const self = t === table && c === column;
      const res = self ? target : refs.get(`${t}.${c}`) ?? resolveColumn(model, index, t, c, entity || undefined);
      if (!self) refs.set(`${t}.${c}`, res);
      if (!res.chosen) {
        return { text: `[[UNMAPPED ${t}.${c}]]`, resolution: res, issue: { severity: 'error', code: 'UNMAPPED', message: `${t}.${c} has no TRAQ mapping. Add one in Agent 4 (or here, as a manual mapping).` } };
      }
      const ch = res.chosen;
      if (res.status === 'suggested') {
        return {
          text: `"${ch.table}"."${ch.column}"`, resolution: res,
          issue: { severity: 'error', code: 'SUGGESTED', message: `${t}.${c} has no mapping, so "${ch.table}"."${ch.column}" is Agent 4's Simulated suggestion (${ch.confidence ?? '?'}% confidence against the TRAQ data model), not a confirmed mapping. Approve it in Agent 4 before this rule can export.` },
        };
      }
      if (!entity || ch.table === entity) return { text: `"${ch.table}"."${ch.column}"`, resolution: res };
      const link = `FK_${ch.table}`;
      if (entityDef?.columns.some((x) => x.name.toUpperCase() === link)) {
        return { text: `"${entity}"."${link}"."${ch.column}"`, resolution: res, issue: { severity: 'info', code: 'LINK', message: `${ch.table}.${ch.column} is read through the link column ${entity}.${link}.` } };
      }
      return {
        text: `"${ch.table}"."${ch.column}"`, resolution: res,
        issue: { severity: 'warning', code: 'NO_LINK', message: `${ch.table}.${ch.column} is on another table and ${entity} has no ${link} column in the workbook; TRAQ needs a registered link (as FK_FCT_PUI_DETAIL in FPM_DA_RULES).` },
      };
    },
  });
  issues.push(...tr.issues);

  // ---- mapping and dependency issues ----
  if (!target.chosen) issues.unshift({ severity: 'error', code: 'NO_TARGET', message: `${table}.${column} has no TRAQ column in Agent 4 or the workbook, so there is nothing to write the rule to.` });
  else if (target.status === 'name-match') issues.unshift({ severity: 'warning', code: 'TARGET_NAME_MATCH', message: `Target ${entity}.${target.chosen.column} was found by name only; approve the mapping in Agent 4.` });
  else if (target.status === 'ambiguous') issues.unshift({ severity: 'warning', code: 'TARGET_AMBIGUOUS', message: target.note });
  else if (target.status === 'suggested') issues.unshift({ severity: 'error', code: 'TARGET_SUGGESTED', message: `Target ${entity}.${target.chosen.column} is Agent 4's Simulated suggestion (${target.chosen.confidence ?? '?'}% confidence), not a confirmed mapping. Approve it in Agent 4 before this rule can export.` });
  const references = Array.from(refs.values());
  for (const r of references) {
    if (r.status === 'name-match') issues.push({ severity: 'warning', code: 'REF_NAME_MATCH', message: `${r.crismacTable}.${r.crismacColumn} -> ${r.chosen?.table}.${r.chosen?.column} is a name match only; confirm in Agent 4.` });
    if (r.status === 'ambiguous') issues.push({ severity: 'warning', code: 'REF_AMBIGUOUS', message: `${r.crismacTable}.${r.crismacColumn}: ${r.note}` });
    if (r.status === 'suggested') issues.push({ severity: 'error', code: 'REF_SUGGESTED', message: `${r.crismacTable}.${r.crismacColumn} -> ${r.chosen?.table}.${r.chosen?.column} is Agent 4's Simulated suggestion (${r.chosen?.confidence ?? '?'}% confidence), not a confirmed mapping.` });
    const k = `${r.crismacTable}.${r.crismacColumn}`;
    const step = earlier.get(k);
    if (step !== undefined && step < (writes[0]?.step.index ?? 0)) {
      issues.push({ severity: 'info', code: 'ORDER', message: `Reads ${k}, which ${proc.name} sets earlier (step ${step}). In TRAQ that column's rule must run first (lower PRIORITY).` });
    }
  }
  if (tr.text.length > MAX_EXPRESSION) issues.push({ severity: 'warning', code: 'COMPLEX', message: `The composed expression is ${tr.text.length.toLocaleString()} characters; consider splitting it into Temporary variables as the workbook does (var.IS_DPD_BREACH).` });
  if (target.chosen && !entityDef?.columns.some((c) => c.name === target.chosen?.column)) {
    issues.push({ severity: 'warning', code: 'TARGET_NOT_LISTED', message: `${entity}.${target.chosen.column} is not in the workbook's column list for ${entity}; Column Type cannot be set to Physical automatically.` });
  }

  const dependencies = Array.from(new Set(references.flatMap((r) => Array.from(writers.get(`${r.crismacTable}.${r.crismacColumn}`) ?? []).filter((p) => p !== proc.name))));
  const confidence = confidenceOf(target, references, issues);
  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarning = issues.some((i) => i.severity === 'warning');
  const allApproved = references.every((r) => r.status === 'approved' || r.status === 'documented') && (target.status === 'approved' || target.status === 'documented');
  const status = !target.chosen ? 'failed' : hasError ? 'needs-review' : hasWarning || !allApproved ? 'needs-review' : 'converted';
  const lines = writes.map((w) => [w.step.lineStart, w.step.lineEnd]).flat();
  const physical = !!target.chosen && !!entityDef?.columns.some((c) => c.name === target.chosen?.column);
  const traqCol = target.chosen?.column ?? '';
  const stepsText = writes.map((w) => `${w.step.type} line ${w.step.lineStart}`).join(', ');

  return {
    id: `${proc.name}::${table}.${column}`,
    procedure: proc.name, procedureFile: proc.file, stage: proc.stage,
    crismacTable: table, crismacColumn: column,
    statements, crismacLogic, target, references, params,
    traq: {
      entity, column: traqCol,
      columnType: physical ? 'Physical' : '',
      derivationOption: 'Formula Expression',
      expression: tr.text,
      explanation: [
        `Converted from CrisMac ${proc.name} (${stepsText}): ${table}.${column}${traqCol ? ` -> ${entity}.${traqCol}` : ''}.`,
        writes.length > 1 ? `${writes.length} statements applied in order; each later one sees the earlier result.` : '',
        notes.length ? `Source comments: ${notes.join(' / ')}.` : '',
        params.some((p) => p.status === 'folded') ? `Evaluated for ${params.filter((p) => p.status === 'folded').map((p) => `${p.name} = ${p.value}`).join(', ')}.` : '',
      ].filter(Boolean).join(' '),
      effectiveStartDate: '',
      status: 'PENDING_REVIEW',
      dataType: dataTypeLabel(target.chosen?.dataType || entityDef?.columns.find((c) => c.name === traqCol)?.dataType || ''),
      reads: Array.from(new Set(references.filter((r) => r.chosen).map((r) => `${r.chosen?.table}.${r.chosen?.column}`))),
      crismac: `${proc.name} ${Math.min(...lines)}-${Math.max(...lines)}`,
    },
    status, issues,
    confidence: { value: confidence.value, source: 'mock', basis: confidence.basis },
    dependencies, origin: 'derived',
  };
}

function writesOf(proc: ProcSource): Map<string, { table: string; column: string; writes: Write[] }> {
  const groups = new Map<string, { table: string; column: string; writes: Write[] }>();
  for (const step of proc.steps) {
    if (step.housekeeping || step.tableKind === 'local-temp' || !step.table || !WRITE_TYPES.has(step.type)) continue;
    for (const col of step.columns) {
      const table = logicalTable(step.table);
      const key = `${table}.${col.name}`;
      const g = groups.get(key) ?? { table, column: col.name, writes: [] };
      g.writes.push({ step, col });
      groups.set(key, g);
    }
  }
  return groups;
}

export function procedureDependencies(procs: ProcSource[]): ProcDependency[] {
  const out: ProcDependency[] = [];
  const names = new Set(procs.map((p) => p.name.toUpperCase()));
  for (const a of procs) {
    const written = new Set(a.tablesWritten.map((w) => logicalTable(w.table)));
    for (const b of procs) {
      if (a === b) continue;
      for (const t of b.tablesRead.map(logicalTable)) if (written.has(t)) out.push({ from: a.name, to: b.name, via: t, kind: 'data' });
    }
    for (const c of a.calls) if (names.has(c.toUpperCase())) out.push({ from: a.name, to: c, via: 'EXEC', kind: 'call' });
  }
  return out;
}

export function convertProcedures(model: WorkbookModel, req: ConversionRequest): ConversionResult {
  const index = buildMappingIndex(model, req.reviewed);
  const procs = [...req.procedures].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const writers = new Map<string, Set<string>>();
  const grouped = procs.map((p) => ({ p, groups: writesOf(p) }));
  for (const { p, groups } of grouped) for (const k of groups.keys()) writers.set(k, (writers.get(k) ?? new Set<string>()).add(p.name));

  const rules: ConvertedRule[] = [];
  for (const { p, groups } of grouped) {
    const earlier = new Map<string, number>();
    for (const [k, g] of groups) earlier.set(k, Math.min(...g.writes.map((w) => w.step.index)));
    for (const g of groups.values()) rules.push(buildRule(model, index, req.settings, p, g.table, g.column, g.writes, writers, earlier));
  }
  return {
    rules,
    dependencies: procedureDependencies(procs),
    stats: {
      total: rules.length,
      converted: rules.filter((r) => r.status === 'converted').length,
      needsReview: rules.filter((r) => r.status === 'needs-review').length,
      failed: rules.filter((r) => r.status === 'failed').length,
      withTarget: rules.filter((r) => !!r.target.chosen).length,
      procedures: procs.length,
    },
    generatedAt: new Date().toISOString(),
    basis: 'Rule-based: statements parsed from the SQL, columns mapped through Agent 4 decisions and workbook mapping rows, expressions rewritten into the TRAQ syntax seen in FPM_DA_RULES. No language model.',
  };
}
