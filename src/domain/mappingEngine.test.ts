import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, ProcSource, ReviewedMapping, TableDef, UnmappedColumn, WorkbookModel } from '@/types';
import { analyseTable, applyReviewed, suggestionsFromAnalysis } from './mappingEngine';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const tbl = (name: string, system: TableDef['system'], layer: TableDef['layer'], columns: ColumnDef[]): TableDef => ({ name, system, layer, columns });
const map = (src: string, sc: string, tt: string, tc: string, mapType = 'DIRECT', remark = '', rowNo = 1): MappingRow => ({
  id: `${tt}.${tc}.${rowNo}`, sourceSystem: 'X', sourceTable: src, sourceColumn: sc, sourceColumns: sc ? [sc] : [], sourceType: '', targetTable: tt, targetColumn: tc, targetType: '', mapType, remark, sheet: 'S', rowNo,
});
const unm = (table: string, column: string, dataType: string): UnmappedColumn => ({ id: `u:${table}.${column}`, sheet: 'OTHER', sourceSystem: 'X', sourceTable: table, column, dataType, traqTable: '', traqColumn: '', decision: '', note: '', rowNo: 1 });

function model(extra: Partial<WorkbookModel> = {}): WorkbookModel {
  const target = tbl('STG_T', 'TRAQ', 'STAGING', [
    col('STG_T', 'ACCOUNT_NUMBER', 'VARCHAR2(20)'), col('STG_T', 'ACCOUNT_STATUS', 'VARCHAR2(5)'), col('STG_T', 'OPEN_DATE', 'DATE'),
    col('STG_T', 'LEGACY_FLAG', 'VARCHAR2(1)'), col('STG_T', 'OVERDUE_DAYS', 'VARCHAR2(5)'), col('STG_T', 'ZZZ', 'NUMBER(5)'),
  ]);
  const lonely = tbl('STG_NOSRC', 'TRAQ', 'STAGING', [col('STG_NOSRC', 'ANYTHING', 'VARCHAR2(1)')]);
  const src = tbl('CM_ACCT', 'CrisMac', 'CRISMAC', [col('CM_ACCT', 'ACCT_NO', 'VARCHAR2(20)'), col('CM_ACCT', 'ACCT_STATUS', 'VARCHAR2(5)'), col('CM_ACCT', 'OPEN_DT', 'DATE'), col('CM_ACCT', 'AMOUNT_OVERDUE', 'NUMBER(10)')]);
  return {
    tables: [target, lonely, src],
    mappings: [
      map('CM_ACCT', 'LOAN_NO', 'STG_T', 'LOAN_NUMBER', 'DIRECT', '', 10), map('CM_ACCT', 'DEP_NO', 'STG_T', 'DEP_NUMBER', 'RENAME', '', 11),
      map('CM_ACCT', 'CUST_ID', 'STG_T', 'CUSTOMER_ID', 'DIRECT', '', 12), map('CM_ACCT', 'CUST_CODE', 'STG_T', 'CUSTOMER_CODE', 'DIRECT', '', 13),
      map('', '', 'STG_T', 'LEGACY_FLAG', 'NOT FED', 'not carried', 14),
      map('CM_ACCT', 'ACCT_TYPE', 'STG_T', 'ACCOUNT_TYPE', 'DIRECT', 'x', 15),
    ],
    unmapped: [unm('CM_ACCT', 'FILLER_X', 'VARCHAR2(1)')],
    daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
    ...extra,
  } as WorkbookModel;
}

