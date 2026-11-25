import { describe, expect, it } from 'vitest';
import type { ColumnDef, TableDef, WorkbookModel } from '@/types';
import { validateTransformation } from './transformValidator';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const model = {
  tables: [
    { name: 'CM_ACCT', system: 'CrisMac', layer: 'SOURCE', columns: [col('CM_ACCT', 'ACCT_NO', 'VARCHAR2(20)'), col('CM_ACCT', 'STATUS_CD', 'VARCHAR2(2)'), col('CM_ACCT', 'FIRST_NM', 'VARCHAR2(30)'), col('CM_ACCT', 'LAST_NM', 'VARCHAR2(30)'), col('CM_ACCT', 'OPEN_DT', 'INT')] } as TableDef,
    { name: 'OTHER', system: 'CrisMac', layer: 'SOURCE', columns: [col('OTHER', 'SECRET', 'VARCHAR2(5)')] } as TableDef,
  ],
  mappings: [], unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as WorkbookModel;

const check = (expression: string, cols: string[]) => validateTransformation({
  expression, model, target: { table: 'STG_T', column: 'TARGET_COL' }, sources: cols.map((c) => ({ table: 'CM_ACCT', column: c })),
});

describe('validateTransformation', () => {
  it.each([
    ['a cast', 'CAST(OPEN_DT AS DATE)', ['OPEN_DT']],
    ['a CASE lookup', "CASE WHEN STATUS_CD = 'A' THEN 'ACTIVE' WHEN STATUS_CD = 'C' THEN 'CLOSED' ELSE 'UNKNOWN' END", ['STATUS_CD']],
    ['a concatenation of two sources', "FIRST_NM + ' ' + LAST_NM", ['FIRST_NM', 'LAST_NM']],
    ['a conditional with functions', "ISNULL(LTRIM(RTRIM(ACCT_NO)), 'N/A')", ['ACCT_NO']],
    ['a typed cast', 'CAST(ACCT_NO AS VARCHAR(10))', ['ACCT_NO']],
    ['a keyword inside a string', "CASE WHEN STATUS_CD = 'DROP' THEN 1 ELSE 0 END", ['STATUS_CD']],
  ])('accepts %s and confirms it was read back by sqlParse', (_n, expr, cols) => {
    const r = check(expr, cols);
    expect(r.problems).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.checks.join(' ')).toMatch(/sqlParse/);
    expect(r.checks.filter((c) => c.startsWith('Warning'))).toEqual([]);
  });

  it.each([
    ['an invented column', 'UPPER(NOPE_COL)', /not a column of the source table/],
    ["a column of a table that is not a source", 'UPPER(SECRET)', /not a column of the source table/],
    ['a statement', 'STATUS_CD; DROP TABLE CM_ACCT', /single expression|not allowed/],
    ['unbalanced parentheses', 'UPPER(STATUS_CD', /parentheses/],
    ['an unclosed string', "'abc", /string literal/],
    ['a comment', 'STATUS_CD -- trailing', /comments/],
    ['two expressions', 'STATUS_CD, ACCT_NO', /more than one expression/],
    ['a variable', '@limit + OPEN_DT', /variables/],
    ['a top-level SELECT', 'SELECT STATUS_CD', /top level|value expression/],
    ['an empty expression', '   ', /empty/],
    ['a very long expression', `ISNULL(${'A'.repeat(700)}, 0)`, /longer than/],
  ])('rejects %s', (_n, expr, why) => {
    const r = check(expr, ['STATUS_CD']);
    expect(r.valid).toBe(false);
    expect(r.problems.join(' ')).toMatch(why);
    expect(r.checks.join(' ')).not.toMatch(/column reference/);
  });

  it('warns, without rejecting, when the proposed source is unused or a function is unfamiliar', () => {
    const constant = check("'X'", ['STATUS_CD']);
    expect(constant.valid).toBe(true);
    expect(constant.checks.join(' ')).toMatch(/Warning: the expression does not use the proposed source column CM_ACCT.STATUS_CD/);
    const odd = check('FOO_BAR(STATUS_CD)', ['STATUS_CD']);
    expect(odd.valid).toBe(true);
    expect(odd.checks.join(' ')).toMatch(/Warning: function\(s\) FOO_BAR/);
  });

  it('rejects when no source is given or the source table is not in the workbook', () => {
    expect(validateTransformation({ expression: 'X', model, target: { table: 'T', column: 'C' }, sources: [] }).valid).toBe(false);
    const ghost = validateTransformation({ expression: 'X', model, target: { table: 'T', column: 'C' }, sources: [{ table: 'GHOST', column: 'X' }] });
    expect(ghost.valid).toBe(false);
    expect(ghost.problems.join(' ')).toMatch(/GHOST is not in the workbook/);
  });
});
