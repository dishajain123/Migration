import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, TableDef, WorkbookModel } from '@/types';
import { buildCalibration, calibrate, MIN_CURVE_SUPPORT, type Prediction } from './mappingCalibration';
import { computeMetrics, eligibleCases, formatReport, runHoldout, type CaseResult } from './mappingEval';
import { validateCandidateBatch, validateCandidateMapping } from './mappingValidator';
import { parseWorkbookCsv } from './parse';
import { suggestionsForTable } from './suggest';

const col = (table: string, name: string, dataType: string, n = 0, traqOnly = false): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly, sheet: 's', rowNo: n });
const tbl = (name: string, system: TableDef['system'], layer: TableDef['layer'], columns: ColumnDef[]): TableDef => ({ name, system, layer, columns });
const map = (src: string, sc: string | string[], tt: string, tc: string, mapType = 'DIRECT', rowNo = 1): MappingRow => {
  const cols = Array.isArray(sc) ? sc : sc ? [sc] : [];
  return { id: `${tt}.${tc}.${rowNo}`, sourceSystem: 'X', sourceTable: src, sourceColumn: cols.join(','), sourceColumns: cols, sourceType: '', targetTable: tt, targetColumn: tc, targetType: '', mapType, remark: '', sheet: 'S', rowNo };
};

const SAME_NAME: [string, string][] = [
  ['BRANCH_CODE', 'VARCHAR2(10)'], ['PRODUCT_CODE', 'VARCHAR2(10)'], ['OPEN_DATE', 'DATE'], ['MATURITY_DATE', 'DATE'], ['CURRENCY_CODE', 'VARCHAR2(3)'],
  ['ACCOUNT_STATUS', 'VARCHAR2(5)'], ['INTEREST_RATE', 'NUMBER(9)'], ['SANCTION_AMOUNT', 'NUMBER(15)'], ['REGION_NAME', 'VARCHAR2(30)'], ['SEGMENT_CODE', 'VARCHAR2(4)'],
];

function model(): WorkbookModel {
  const src = tbl('CM_ACCT', 'CrisMac', 'CRISMAC', [...SAME_NAME.map(([n, t], i) => col('CM_ACCT', n, t, i)), col('CM_ACCT', 'LEGACY_REF', 'VARCHAR2(8)', 20), col('CM_ACCT', 'BIG_NUM', 'NUMBER(20)', 21), col('CM_ACCT', 'EXTRA_A', 'VARCHAR2(4)', 24), col('CM_ACCT', 'EXTRA_B', 'VARCHAR2(4)', 25)]);
  const tgt = tbl('STG_T', 'TRAQ', 'STAGING', [...SAME_NAME.map(([n, t], i) => col('STG_T', n, t, i)), col('STG_T', 'ZZ_QQ_KEY', 'VARCHAR2(8)', 20), col('STG_T', 'TRAQ_ONLY_COL', 'VARCHAR2(8)', 22, true), col('STG_T', 'MULTI', 'VARCHAR2(8)', 23)]);
  return {
    tables: [src, tgt],
    mappings: [
      ...SAME_NAME.map(([n], i) => map('CM_ACCT', n, 'STG_T', n, 'DIRECT', i + 1)),
      map('CM_ACCT', 'LEGACY_REF', 'STG_T', 'ZZ_QQ_KEY', 'RENAME', 40),
      map('CM_ACCT', ['EXTRA_A', 'EXTRA_B'], 'STG_T', 'MULTI', 'DIRECT', 41), // two sources: not eligible
      map('CM_ACCT', 'BIG_NUM', 'STG_T', 'INTEREST_RATE', 'DERIVED', 42), // second feeding row for INTEREST_RATE: both ineligible
    ],
    unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
  } as WorkbookModel;
}

