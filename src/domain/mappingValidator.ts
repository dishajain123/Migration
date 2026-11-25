import type { CompatLevel, TableDef, WorkbookModel } from '@/types';
import { NONFEED } from './constants';
import { memo } from './memo';
import { isFeeding, isLoadPathTable } from './selectors';
import { compat } from './typeUtils';

/*
 * Strict, deterministic validator for ANY proposed mapping (heuristic, LLM-generated or manual). It checks the proposal
 * against the parsed workbook schema only: it never trusts the proposer. An LLM can therefore suggest a mapping, but a
 * column that does not exist in the schema can never reach the reviewer. A valid result is still only a candidate:
 * every suggestion needs human approval.
 */

export type CandidateOrigin = 'heuristic' | 'llm' | 'manual';

export interface CandidateMapping {
  targetTable: string;
  targetColumn: string;
  sourceTable: string;
  sourceColumn: string;
  origin?: CandidateOrigin;
  /** A stated conversion (e.g. a date-key lookup). Downgrades a hard type clash to a warning. */
  transformation?: string;
  /** The proposer already knows another candidate scored almost as well. */
  ambiguous?: boolean;
}

export type ValidationCode =
  | 'TARGET_TABLE_MISSING' | 'TARGET_NOT_LOAD_PATH' | 'TARGET_COLUMN_MISSING' | 'TARGET_TRAQ_ONLY'
  | 'SOURCE_TABLE_MISSING' | 'SOURCE_COLUMN_MISSING' | 'SOURCE_IS_TARGET'
  | 'TYPE_INCOMPATIBLE' | 'TYPE_CONVERSION' | 'TYPE_UNKNOWN'
  | 'TARGET_ALREADY_MAPPED' | 'ALREADY_DOCUMENTED' | 'TARGET_DECLARED_NOT_FED' | 'SOURCE_FEEDS_OTHER_COLUMN' | 'SOURCE_NOT_IN_LINEAGE'
  | 'AMBIGUOUS_CANDIDATE' | 'AMBIGUOUS_TARGET' | 'SOURCE_CLAIMED_TWICE';

export interface ValidationIssue { code: ValidationCode; severity: 'error' | 'warning' | 'info'; message: string }

export interface ResolvedCandidate {
  targetTable: string; targetColumn: string; targetType: string;
  sourceTable: string; sourceColumn: string; sourceType: string;
  compat: CompatLevel;
}

export interface ValidationResult {
  /** No errors. Warnings (conflicts, ambiguity, type conversion) do not make a candidate invalid, but must be shown. */
  valid: boolean;
  status: 'valid' | 'valid_with_warnings' | 'invalid';
  issues: ValidationIssue[];
  /** Canonical names/types from the schema (the proposer's casing is not trusted). Set only when both columns exist. */
  resolved?: ResolvedCandidate;
}

const up = (s: string) => (s ?? '').trim().toUpperCase();

interface SchemaIndex { tables: Map<string, TableDef>; feedersByTarget: Map<string, Set<string>> }

function schemaIndex(model: WorkbookModel): SchemaIndex {
  return memo(model, 'validator:index', () => {
    const tables = new Map(model.tables.map((t) => [up(t.name), t]));
    const feedersByTarget = new Map<string, Set<string>>();
    for (const m of model.mappings) {
      if (!m.targetTable || !m.sourceTable) continue;
      const k = up(m.targetTable);
      const s = feedersByTarget.get(k) ?? new Set<string>();
      s.add(up(m.sourceTable));
      feedersByTarget.set(k, s);
    }
    return { tables, feedersByTarget };
  });
}

const issue = (code: ValidationCode, severity: ValidationIssue['severity'], message: string): ValidationIssue => ({ code, severity, message });

function finish(issues: ValidationIssue[], resolved?: ResolvedCandidate): ValidationResult {
  const errors = issues.some((i) => i.severity === 'error');
  const warnings = issues.some((i) => i.severity === 'warning');
  return { valid: !errors, status: errors ? 'invalid' : warnings ? 'valid_with_warnings' : 'valid', issues, resolved };
}

