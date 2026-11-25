import type { MappingRow, WorkbookModel } from '@/types';
import { buildCalibration, type Calibration, type Prediction } from './mappingCalibration';
import { analyseTable, candidatePool } from './mappingEngine';
import { memo } from './memo';
import { colKey, coverageColumns, isFeeding, isLoadPathTable } from './selectors';

/*
 * Ground-truth evaluation of Agent 4's deterministic suggester, using ONLY the workbook.
 *
 * Method (k-fold holdout): take the documented one-to-one DIRECT/RENAME mappings, hide a fold of them (remove the rows
 * from the model, so the column becomes "unfed" and nothing about it - alias votes, documented pairs, remark evidence -
 * leaks into scoring), run the engine on the reduced model and compare its top suggestion with the hidden answer.
 * Every fold is evaluated on a model built WITHOUT that fold's rows, so learned aliases etc. come only from the rest.
 *
 * Limits (deliberate, reported rather than hidden): FPM_DA_RULES rows and procedure SQL are not removed because they are
 * separate documents; sample procedure SQL is not passed to the engine here. Only 1:1 DIRECT/RENAME rows have an
 * unambiguous right answer, so the measured accuracy is for that mapping class, not for derived/lookup columns.
 */

const ELIGIBLE_MAP_TYPES = new Set(['DIRECT', 'RENAME', '']);
export const DEFAULT_FOLDS = 5;

const up = (s: string) => s.trim().toUpperCase();
const same = (a: { table: string; column: string }, b: { table: string; column: string }) => up(a.table) === up(b.table) && up(a.column) === up(b.column);

export interface EvalCase {
  id: string;
  targetTable: string; targetColumn: string;
  sourceTable: string; sourceColumn: string;
  row: MappingRow;
}