describe('holdout evaluation', () => {
  it('only uses 1:1 DIRECT/RENAME rows that are the sole feed of their target column', () => {
    const ids = eligibleCases(model()).map((c) => c.id);
    expect(ids).toContain('STG_T.ZZ_QQ_KEY');
    expect(ids).toContain('STG_T.BRANCH_CODE');
    expect(ids).not.toContain('STG_T.MULTI'); // multi-source row
    expect(ids).not.toContain('STG_T.INTEREST_RATE'); // two feeding rows, no unambiguous answer
  });

  it('is deterministic and leaves the input model untouched', () => {
    const m = model();
    const before = m.mappings.length;
    const a = runHoldout(m, 3);
    const b = runHoldout(m, 3);
    expect(m.mappings.length).toBe(before);
    expect(b.results).toEqual(a.results);
  });

  it('finds identical-name columns after hiding them, and does not leak a hidden rename it has no evidence for', () => {
    const r = runHoldout(model(), 3);
    const byId = new Map(r.results.map((x) => [x.id, x]));
    for (const [n] of SAME_NAME) {
      if (n === 'INTEREST_RATE') continue; // ineligible (see above)
      const x = byId.get(`STG_T.${n}`);
      expect(x?.correct, `${n}: ${JSON.stringify(x)}`).toBe(true);
      expect(x?.reachable).toBe(true);
    }
    const hidden = byId.get('STG_T.ZZ_QQ_KEY')!;
    expect(hidden.correct).toBe(false);
    expect(hidden.outcome).toBe('no-suggestion');
    expect(hidden.reachable).toBe(true); // it was a candidate, the engine just had no basis to pick it
    expect(r.metrics.precision).toBe(1);
    expect(r.metrics.recall).toBeGreaterThan(0.8);
    expect(r.metrics.recall).toBeLessThan(1);
  });

  it('computes precision, recall and ambiguity rate from outcomes', () => {
    const base = { fold: 0, status: 'suggested', inTop3: false } as const;
    const rs: CaseResult[] = [
      { ...base, id: 'a', truth: 't.a', reachable: true, predicted: 't.a', rawScore: 0.9, ambiguous: false, correct: true, outcome: 'correct' },
      { ...base, id: 'b', truth: 't.b', reachable: true, predicted: 't.x', rawScore: 0.5, ambiguous: false, correct: false, outcome: 'wrong' },
      { ...base, id: 'c', truth: 't.c', reachable: true, predicted: 't.c', rawScore: 0.5, ambiguous: true, correct: true, outcome: 'ambiguous-correct' },
      { ...base, id: 'd', truth: 't.d', reachable: false, ambiguous: false, correct: false, outcome: 'no-suggestion', status: 'no-match' },
    ];
    const m = computeMetrics(rs);
    expect(m.cases).toBe(4);
    expect(m.predicted).toBe(3);
    expect(m.correct).toBe(2);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.recall).toBeCloseTo(2 / 4);
    expect(m.recallOfReachable).toBeCloseTo(2 / 3);
    expect(m.ambiguityRate).toBeCloseTo(1 / 3);
    expect(m.precisionClear).toBeCloseTo(1 / 2);
    expect(m.precisionAmbiguous).toBe(1);
  });
});

