import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, TableDef, WorkbookModel } from '@/types';
import { analyseTable, suggestionsFromAnalysis } from './mappingEngine';
import { calendarLookups, dateKeyLookup, nameTokens } from './mappingSemantics';
import { suggestTraqColumnsForColumn } from './suggest';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const tbl = (name: string, system: TableDef['system'], layer: TableDef['layer'], columns: ColumnDef[]): TableDef => ({ name, system, layer, columns });
const map = (src: string, sc: string, tt: string, tc: string, mapType = 'DIRECT', rowNo = 1, types: { s?: string; t?: string } = {}): MappingRow => ({
  id: `${tt}.${tc}.${rowNo}`, sourceSystem: 'X', sourceTable: src, sourceColumn: sc, sourceColumns: sc ? [sc] : [], sourceType: types.s ?? '', targetTable: tt, targetColumn: tc, targetType: types.t ?? '', mapType, remark: '', sheet: 'S', rowNo,
});

/** Mirrors the real workbook: a calendar table (SysDayMatrix: TimeKey int, Date datetime), D2K *TimeKey columns, DATE targets. */
function model(opts: { calendar?: boolean } = {}): WorkbookModel {
  const calendar = opts.calendar !== false;
  const tables = [
    tbl('STG_D', 'TRAQ', 'STAGING', [col('STG_D', 'BUSINESS_DATE', 'DATE'), col('STG_D', 'RECORD_START_DATE', 'DATE'), col('STG_D', 'BRANCH_COUNT', 'NUMBER(5)')]),
    tbl('CM_FEED', 'CrisMac', 'SOURCE', [col('CM_FEED', 'TIMEKEY', 'int'), col('CM_FEED', 'EFFECTIVEFROMTIMEKEY', 'int'), col('CM_FEED', 'BRANCHKEY', 'int'), col('CM_FEED', 'OTHER', 'varchar(5)')]),
    tbl('DimA', 'CrisMac', 'SOURCE', [col('DimA', 'EffectiveFromTimeKey', 'int'), col('DimA', 'EffectiveToTimeKey', 'int'), col('DimA', 'BranchKey', 'int'), col('DimA', 'BranchCode', 'varchar(5)'), col('DimA', 'FromDate', 'datetime')]),
    tbl('FCT_OTHER', 'TRAQ', 'MART', [col('FCT_OTHER', 'RECORD_START_DATE', 'DATE')]),
  ];
  if (calendar) tables.push(tbl('SysDayMatrix', 'CrisMac', 'SOURCE', [col('SysDayMatrix', 'TimeKey', 'int'), col('SysDayMatrix', 'Date', 'datetime'), col('SysDayMatrix', 'WeekDateKey', 'int')]));
  return {
    tables,
    mappings: [
      map('CM_FEED', 'OTHER', 'STG_D', 'SOME_OTHER', 'DIRECT', 1),
      // the workbook's own precedent (FCT_BUYOUT_DETAIL): a TimeKey int feeds a DATE column, DERIVED
      map('CM_FEED', 'EFFECTIVEFROMTIMEKEY', 'FCT_OTHER', 'RECORD_START_DATE', 'DERIVED', 2, { s: 'int', t: 'DATE' }),
    ],
    unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
  } as WorkbookModel;
}

