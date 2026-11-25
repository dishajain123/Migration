import { describe, expect, it } from 'vitest';
import type { MappingRow, WorkbookModel } from '@/types';
import { DD_HEADER, findReferences, migrateDdRows, needsMappingDoc, readyDoc } from './ddMigrate';

const map = (sc: string, tt: string, tc: string, src = 'AccountCal'): MappingRow => ({
  id: `${tt}.${tc}`, sourceSystem: 'X', sourceTable: src, sourceColumn: sc, sourceColumns: [sc], sourceType: '', targetTable: tt, targetColumn: tc, targetType: '', mapType: 'DIRECT', remark: '', sheet: 'S', rowNo: 1,
});
const model = {
  tables: [{ name: 'FCT_PRODUCT_MASTER', system: 'TRAQ', layer: 'MART', columns: [] }],
  mappings: [map('IntNotServicedDt', 'FCT_PRODUCT_MASTER', 'INT_NOT_SERVICED_DATE'), map('ContiExcessDt', 'FCT_PRODUCT_MASTER', 'CONTI_EXCESS_DATE')],
  unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as unknown as WorkbookModel;

const EXPLAIN = "Sets X to 'NULL' when AccountCal.X equals '1900-01-01';\nsecond line kept.";
const row = (col: string, expr: string): string[] => ['AccountCal', col, 'Physical', 'Formula Expression', expr, EXPLAIN, '30-11-2021', 'PENDING_REVIEW', 'Date'];
const EXPR_OK = 'IF(OR("AccountCal"."ContiExcessDt" == "1900-01-01", "AccountCal"."ContiExcessDt" == "01/01/1900"))THEN(NULL)ELSE("AccountCal"."ContiExcessDt")';

describe('dd_export migration to TRAQ names', () => {
  it('finds only two-part "Table"."Column" references, not literals or variable paths', () => {
    expect(findReferences('IF("A"."B" == "Y", COALESCE("C"."D", "N") == "ODA")')).toEqual([
      { crismacTable: 'A', crismacColumn: 'B' }, { crismacTable: 'C', crismacColumn: 'D' },
    ]);
    expect(findReferences('"{ENTITY}"."var"."BUSINESS_DATE" > "01/01/1900"')).toEqual([]);
  });

  it('replaces only the names; format, logic, literals, explanation, dates, status and type stay as written', () => {
    const [r] = migrateDdRows(model, 'DPD', DD_HEADER, [row('ContiExcessDt', EXPR_OK)], []);
    expect(r.status).toBe('ready');
    expect(r.traqRow[0]).toBe('FCT_PRODUCT_MASTER');
    expect(r.traqRow[1]).toBe('CONTI_EXCESS_DATE');
    expect(r.traqRow[4]).toBe(EXPR_OK.replace(/"AccountCal"\."ContiExcessDt"/g, '"FCT_PRODUCT_MASTER"."CONTI_EXCESS_DATE"'));
    expect(r.traqRow[4]).toContain('== "1900-01-01"');
    for (const i of [2, 3, 5, 6, 7, 8]) expect(r.traqRow[i]).toBe(r.original[i]);
    expect(r.original[4]).toBe(EXPR_OK); // original kept
  });

  it('keeps a rule with an unmapped column separate and untouched, with no placeholder text anywhere', () => {
    const expr = 'IF("AccountCal"."IntNotServicedDt" == "1900-01-01" AND "DIMPRODUCT"."SchemeType" == "ODA")THEN(NULL)ELSE("AccountCal"."IntNotServicedDt")';
    const rules = migrateDdRows(model, 'DPD', DD_HEADER, [row('IntNotServicedDt', expr), row('ContiExcessDt', EXPR_OK)], []);
    const [pending, ok] = rules;
    expect(pending.status).toBe('needs-mapping');
    expect(pending.unmapped.map((u) => u.crismac)).toEqual(['DIMPRODUCT.SchemeType']);
    expect(pending.traqRow).toEqual(pending.original); // nothing half-converted
    expect(ok.status).toBe('ready');

    const ready = readyDoc(rules, 't').sheets[0];
    expect(ready.columns).toEqual(DD_HEADER);
    expect(ready.rows).toHaveLength(1);
    const apart = needsMappingDoc(rules, 't').sheets[0];
    expect(apart.rows).toHaveLength(1);
    expect(apart.rows[0].slice(1, 10)).toEqual(pending.original);
    expect(apart.rows[0][10]).toBe('DIMPRODUCT.SchemeType');
    const all = [ready.rows, apart.rows].flat(2).join('\n'); // not JSON: its nested arrays always contain "[["
    expect(all).not.toMatch(/\[\[|UNMAPPED/i);
  });

  it('never leaves a CrisMac run parameter in a ready rule: it is converted to the run date, or the rule waits with the reason', () => {
    // CONTI_EXCESS_DATE has no known data type here, so the TimeKey comparison cannot be turned into a date test without guessing.
    const [r] = migrateDdRows(model, 'DPD', DD_HEADER, [row('ContiExcessDt', 'IF("AccountCal"."ContiExcessDt" > @TIMEKEY)THEN(NULL)ELSE("AccountCal"."ContiExcessDt")')], []);
    expect(r.status).toBe('needs-mapping');
    expect(r.unmapped[0]).toMatchObject({ role: 'parameter', crismac: '@TIMEKEY' });
    expect(r.traqRow).toEqual(r.original);
    const [p] = migrateDdRows(model, 'DPD', DD_HEADER, [row('ContiExcessDt', 'IF("AccountCal"."ContiExcessDt" == @ProcessDate)THEN(NULL)ELSE("AccountCal"."ContiExcessDt")')], []);
    expect(p.status).toBe('ready');
    expect(p.traqRow[4]).toContain('"FCT_PRODUCT_MASTER"."CONTI_EXCESS_DATE" == "FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE"');
    expect(p.traqRow[4]).not.toContain('@');
  });

  it('uses mappings the reviewer approved in Agent 4', () => {
    const expr = 'IF("DIMPRODUCT"."SchemeType" == "ODA")THEN(NULL)ELSE("AccountCal"."ContiExcessDt")';
    const reviewed = [{ id: 'manual:1', targetTable: 'FCT_PRODUCT_MASTER', targetColumn: 'SCHEME_TYPE', targetType: '', sourceTable: 'DIMPRODUCT', sourceColumn: 'SchemeType', sourceType: '' }];
    const [r] = migrateDdRows(model, 'DPD', DD_HEADER, [row('ContiExcessDt', expr)], reviewed);
    expect(r.status).toBe('ready');
    expect(r.traqRow[4]).toContain('"FCT_PRODUCT_MASTER"."SCHEME_TYPE" == "ODA"');
  });
});
