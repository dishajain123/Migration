import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, TableDef, WorkbookModel } from '@/types';
import type { MappingDecisionRecord } from '@/types/decisions';
import { evaluateAgainstDecisions, formatDecisionReport } from './decisionEval';
import { transformationExamples } from './transformExamples';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const row = (over: Partial<MappingRow>): MappingRow => ({ id: 'm', sourceSystem: 'X', sourceTable: 'CM_ACCT', sourceColumn: 'ACCT_NO', sourceColumns: ['ACCT_NO'], sourceType: '', targetTable: 'STG_T', targetColumn: 'ACCT_NUMBER', targetType: '', mapType: 'DIRECT', remark: '', sheet: 'S', rowNo: 1, ...over });

const model = {
  tables: [
    { name: 'CM_ACCT', system: 'CrisMac', layer: 'CRISMAC', columns: [col('CM_ACCT', 'ACCT_NO', 'VARCHAR2(20)'), col('CM_ACCT', 'BRANCH_CODE', 'VARCHAR2(10)'), col('CM_ACCT', 'BRANCH_NAME', 'VARCHAR2(30)')] } as TableDef,
    { name: 'STG_T', system: 'TRAQ', layer: 'STAGING', columns: [col('STG_T', 'ACCT_NUMBER', 'VARCHAR2(20)'), col('STG_T', 'BRANCH_CODE', 'VARCHAR2(10)')] } as TableDef,
  ],
  mappings: [
    row({}),
    row({ id: 'r2', rowNo: 2, targetColumn: 'STATUS_TXT', sourceColumn: 'STATUS_CD', sourceColumns: ['STATUS_CD'], mapType: 'DERIVED', remark: "Map code to text: 'A' = ACTIVE" }),
  ],
  unmapped: [], daRules: [{ run: '', column: 'BRANCH_CODE', kind: '', dataType: '', ruleType: '', inForceFrom: '', crismac: '', reads: '', logic: 'default', expression: "ISNULL(BRANCH_CODE, '000')", version: '', rowNo: 7 }],
  decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as WorkbookModel;

const rec = (over: Partial<MappingDecisionRecord>): MappingDecisionRecord => ({
  id: 'd', targetTable: 'STG_T', targetColumn: 'BRANCH_CODE', sourceTable: 'CM_ACCT', sourceColumn: 'BRANCH_CODE', decision: 'approved', origin: 'heuristic', comment: '', decidedAt: '2026-11-01T00:00:00.000Z', ...over,
});

describe('evaluateAgainstDecisions', () => {
  it('counts approvals the engine agrees with and rejections it still proposes', () => {
    const r = evaluateAgainstDecisions(model, [
      rec({ id: 'a1' }),
      rec({ id: 'r1', decision: 'rejected', sourceColumn: 'BRANCH_NAME' }),
      rec({ id: 'r2', decision: 'rejected', sourceColumn: 'BRANCH_CODE' }),
      rec({ id: 'x1', targetColumn: 'ACCT_NUMBER' }), // already fed by a documented mapping: not an unfed column any more
      rec({ id: 'x2', targetTable: 'NOPE' }),
    ]);
    expect(r.evaluated).toBe(3);
    expect(r.skipped).toBe(2);
    expect(r.approved).toBe(1);
    expect(r.agreeTop1).toBe(1);
    expect(r.approvedPrecisionAtTop1).toBe(1);
    expect(r.rejected).toBe(2);
    expect(r.rejectedStillTop1).toBe(1); // BRANCH_CODE is still the engine's first choice, so it conflicts with the rejection
    expect(formatDecisionReport(r)).toMatch(/approved\s+1: engine top-1 agrees 1 \(100.0%\)/);
  });

  it('reports zeros without dividing by zero', () => {
    const r = evaluateAgainstDecisions(model, []);
    expect(r).toMatchObject({ evaluated: 0, approved: 0, approvedPrecisionAtTop1: 0, rejectedStillTop1: 0 });
  });
});

describe('transformationExamples (few-shot context)', () => {
  it('quotes workbook remarks, FPM_DA_RULES and approved decisions verbatim, and turns rejections into do-not-repeat notes', () => {
    const { examples, decisionNotes } = transformationExamples(model, 'STG_T', undefined, [
      rec({ id: 'ok', targetColumn: 'STATUS_TXT', sourceColumn: 'STATUS_CD', transformation: "CASE WHEN STATUS_CD = 'A' THEN 'ACTIVE' END" }),
      rec({ id: 'no', decision: 'rejected', sourceColumn: 'BRANCH_NAME', comment: 'different meaning' }),
      rec({ id: 'other', decision: 'rejected', targetTable: 'OTHER_T', sourceColumn: 'Z' }),
    ]);
    const all = examples.join('\n');
    expect(all).toMatch(/Workbook S row 2 \(DERIVED\): .*STATUS_CD -> STG_T.STATUS_TXT: "Map code to text: 'A' = ACTIVE"/);
    expect(all).toMatch(/FPM_DA_RULES row 7: BRANCH_CODE \(default\): ISNULL\(BRANCH_CODE, '000'\)/);
    expect(all).toMatch(/Human-approved: CM_ACCT.STATUS_CD -> STG_T.STATUS_TXT using CASE WHEN/);
    expect(decisionNotes).toHaveLength(1);
    expect(decisionNotes[0]).toMatch(/REJECTED CM_ACCT.BRANCH_NAME -> STG_T.BRANCH_CODE.*different meaning.*do not propose it again/);
  });

  it('adds nothing when there is nothing to quote (no invented examples)', () => {
    const empty = { ...model, mappings: [row({})], daRules: [] } as WorkbookModel;
    expect(transformationExamples(empty, 'STG_T', undefined, undefined)).toEqual({ examples: [], decisionNotes: [] });
  });

  it('includes computed expressions from procedure SQL but not plain column copies', () => {
    const procs = [{
      file: '01_S01_X.sql', steps: [{
        housekeeping: false, table: 'STG_T', lineStart: 12,
        columns: [{ name: 'BRANCH_CODE', expression: "ISNULL(B, '000')", expressionFull: "ISNULL(B, '000')" }, { name: 'ACCT_NUMBER', expression: 'A.ACCT_NO', expressionFull: 'A.ACCT_NO' }],
      }],
    }] as unknown as Parameters<typeof transformationExamples>[2];
    const { examples } = transformationExamples({ ...model, daRules: [] } as WorkbookModel, 'STG_T', procs, undefined);
    expect(examples.some((e) => /Procedure 01_S01_X.sql line 12: STG_T.BRANCH_CODE = ISNULL/.test(e))).toBe(true);
    expect(examples.some((e) => /ACCT_NUMBER/.test(e))).toBe(false);
  });
});