describe('semantic column matching (date keys)', () => {
  it('splits TIMEKEY the same way as TimeKey, using only the workbook vocabulary', () => {
    const m = model();
    expect(nameTokens(m, 'TIMEKEY')).toEqual(['time', 'key']);
    expect(nameTokens(m, 'TimeKey')).toEqual(['time', 'key']);
    expect(nameTokens(m, 'EFFECTIVEFROMTIMEKEY')).toEqual(['effective', 'from', 'time', 'key']);
    expect(nameTokens(m, 'ZQXVWT')).toEqual(['zqxvwt']); // unknown words are left alone
  });

  it('finds the calendar lookup from workbook metadata and recognises date keys only through it', () => {
    const m = model();
    expect(calendarLookups(m)[0]).toMatchObject({ table: 'SysDayMatrix', keyColumn: 'TimeKey', dateColumn: 'Date' });
    expect(dateKeyLookup(m, 'TIMEKEY', 'int')?.table).toBe('SysDayMatrix');
    expect(dateKeyLookup(m, 'EffectiveToTimeKey', 'int')?.table).toBe('SysDayMatrix');
    expect(dateKeyLookup(m, 'BRANCHKEY', 'int')).toBeUndefined(); // a key, but not the calendar's
    expect(dateKeyLookup(m, 'TIMEKEY', 'varchar(5)')).toBeUndefined(); // type must be numeric
    expect(calendarLookups(model({ calendar: false }))).toHaveLength(0);
  });

  it('REGRESSION: TIMEKEY (int) is proposed for BUSINESS_DATE (DATE) with a lookup transformation and honest confidence', () => {
    const m = model();
    const a = analyseTable(m, 'STG_D')!;
    const c = a.columns.find((x) => x.targetColumn === 'BUSINESS_DATE')!;
    expect(['suggested', 'ambiguous']).toContain(c.status);
    expect(c.best?.column).toBe('TIMEKEY');
    expect(c.best?.transformation).toMatch(/SysDayMatrix\.Date where SysDayMatrix\.TimeKey = CM_FEED\.TIMEKEY/);
    expect(c.best?.evidence.join(' ')).toMatch(/Workbook precedent for date key -> DATE/);
    expect(c.best!.score).toBeLessThan(0.6); // no inflated confidence
    const s = suggestionsFromAnalysis(m, a).find((x) => x.targetColumn === 'BUSINESS_DATE')!;
    expect(s.transformation).toContain('SysDayMatrix');
    expect(s.issues.join(' ')).toMatch(/Requires transformation/);
    expect(s.compat).toBe('warn');
  });

  it('is not a hard-coded pair: without the workbook calendar table the same columns are NOT matched', () => {
    const a = analyseTable(model({ calendar: false }), 'STG_D')!;
    const c = a.columns.find((x) => x.targetColumn === 'BUSINESS_DATE')!;
    expect(['suggested', 'ambiguous']).not.toContain(c.status);
    expect(c.candidates.every((x) => !x.transformation)).toBe(true);
  });

  it('reuses a documented pair as evidence for another table (EFFECTIVEFROMTIMEKEY -> RECORD_START_DATE)', () => {
    const c = analyseTable(model(), 'STG_D')!.columns.find((x) => x.targetColumn === 'RECORD_START_DATE')!;
    const e = c.candidates.find((x) => x.column === 'EFFECTIVEFROMTIMEKEY')!;
    expect(e.accepted).toBe(true);
    expect(e.evidence.join(' ')).toMatch(/Documented elsewhere: S row 2/);
    expect(e.contextBonus).toBeGreaterThan(0);
    // bare TIMEKEY is also plausible, so a human must choose rather than the engine picking silently
    expect(c.status).toBe('ambiguous');
  });

  it('does not treat other integer keys or non-date targets as date keys', () => {
    const a = analyseTable(model(), 'STG_D')!;
    const bk = a.columns.find((x) => x.targetColumn === 'BUSINESS_DATE')!.candidates.find((x) => x.column === 'BRANCHKEY');
    if (bk) { expect(bk.accepted).toBe(false); expect(bk.transformation).toBeUndefined(); }
    const cnt = a.columns.find((x) => x.targetColumn === 'BRANCH_COUNT')!;
    expect(cnt.candidates.find((x) => x.column === 'TIMEKEY')?.transformation).toBeUndefined();
  });

  it('rule-conversion fallback (no source type): a TIMEKEY column resolves to a DATE column with its transformation', () => {
    const r = suggestTraqColumnsForColumn(model(), 'TIMEKEY');
    expect(r[0]).toMatchObject({ table: 'STG_D', column: 'BUSINESS_DATE' });
    expect(r[0].transformation).toContain('SysDayMatrix');
    expect(suggestTraqColumnsForColumn(model({ calendar: false }), 'TIMEKEY')[0]?.column).not.toBe('BUSINESS_DATE');
  });
});
