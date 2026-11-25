import type { WorkbookModel } from '@/types';
import type { MappingDecisionRecord } from '@/types/decisions';
import { analyseTable } from './mappingEngine';

/*
 * Evaluation against what reviewers actually decided. Approved decisions are extra ground truth beyond the workbook's
 * documented mappings; rejected ones are known-wrong answers. The raw workbook-only engine is run and compared, so this
 * shows whether the suggester keeps agreeing with the team as decisions accumulate. Pure; the script reads the stored file.
 */

const up = (s: string) => s.trim().toUpperCase();

export interface DecisionEvalRow {
  id: string;
  decision: 'approved' | 'rejected';
  target: string;
  source: string;
  engineTop1?: string;
  /** Approved: the engine's top suggestion is the approved source. Rejected: the engine still proposes the rejected source. */
  match: boolean;
  inTop3: boolean;
}

export interface DecisionEvalReport {
  /** Decisions whose target column is still unfed in the model (the only ones the engine can be asked about). */
  evaluated: number;
  /** Decisions skipped because the target is now fed by a documented mapping or no longer exists. */
  skipped: number;
  approved: number;
  agreeTop1: number;
  agreeTop3: number;
  /** agreeTop1 / approved */
  approvedPrecisionAtTop1: number;
  rejected: number;
  /** Rejected pairings the engine still proposes first. */
  rejectedStillTop1: number;
  rows: DecisionEvalRow[];
}

export function evaluateAgainstDecisions(model: WorkbookModel, decisions: MappingDecisionRecord[]): DecisionEvalReport {
  const analyses = new Map<string, ReturnType<typeof analyseTable>>();
  const rows: DecisionEvalRow[] = [];
  let skipped = 0;
  for (const d of decisions) {
    const table = model.tables.find((t) => up(t.name) === up(d.targetTable))?.name;
    if (!table) { skipped++; continue; }
    if (!analyses.has(table)) analyses.set(table, analyseTable(model, table));
    const col = analyses.get(table)?.columns.find((c) => up(c.targetColumn) === up(d.targetColumn));
    if (!col) { skipped++; continue; }
    const top = (col.status === 'suggested' || col.status === 'ambiguous') && col.best ? col.best : undefined;
    const is = (c: { table: string; column: string }) => up(c.table) === up(d.sourceTable) && up(c.column) === up(d.sourceColumn);
    rows.push({
      id: d.id, decision: d.decision, target: `${table}.${col.targetColumn}`, source: `${d.sourceTable}.${d.sourceColumn}`,
      engineTop1: top ? `${top.table}.${top.column}` : undefined, match: !!top && is(top),
      inTop3: col.candidates.filter((c) => c.accepted).slice(0, 3).some(is),
    });
  }
  const approved = rows.filter((r) => r.decision === 'approved');
  const rejected = rows.filter((r) => r.decision === 'rejected');
  const agreeTop1 = approved.filter((r) => r.match).length;
  return {
    evaluated: rows.length, skipped, approved: approved.length, agreeTop1, agreeTop3: approved.filter((r) => r.inTop3).length,
    approvedPrecisionAtTop1: approved.length ? agreeTop1 / approved.length : 0,
    rejected: rejected.length, rejectedStillTop1: rejected.filter((r) => r.match).length, rows,
  };
}

export function formatDecisionReport(r: DecisionEvalReport): string {
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
  return [
    'Evaluation against stored human decisions (workbook-only engine)',
    `  decisions evaluated   ${r.evaluated}  (skipped ${r.skipped}: target already fed or not found)`,
    `  approved              ${r.approved}: engine top-1 agrees ${r.agreeTop1} (${pct(r.agreeTop1, r.approved)}), approved source in top 3 ${r.agreeTop3} (${pct(r.agreeTop3, r.approved)})`,
    `  rejected              ${r.rejected}: engine still proposes the rejected source first for ${r.rejectedStillTop1} (${pct(r.rejectedStillTop1, r.rejected)})`,
  ].join('\n');
}