/** Documented mappings that have one unambiguous answer: 1 source column, DIRECT/RENAME, the only row feeding that target column. */
export function eligibleCases(model: WorkbookModel): EvalCase[] {
  return memo(model, 'eval:cases', () => {
    const tables = new Map(model.tables.map((t) => [up(t.name), t]));
    const feedingPerTarget = new Map<string, number>();
    for (const m of model.mappings) if (isFeeding(m)) feedingPerTarget.set(colKey(up(m.targetTable), up(m.targetColumn)), (feedingPerTarget.get(colKey(up(m.targetTable), up(m.targetColumn))) ?? 0) + 1);
    const out: EvalCase[] = [];
    for (const m of model.mappings) {
      if (!isFeeding(m) || !ELIGIBLE_MAP_TYPES.has(m.mapType.toUpperCase())) continue;
      if (!m.sourceTable || m.sourceColumns.length !== 1) continue;
      if (feedingPerTarget.get(colKey(up(m.targetTable), up(m.targetColumn))) !== 1) continue;
      const tt = tables.get(up(m.targetTable));
      const st = tables.get(up(m.sourceTable));
      if (!tt || !st || !isLoadPathTable(tt)) continue;
      const tc = coverageColumns(tt).find((c) => up(c.name) === up(m.targetColumn));
      const sc = st.columns.find((c) => up(c.name) === up(m.sourceColumns[0]));
      if (!tc || !sc) continue;
      out.push({ id: `${tt.name}.${tc.name}`, targetTable: tt.name, targetColumn: tc.name, sourceTable: st.name, sourceColumn: sc.name, row: m });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  });
}

export type CaseOutcome = 'correct' | 'wrong' | 'ambiguous-correct' | 'ambiguous-wrong' | 'no-suggestion';

export interface CaseResult {
  id: string;
  truth: string;
  fold: number;
  /** The documented source column was among the columns the engine compared. A miss here is a pool limit, not a scoring one. */
  reachable: boolean;
  status: string;
  predicted?: string;
  rawScore?: number;
  ambiguous: boolean;
  correct: boolean;
  /** The documented answer was among the three best accepted candidates. */
  inTop3: boolean;
  outcome: CaseOutcome;
}

export interface EvalMetrics {
  cases: number;
  reachable: number;
  /** Cases where the engine proposed something (suggested or ambiguous). */
  predicted: number;
  correct: number;
  ambiguous: number;
  /** correct / predicted */
  precision: number;
  /** Precision counting only unambiguous suggestions. */
  precisionClear: number;
  /** Precision of the ambiguous top-1 guesses. */
  precisionAmbiguous: number;
  /** correct / cases */
  recall: number;
  /** correct / reachable: recall if the candidate pool were the only limit. */
  recallOfReachable: number;
  /** documented answer in the top 3 accepted candidates / cases */
  recallAt3: number;
  /** ambiguous / predicted */
  ambiguityRate: number;
  /** predicted / cases */
  coverage: number;
}

export interface EvalReport {
  folds: number;
  metrics: EvalMetrics;
  results: CaseResult[];
  calibration: Calibration;
  /** Status histogram of the engine's verdict for the held-out columns. */
  statuses: Record<string, number>;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function computeMetrics(results: CaseResult[]): EvalMetrics {
  const predicted = results.filter((r) => r.predicted !== undefined);
  const clear = predicted.filter((r) => !r.ambiguous);
  const amb = predicted.filter((r) => r.ambiguous);
  const correct = predicted.filter((r) => r.correct).length;
  const reachable = results.filter((r) => r.reachable).length;
  return {
    cases: results.length, reachable, predicted: predicted.length, correct, ambiguous: amb.length,
    precision: ratio(correct, predicted.length),
    precisionClear: ratio(clear.filter((r) => r.correct).length, clear.length),
    precisionAmbiguous: ratio(amb.filter((r) => r.correct).length, amb.length),
    recall: ratio(correct, results.length),
    recallOfReachable: ratio(results.filter((r) => r.reachable && r.correct).length, reachable),
    recallAt3: ratio(results.filter((r) => r.inTop3).length, results.length),
    ambiguityRate: ratio(amb.length, predicted.length),
    coverage: ratio(predicted.length, results.length),
  };
}

/**
 * Run the k-fold holdout. Deterministic: cases are sorted, fold = index mod k. Uses the raw engine (`analyseTable`),
 * never the calibrated `suggestionsForTable`, so calibration can be fitted from this run without circularity.
 */
export function runHoldout(model: WorkbookModel, folds = DEFAULT_FOLDS): EvalReport {
  const cases = eligibleCases(model);
  const k = Math.max(2, Math.min(folds, cases.length || 2));
  const tableDefs = new Map(model.tables.map((t) => [up(t.name), t]));
  const results: CaseResult[] = [];
  const statuses: Record<string, number> = {};

  for (let f = 0; f < k; f++) {
    const held = cases.filter((_, i) => i % k === f);
    if (held.length === 0) continue;
    const hidden = new Set(held.map((c) => c.row));
    const reduced: WorkbookModel = { ...model, mappings: model.mappings.filter((m) => !hidden.has(m)) };
    const analyses = new Map<string, ReturnType<typeof analyseTable>>();
    for (const c of held) {
      if (!analyses.has(c.targetTable)) analyses.set(c.targetTable, analyseTable(reduced, c.targetTable));
    }
    const pools = new Map<string, { table: string; column: string }[]>();
    for (const c of held) {
      const truth = { table: c.sourceTable, column: c.sourceColumn };
      const a = analyses.get(c.targetTable);
      const col = a?.columns.find((x) => x.targetColumn === c.targetColumn);
      const t = tableDefs.get(up(c.targetTable));
      if (t && !pools.has(t.name)) pools.set(t.name, candidatePool(reduced, t));
      const reachable = (pools.get(c.targetTable) ?? []).some((p) => same(p, truth));
      const status = col?.status ?? 'missing';
      statuses[status] = (statuses[status] ?? 0) + 1;
      const proposes = !!col && (col.status === 'suggested' || col.status === 'ambiguous') && !!col.best;
      const accepted = (col?.candidates ?? []).filter((x) => x.accepted);
      const predicted = proposes ? col?.best : undefined;
      const correct = !!predicted && same({ table: predicted.table, column: predicted.column }, truth);
      const ambiguous = col?.status === 'ambiguous';
      const outcome: CaseOutcome = !predicted ? 'no-suggestion'
        : ambiguous ? (correct ? 'ambiguous-correct' : 'ambiguous-wrong') : correct ? 'correct' : 'wrong';
      results.push({
        id: c.id, truth: `${c.sourceTable}.${c.sourceColumn}`, fold: f, reachable, status,
        predicted: predicted ? `${predicted.table}.${predicted.column}` : undefined,
        rawScore: predicted?.score, ambiguous, correct,
        inTop3: accepted.slice(0, 3).some((x) => same({ table: x.table, column: x.column }, truth)),
        outcome,
      });
    }
  }

  const preds: Prediction[] = results.filter((r) => r.predicted !== undefined && r.rawScore !== undefined)
    .map((r) => ({ score: r.rawScore as number, ambiguous: r.ambiguous, correct: r.correct }));
  return { folds: k, metrics: computeMetrics(results), results, calibration: buildCalibration(preds), statuses };
}

/** The holdout calibration for a model, computed once per parsed workbook (lazily: first caller pays the cost). */
export function calibrationFor(model: WorkbookModel): Calibration {
  return memo(model, 'eval:calibration', () => runHoldout(model).calibration);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Plain-text report for the CLI script and the docs. */
export function formatReport(r: EvalReport): string {
  const m = r.metrics;
  const lines = [
    `Holdout evaluation (${r.folds}-fold, deterministic) - documented DIRECT/RENAME 1:1 mappings hidden, then re-suggested`,
    `  held-out cases        ${m.cases}  (documented source column in the candidate pool: ${m.reachable}, ${pct(ratio(m.reachable, m.cases))})`,
    `  proposed a mapping    ${m.predicted}  (coverage ${pct(m.coverage)})`,
    `  correct top-1         ${m.correct}`,
    `  precision             ${pct(m.precision)}   (unambiguous only ${pct(m.precisionClear)}; ambiguous top-1 ${pct(m.precisionAmbiguous)})`,
    `  recall                ${pct(m.recall)}   (of reachable ${pct(m.recallOfReachable)}; documented answer in top 3 ${pct(m.recallAt3)})`,
    `  ambiguity rate        ${pct(m.ambiguityRate)}   (${m.ambiguous} of ${m.predicted} proposals)`,
    `  engine verdicts       ${Object.entries(r.statuses).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    '  calibration (raw score band -> measured precision):',
  ];
  for (const [name, curve] of [['pooled', r.calibration.pooled], ['clear', r.calibration.clear], ['ambiguous', r.calibration.ambiguous]] as const) {
    lines.push(`    ${name}: ${curve.map((b) => `[${b.lo.toFixed(2)}-${Math.min(1, b.hi).toFixed(2)}) n=${b.n} -> ${(b.precision * 100).toFixed(0)}%`).join('  ')}`);
  }
  return lines.join('\n');
}