describe('mapping engine', () => {
  it('builds the pool from feeding source tables, not only the sheet-name-keyed unmapped lists', () => {
    const a = analyseTable(model(), 'STG_T')!;
    expect(a.context.sourceTables).toContain('CM_ACCT');
    expect(a.context.poolSize).toBeGreaterThanOrEqual(4);
    expect(a.columns.find((c) => c.targetColumn === 'OPEN_DATE')?.best?.column).toBe('OPEN_DT');
  });

  it('learns abbreviations from documented mappings and applies them (NO->NUMBER, ACCT->ACCOUNT)', () => {
    const m = model();
    const a = analyseTable(m, 'STG_T')!;
    expect(a.context.learnedAliases.some((x) => x.from === 'no' && x.to === 'number')).toBe(true);
    const c = a.columns.find((x) => x.targetColumn === 'ACCOUNT_NUMBER')!;
    expect(c.best?.column).toBe('ACCT_NO');
    expect(['suggested', 'ambiguous']).toContain(c.status);
  });

  it('reports insufficient-context when nothing could be compared', () => {
    const a = analyseTable(model(), 'STG_NOSRC')!;
    expect(a.columns[0].status).toBe('insufficient-context');
    expect(a.columns[0].explanation).toMatch(/Not enough context/);
  });

  it('reports declared-unmapped for workbook NOT FED columns with no acceptable candidate', () => {
    const a = analyseTable(model(), 'STG_T')!;
    expect(a.columns.find((c) => c.targetColumn === 'LEGACY_FLAG')?.status).toBe('declared-unmapped');
  });

  it('keeps a rejected near-miss visible instead of dropping it silently', () => {
    const a = analyseTable(model(), 'STG_T')!;
    const c = a.columns.find((x) => x.targetColumn === 'OVERDUE_DAYS')!;
    expect(c.status).toBe('below-threshold');
    expect(c.best?.column).toBe('AMOUNT_OVERDUE');
    expect(c.best?.rejection).toMatch(/below the 35% acceptance threshold/);
    expect(c.candidates.every((x) => !x.accepted && !!x.rejection)).toBe(true);
  });

  it('does not map an unrelated column just because it exists', () => {
    const a = analyseTable(model(), 'STG_T')!;
    const z = a.columns.find((x) => x.targetColumn === 'ZZZ')!;
    expect(['suggested', 'ambiguous']).not.toContain(z.status);
  });

  it('rejects incompatible type families even when names match', () => {
    const m = model();
    m.tables[2].columns.push(col('CM_ACCT', 'OPEN_DATE', 'NUMBER(8)'));
    const c = analyseTable(m, 'STG_T')!.columns.find((x) => x.targetColumn === 'OPEN_DATE')!;
    const bad = c.candidates.find((x) => x.column === 'OPEN_DATE')!;
    expect(bad.accepted).toBe(false);
    expect(bad.rejection).toMatch(/Type check failed/);
  });

  it('uses remark / procedure evidence only as support, never as a match on its own', () => {
    const m = model();
    m.mappings.push(map('', '', 'STG_T', 'ZZZ', 'NOT FED', 'derive from AMOUNT_OVERDUE', 20));
    const z = analyseTable(m, 'STG_T')!.columns.find((x) => x.targetColumn === 'ZZZ')!;
    expect(z.candidates.find((x) => x.column === 'AMOUNT_OVERDUE')?.contextBonus ?? 0).toBe(0);
    expect(['suggested', 'ambiguous']).not.toContain(z.status);
  });

  it('counts procedure SQL that names a source column as evidence when the names already resemble each other', () => {
    const m = model();
    const proc = { name: 'p', file: 'p.sql', steps: [{ housekeeping: false, table: 'STG_T', lineStart: 7, columns: [{ name: 'ACCOUNT_STATUS', expression: 'x.ACCT_STATUS' }] }] } as unknown as ProcSource;
    const c = analyseTable(m, 'STG_T', [proc])!.columns.find((x) => x.targetColumn === 'ACCOUNT_STATUS')!;
    expect(c.best?.column).toBe('ACCT_STATUS');
    expect(c.best?.evidence.join(' ')).toMatch(/p\.sql line 7/);
  });

  it('marks a column resolved once the reviewer approves a mapping (previously it stayed unmapped)', () => {
    const a = analyseTable(model(), 'STG_T')!;
    const r: ReviewedMapping = { id: 'sug:x', targetTable: 'STG_T', targetColumn: 'ZZZ', targetType: '', sourceTable: 'CM_ACCT', sourceColumn: 'AMOUNT_OVERDUE', sourceType: '' };
    const after = applyReviewed(a, [r]);
    expect(after.columns.find((c) => c.targetColumn === 'ZZZ')?.status).toBe('resolved');
    expect(after.counts.resolved).toBe(1);
  });

  it('produces suggestions only for accepted candidates', () => {
    const m = model();
    const sug = suggestionsFromAnalysis(m, analyseTable(m, 'STG_T')!);
    expect(sug.every((s) => s.confidence >= 35)).toBe(true);
    expect(sug.find((s) => s.targetColumn === 'ZZZ')).toBeUndefined();
  });
});