describe('calibration', () => {
  const preds = (n: number, score: number, hitRate: number, ambiguous = false): Prediction[] =>
    Array.from({ length: n }, (_, i) => ({ score, ambiguous, correct: i < Math.round(n * hitRate) }));

  it('maps score bands to measured precision and never lets a higher score mean lower precision', () => {
    const cal = buildCalibration([...preds(30, 0.4, 0.3), ...preds(30, 0.6, 0.2), ...preds(30, 0.9, 0.95)]);
    const lo = calibrate(cal, 0.4, false);
    const mid = calibrate(cal, 0.6, false);
    const hi = calibrate(cal, 0.9, false);
    expect(lo.basis).toBe('calibrated');
    expect(hi.confidence).toBeGreaterThan(85);
    expect(mid.confidence).toBeGreaterThanOrEqual(lo.confidence); // 0.2 < 0.3 measured, pooled up to stay monotone
    expect(hi.confidence).toBeGreaterThanOrEqual(mid.confidence);
    for (const c of [cal.pooled, cal.clear, cal.ambiguous]) for (let i = 1; i < c.length; i++) expect(c[i].precision).toBeGreaterThanOrEqual(c[i - 1].precision - 1e-12);
  });

  it('falls back to the raw score, labelled uncalibrated, when there is too little evidence', () => {
    const cal = buildCalibration(preds(MIN_CURVE_SUPPORT - 1, 0.7, 1));
    const r = calibrate(cal, 0.7, false);
    expect(r.basis).toBe('uncalibrated');
    expect(r.confidence).toBe(70);
    expect(r.support).toBe(0);
  });

  it('uses the ambiguous curve only when it has enough support, else the pooled curve', () => {
    const cal = buildCalibration([...preds(40, 0.6, 0.9), ...preds(5, 0.6, 0, true)]);
    const amb = calibrate(cal, 0.6, true);
    expect(amb.basis).toBe('calibrated');
    expect(amb.support).toBe(45); // 5 ambiguous predictions are too few, so the pooled curve (all 45) is used
    expect(calibrate(cal, 0.6, false).support).toBe(40);
  });
});

describe('validateCandidateMapping', () => {
  const ok = { targetTable: 'STG_T', targetColumn: 'ZZ_QQ_KEY', sourceTable: 'CM_ACCT', sourceColumn: 'LEGACY_REF' };
  const codes = (r: ReturnType<typeof validateCandidateMapping>) => r.issues.map((i) => i.code);

  it('accepts a real, type-compatible proposal and returns canonical names (case-insensitive input)', () => {
    const m = model();
    m.mappings = m.mappings.filter((x) => x.targetColumn !== 'ZZ_QQ_KEY'); // make the target unfed
    const r = validateCandidateMapping(m, { ...ok, sourceColumn: 'legacy_ref', targetColumn: 'zz_qq_key', origin: 'llm' });
    expect(r.valid).toBe(true);
    expect(r.resolved?.sourceColumn).toBe('LEGACY_REF');
    expect(r.resolved?.compat).toBe('compatible');
  });

  it('rejects columns and tables that are not in the schema (the LLM-hallucination guard)', () => {
    const m = model();
    expect(codes(validateCandidateMapping(m, { ...ok, sourceColumn: 'NOT_A_COLUMN' }))).toContain('SOURCE_COLUMN_MISSING');
    expect(codes(validateCandidateMapping(m, { ...ok, sourceTable: 'NOPE' }))).toContain('SOURCE_TABLE_MISSING');
    expect(codes(validateCandidateMapping(m, { ...ok, targetColumn: 'NOPE' }))).toContain('TARGET_COLUMN_MISSING');
    expect(codes(validateCandidateMapping(m, { ...ok, targetTable: 'NOPE' }))).toContain('TARGET_TABLE_MISSING');
    expect(validateCandidateMapping(m, { ...ok, sourceColumn: 'NOT_A_COLUMN' }).valid).toBe(false);
  });

  it('rejects mapping onto a TRAQ-only column and into out-of-scope targets', () => {
    const m = model();
    expect(codes(validateCandidateMapping(m, { ...ok, targetColumn: 'TRAQ_ONLY_COL' }))).toContain('TARGET_TRAQ_ONLY');
    expect(codes(validateCandidateMapping(m, { ...ok, targetTable: 'CM_ACCT', targetColumn: 'BRANCH_CODE', sourceTable: 'STG_T', sourceColumn: 'BRANCH_CODE' }))).toContain('TARGET_NOT_LOAD_PATH');
  });

  it('flags a number<->date clash as an error unless a transformation is stated, and conversions as warnings', () => {
    const m = model();
    const clash = { targetTable: 'STG_T', targetColumn: 'OPEN_DATE', sourceTable: 'CM_ACCT', sourceColumn: 'BIG_NUM' };
    expect(validateCandidateMapping(m, clash).valid).toBe(false);
    expect(codes(validateCandidateMapping(m, clash))).toContain('TYPE_INCOMPATIBLE');
    const withT = validateCandidateMapping(m, { ...clash, transformation: 'lookup through calendar' });
    expect(withT.valid).toBe(true);
    expect(withT.status).toBe('valid_with_warnings');
    const conv = validateCandidateMapping(m, { targetTable: 'STG_T', targetColumn: 'REGION_NAME', sourceTable: 'CM_ACCT', sourceColumn: 'BIG_NUM' });
    expect(codes(conv)).toContain('TYPE_CONVERSION');
  });

  it('flags conflicts with documented mappings and ambiguity', () => {
    const m = model();
    const second = validateCandidateMapping(m, { targetTable: 'STG_T', targetColumn: 'BRANCH_CODE', sourceTable: 'CM_ACCT', sourceColumn: 'REGION_NAME' });
    expect(codes(second)).toContain('TARGET_ALREADY_MAPPED');
    expect(codes(second)).toContain('SOURCE_FEEDS_OTHER_COLUMN');
    expect(codes(validateCandidateMapping(m, { targetTable: 'STG_T', targetColumn: 'BRANCH_CODE', sourceTable: 'CM_ACCT', sourceColumn: 'BRANCH_CODE' }))).toContain('ALREADY_DOCUMENTED');
    expect(codes(validateCandidateMapping(m, { ...ok, ambiguous: true }))).toContain('AMBIGUOUS_CANDIDATE');
  });

  it('flags conflicts between proposals in a batch', () => {
    const m = model();
    const batch = validateCandidateBatch(m, [
      { ...ok }, { ...ok, sourceColumn: 'REGION_NAME' },
      { ...ok, targetColumn: 'MULTI', sourceColumn: 'LEGACY_REF' },
    ]);
    expect(batch[0].issues.map((i) => i.code)).toContain('AMBIGUOUS_TARGET');
    expect(batch[1].issues.map((i) => i.code)).toContain('AMBIGUOUS_TARGET');
    expect(batch[0].issues.map((i) => i.code)).toContain('SOURCE_CLAIMED_TWICE');
  });
});