export function validateCandidateMapping(model: WorkbookModel, c: CandidateMapping): ValidationResult {
  const idx = schemaIndex(model);
  const issues: IssueList = [];
  const tt = idx.tables.get(up(c.targetTable));
  const st = idx.tables.get(up(c.sourceTable));

  if (!tt) issues.push(issue('TARGET_TABLE_MISSING', 'error', `Target table "${c.targetTable}" does not exist in the workbook schema.`));
  else if (!isLoadPathTable(tt)) issues.push(issue('TARGET_NOT_LOAD_PATH', 'error', `${tt.name} is not an in-scope TRAQ staging/mart table, so Agent 4 does not map into it.`));
  const tc = tt?.columns.find((x) => up(x.name) === up(c.targetColumn));
  if (tt && !tc) issues.push(issue('TARGET_COLUMN_MISSING', 'error', `Target column ${tt.name}.${c.targetColumn} does not exist in the workbook schema.`));
  if (tc?.traqOnly) issues.push(issue('TARGET_TRAQ_ONLY', 'error', `${tt?.name}.${tc.name} is marked by the workbook as having no CrisMac source; it must not be mapped from one.`));

  if (!st) issues.push(issue('SOURCE_TABLE_MISSING', 'error', `Source table "${c.sourceTable}" does not exist in the workbook schema.`));
  const sc = st?.columns.find((x) => up(x.name) === up(c.sourceColumn));
  if (st && !sc) issues.push(issue('SOURCE_COLUMN_MISSING', 'error', `Source column ${st.name}.${c.sourceColumn} is not listed for that table in the workbook.`));
  if (tt && st && tt === st) issues.push(issue('SOURCE_IS_TARGET', 'error', 'Source and target are the same table.'));

  if (!tt || !st || !tc || !sc) return finish(issues);

  const resolved: ResolvedCandidate = {
    targetTable: tt.name, targetColumn: tc.name, targetType: tc.dataType,
    sourceTable: st.name, sourceColumn: sc.name, sourceType: sc.dataType, compat: 'unknown',
  };

  // Types
  const cmp = compat(sc.dataType, tc.dataType);
  resolved.compat = cmp.level;
  if (cmp.level === 'incompatible') {
    issues.push(c.transformation
      ? issue('TYPE_INCOMPATIBLE', 'warning', `${cmp.note}; accepted only because a transformation is stated - confirm it.`)
      : issue('TYPE_INCOMPATIBLE', 'error', `${cmp.note}: ${sc.dataType} -> ${tc.dataType} with no stated transformation.`));
  } else if (cmp.level === 'warn') issues.push(issue('TYPE_CONVERSION', 'warning', cmp.note));
  else if (cmp.level === 'unknown') issues.push(issue('TYPE_UNKNOWN', 'info', cmp.note));

  // Conflicts with documented mappings
  const sameTarget = model.mappings.filter((m) => up(m.targetTable) === up(tt.name) && up(m.targetColumn) === up(tc.name));
  const feeding = sameTarget.filter(isFeeding);
  const documented = feeding.find((m) => up(m.sourceTable) === up(st.name) && m.sourceColumns.some((x) => up(x) === up(sc.name)));
  if (documented) issues.push(issue('ALREADY_DOCUMENTED', 'info', `The workbook already documents this exact mapping (${documented.sheet} row ${documented.rowNo}).`));
  else if (feeding.length) {
    const f = feeding[0];
    issues.push(issue('TARGET_ALREADY_MAPPED', 'warning', `${tt.name}.${tc.name} is already fed in the workbook by ${f.sourceTable}.${f.sourceColumns.join('+') || '?'} (${f.sheet} row ${f.rowNo}); this would be a second source.`));
  }
  if (sameTarget.some((m) => NONFEED.has(m.mapType.toUpperCase()))) {
    issues.push(issue('TARGET_DECLARED_NOT_FED', 'warning', `The workbook marks ${tt.name}.${tc.name} as ${sameTarget.find((m) => NONFEED.has(m.mapType.toUpperCase()))?.mapType}; confirm before mapping.`));
  }
  const other = model.mappings.find((m) => isFeeding(m) && up(m.targetTable) === up(tt.name) && up(m.targetColumn) !== up(tc.name)
    && up(m.sourceTable) === up(st.name) && m.sourceColumns.some((x) => up(x) === up(sc.name)));
  if (other) issues.push(issue('SOURCE_FEEDS_OTHER_COLUMN', 'warning', `${st.name}.${sc.name} already feeds ${tt.name}.${other.targetColumn} in the workbook.`));

  // Lineage
  const feeders = idx.feedersByTarget.get(up(tt.name));
  if (!feeders || !feeders.has(up(st.name))) {
    issues.push(issue('SOURCE_NOT_IN_LINEAGE', 'warning', feeders
      ? `${st.name} is not a documented source of ${tt.name} (documented: ${Array.from(feeders).join(', ')}).`
      : `No source table is documented for ${tt.name}, so ${st.name} cannot be checked against its lineage.`));
  }

  if (c.ambiguous) issues.push(issue('AMBIGUOUS_CANDIDATE', 'warning', 'Another candidate scored almost as well; a human must choose.'));
  return finish(issues, resolved);
}

type IssueList = ValidationIssue[];

/**
 * Validate a set of proposals together so conflicts BETWEEN them are flagged as well: several sources for one target,
 * or one source claimed by several targets of the same table.
 */
export function validateCandidateBatch(model: WorkbookModel, cands: CandidateMapping[]): ValidationResult[] {
  const results = cands.map((c) => validateCandidateMapping(model, c));
  const key = (a: string, b: string) => `${up(a)}::${up(b)}`;
  const bySource = new Map<string, Set<string>>();
  const byTarget = new Map<string, Set<string>>();
  cands.forEach((c, i) => {
    if (!results[i].valid) return;
    const t = key(c.targetTable, c.targetColumn);
    const s = key(c.sourceTable, c.sourceColumn);
    byTarget.set(t, (byTarget.get(t) ?? new Set()).add(s));
    const sk = `${up(c.targetTable)}|${s}`;
    bySource.set(sk, (bySource.get(sk) ?? new Set()).add(t));
  });
  return cands.map((c, i) => {
    const r = results[i];
    if (!r.valid) return r;
    const extra: ValidationIssue[] = [];
    const rivals = byTarget.get(key(c.targetTable, c.targetColumn));
    if (rivals && rivals.size > 1) extra.push(issue('AMBIGUOUS_TARGET', 'warning', `${rivals.size} different source columns were proposed for ${c.targetTable}.${c.targetColumn}; a human must choose one.`));
    const claimed = bySource.get(`${up(c.targetTable)}|${key(c.sourceTable, c.sourceColumn)}`);
    if (claimed && claimed.size > 1) extra.push(issue('SOURCE_CLAIMED_TWICE', 'warning', `${c.sourceTable}.${c.sourceColumn} was proposed for ${claimed.size} different columns of ${c.targetTable}.`));
    return extra.length ? finish([...r.issues, ...extra], r.resolved) : r;
  });
}
