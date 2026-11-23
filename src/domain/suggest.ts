import type {
  MappingIssueSummary, ProcSource, Suggestion, TableAnalysis, TargetSummary, UnfedColumn, WorkbookModel,
} from '@/types';
import { analyseTable, suggestionsFromAnalysis, tokens, unfedColumns } from './mappingEngine';
import { memo } from './memo';
import { isLoadPathTable, coverageColumns } from './selectors';
import { dateKeyLookup, dateKeyTransformation, projectDateKey } from './mappingSemantics';
import { compat, parseType } from './typeUtils';

/*
 * HEURISTIC, NOT AI. Deterministic, context-aware candidate scoring used by Agent 4. The UI labels all output of this
 * module as Simulated. The engine itself lives in `mappingEngine.ts`; this module keeps the public selectors.
 */

export { tokens, unfedColumns };

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function tableAnalysis(model: WorkbookModel, tableName: string, procs?: ProcSource[]): TableAnalysis | undefined {
  return analyseTable(model, tableName, procs);
}

export function suggestionsForTable(model: WorkbookModel, tableName: string, procs?: ProcSource[]): Suggestion[] {
  return memo(model, `sugg:${tableName}:${procs ? procs.length : 'x'}`, () => {
    const a = analyseTable(model, tableName, procs);
    return a ? suggestionsFromAnalysis(model, a) : [];
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
): { table: string; column: string; dataType: string; confidence: number; ambiguous: boolean; reasons: string[]; transformation?: string }[] {
  return memo(model, `sugg:col:${crismacColumn}:${preferTable ?? ''}`, () => {
    // A surrogate date key (proved by a workbook calendar table, e.g. SysDayMatrix) is compared, as the date it stands for,
    // only against DATE columns; the conversion is reported with the suggestion. No source type is available here.
    const lookup = dateKeyLookup(model, crismacColumn, '', true);
    const tt = lookup ? new Set(projectDateKey(model, crismacColumn, lookup)) : tokens(crismacColumn);
    const tn = norm(crismacColumn);
    const scored = model.tables
      .filter((t) => t.system === 'TRAQ' && isLoadPathTable(t))
      .flatMap((t) => coverageColumns(t).map((c) => ({ table: t.name, column: c.name, dataType: c.dataType, score: 0, exact: 0 })))
      .filter((cand) => !lookup || parseType(cand.dataType).family === 'date')
      .map((cand) => {
        const ct = tokens(cand.column);
        const exact = tn === norm(cand.column) ? 1 : 0;
        const score = 0.6 * jaccard(tt, ct) + 0.25 * (lookup ? 0.75 : 0.5) + 0.15 * exact;
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
      transformation: lookup ? dateKeyTransformation(lookup, '', crismacColumn) : undefined,
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

export function unfedWithFlags(model: WorkbookModel, tableName: string, procs?: ProcSource[]): UnfedColumn[] {
  const t = model.tables.find((x) => x.name === tableName);
  if (!t) return [];
  const sug = new Map(suggestionsForTable(model, tableName, procs).map((s) => [s.targetColumn, s]));
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