describe('suggestions use the validator and calibration', () => {
  it('keeps raw score, marks basis, attaches validation and never auto-approves', () => {
    const m = model();
    m.mappings = m.mappings.filter((x) => x.targetColumn !== 'BRANCH_CODE'); // BRANCH_CODE becomes unfed
    const s = suggestionsForTable(m, 'STG_T').find((x) => x.targetColumn === 'BRANCH_CODE');
    expect(s?.sourceColumn).toBe('BRANCH_CODE');
    expect(s?.rawScore).toBeGreaterThan(0.9);
    expect(['calibrated', 'uncalibrated']).toContain(s?.confidenceBasis);
    expect(s?.validation).toBeDefined();
    expect(s?.origin).toBe('mock'); // still Simulated
  });
});

describe('baseline on the real workbook', () => {
  const csv = readFileSync(new URL('../../public/data/CrisMac_to_TRAQ_Combined.csv', import.meta.url), 'utf8');
  const wb = parseWorkbookCsv(csv);

  it('reports precision / recall / ambiguity and a monotone calibration', () => {
    const r = runHoldout(wb);
    // eslint-disable-next-line no-console
    console.log(`\n${formatReport(r)}\n`);
    expect(r.metrics.cases).toBeGreaterThan(0);
    for (const v of [r.metrics.precision, r.metrics.recall, r.metrics.ambiguityRate, r.metrics.recallOfReachable]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(r.metrics.correct).toBeLessThanOrEqual(r.metrics.predicted);
    expect(r.metrics.predicted).toBeLessThanOrEqual(r.metrics.cases);
    for (const c of [r.calibration.pooled, r.calibration.clear, r.calibration.ambiguous]) for (let i = 1; i < c.length; i++) expect(c[i].precision).toBeGreaterThanOrEqual(c[i - 1].precision - 1e-12);
  }, 120_000);
});
