import type {
  MappingIssueSummary, Suggestion, TableDef, TargetSummary, UnfedColumn, WorkbookModel,
} from '@/types';
import { memo } from './memo';
import { colKey, fedKeySet, isLoadPathTable, coverageColumns, mappingsByTarget } from './selectors';
import { compat, parseType } from './typeUtils';

/*
 * HEURISTIC, NOT AI. Deterministic name-token + type-family scoring used to demo the mapping agent.
 * The UI labels all output of this module as Simulated.
 */

export function tokens(name: string): Set<string> {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return new Set(spaced.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Candidate { table: string; column: string; type: string; tokens: Set<string>; norm: string }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function poolFor(model: WorkbookModel, t: TableDef): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (table: string, column: string, type: string) => {
    const k = colKey(table, column);
    if (seen.has(k) || !column) return;
    seen.add(k);
    out.push({ table, column, type, tokens: tokens(column), norm: norm(column) });
  };
  // 1) CrisMac columns listed for this sheet with no TRAQ target and no decision
  for (const u of model.unmapped) {
    if (u.sheet === t.name && !u.traqColumn && !u.decision) add(u.sourceTable, u.column, u.dataType);
  }
  // 2) For MART targets, columns of staging tables that already feed this table
  if (t.layer === 'MART') {
    const feeders = new Set<string>();
    for (const m of model.mappings) if (m.targetTable === t.name && m.sourceTable) feeders.add(m.sourceTable);
    for (const st of model.tables) {
      if (st.layer === 'STAGING' && feeders.has(st.name)) for (const c of st.columns) add(st.name, c.name, c.dataType);
    }
  }
  return out;
}

export function unfedColumns(model: WorkbookModel, t: TableDef): UnfedColumn[] {
  const fed = fedKeySet(model);
  const byTarget = mappingsByTarget(model);
  return coverageColumns(t)
    .filter((c) => !fed.has(colKey(t.name, c.name)))
    .map((c) => {
      const rows = byTarget.get(colKey(t.name, c.name)) ?? [];
      const reason = rows.length ? rows.map((r) => r.mapType || 'no map type').join(', ') : 'no mapping row in workbook';
      return {
        targetTable: t.name, targetColumn: c.name, targetType: c.dataType, nullable: c.nullable, reason,
        hasSuggestion: false, ambiguous: false,
      };
    });
}

export function suggestionsForTable(model: WorkbookModel, tableName: string): Suggestion[] {
  return memo(model, `sugg:${tableName}`, () => {
    const t = model.tables.find((x) => x.name === tableName);
    if (!t) return [];
    const pool = poolFor(model, t);
    if (pool.length === 0) return [];
    const out: Suggestion[] = [];
    for (const u of unfedColumns(model, t)) {
      const tt = tokens(u.targetColumn);
      const tn = norm(u.targetColumn);
      const tParsed = parseType(u.targetType);
      const scored = pool.map((p) => {
        const sParsed = parseType(p.type);
        let typeScore = 0.5;
        if (tParsed.family !== 'unknown' && sParsed.family !== 'unknown') typeScore = tParsed.family === sParsed.family ? 1 : 0;
        const exact = tn === p.norm ? 1 : 0;
        const score = 0.6 * jaccard(tt, p.tokens) + 0.25 * typeScore + 0.15 * exact;
        return { p, score, exact };
      }).filter((x) => x.score >= 0.35).sort((a, b) => b.score - a.score);
      if (scored.length === 0) continue;
      const best = scored[0];
      const second = scored[1];
      const ambiguous = !!second && best.score - second.score < 0.05;
      const cmp = compat(best.p.type, u.targetType);
      const reasons = [`Name token overlap ${(jaccard(tt, best.p.tokens) * 100).toFixed(0)}%`];
      if (best.exact) reasons.push('Names identical (ignoring case/underscores)');
      reasons.push(`Type check: ${cmp.note}`);
      const issues: string[] = [];
      if (cmp.level === 'warn' || cmp.level === 'incompatible') issues.push(cmp.note);
      if (ambiguous) issues.push(`Ambiguous: ${scored.length} near-equal candidates (next: ${second.p.table}.${second.p.column})`);
      out.push({
        id: `sug:${t.name}.${u.targetColumn}<-${best.p.table}.${best.p.column}`,
        targetTable: t.name, targetColumn: u.targetColumn, targetType: u.targetType,
        sourceTable: best.p.table, sourceColumn: best.p.column, sourceType: best.p.type,
        confidence: Math.min(99, Math.round(best.score * 100)), reasons, issues, compat: cmp.level, ambiguous, origin: 'mock',
      });
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  });
}

/**
 * Last-resort fallback for the rule conversion resolver (`ruleConversion/resolve.ts`): given a CrisMac column with
 * no workbook/Agent-4/name-match mapping, scores every in-scope TRAQ column by the same name-token + type-family
 * heuristic as `suggestionsForTable` (same formula, same 0.35 threshold - still Simulated, still arbitrary demo
 * values). Unlike `suggestionsForTable`, this searches the whole TRAQ data model, not just a table's unfed pool,
 * because the caller is an arbitrary CrisMac column from procedure SQL, not one already listed in the workbook's
 * "no TRAQ target" sheets.
 */
export function suggestTraqColumnsForColumn(
  model: WorkbookModel, crismacColumn: string, preferTable?: string,
): { table: string; column: string; dataType: string; confidence: number; ambiguous: boolean; reasons: string[] }[] {
  return memo(model, `sugg:col:${crismacColumn}:${preferTable ?? ''}`, () => {
    const tt = tokens(crismacColumn);
    const tn = norm(crismacColumn);
    const scored = model.tables
      .filter((t) => t.system === 'TRAQ' && isLoadPathTable(t))
      .flatMap((t) => coverageColumns(t).map((c) => ({ table: t.name, column: c.name, dataType: c.dataType, score: 0, exact: 0 })))
      .map((cand) => {
        const ct = tokens(cand.column);
        const exact = tn === norm(cand.column) ? 1 : 0;
        const score = 0.6 * jaccard(tt, ct) + 0.25 * 0.5 + 0.15 * exact;
        return { ...cand, score, exact };
      })
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score || (preferTable ? Number(b.table === preferTable) - Number(a.table === preferTable) : 0));
    if (scored.length === 0) return [];
    const best = scored[0];
    const second = scored.find((x) => x !== best && (x.table !== best.table || x.column !== best.column));
    const ambiguous = !!second && best.score - second.score < 0.05;
    return [{
      table: best.table, column: best.column, dataType: best.dataType, confidence: Math.min(99, Math.round(best.score * 100)), ambiguous,
      reasons: [`Name token overlap ${(jaccard(tt, tokens(best.column)) * 100).toFixed(0)}% with ${best.table}.${best.column}`, best.exact ? 'Names identical (ignoring case/underscores)' : 'No CrisMac type available, so the type check could not run'],
    }];
  });
}

export function targetSummaries(model: WorkbookModel): TargetSummary[] {
  return memo(model, 'targets', () => {
    const out: TargetSummary[] = [];
    for (const t of model.tables) {
      if (!isLoadPathTable(t)) continue;
      const cols = coverageColumns(t);
      if (cols.length === 0) continue;
      const unfed = unfedColumns(model, t).length;
      if (unfed === 0) continue;
      out.push({ table: t.name, layer: t.layer, columns: cols.length, fed: cols.length - unfed, unfed, suggestions: suggestionsForTable(model, t.name).length });
    }
    return out.sort((a, b) => b.unfed - a.unfed);
  });
}

export function unfedWithFlags(model: WorkbookModel, tableName: string): UnfedColumn[] {
  const t = model.tables.find((x) => x.name === tableName);
  if (!t) return [];
  const sug = new Map(suggestionsForTable(model, tableName).map((s) => [s.targetColumn, s]));
  return unfedColumns(model, t).map((u) => ({ ...u, hasSuggestion: sug.has(u.targetColumn), ambiguous: sug.get(u.targetColumn)?.ambiguous ?? false }));
}

export function mappingIssues(model: WorkbookModel, tableName: string): MappingIssueSummary {
  const rows = model.mappings.filter((m) => m.targetTable === tableName);
  const typeWarnings = rows
    .filter((m) => m.sourceType && m.targetType && ['DIRECT', 'RENAME', ''].includes(m.mapType.toUpperCase()))
    .map((m) => ({ mapping: m, ...compat(m.sourceType, m.targetType) }))
    .filter((x) => x.level === 'warn' || x.level === 'incompatible')
    .map((x) => ({ mapping: x.mapping, compat: x.level, note: x.note }));
  return {
    collisions: rows.filter((m) => /TARGET COLLISION/i.test(m.remark)),
    confirmationRequired: rows.filter((m) => /confirmation/i.test(m.mapType) || /confirmation (required|need)/i.test(m.remark)),
    typeWarnings,
  };
}
