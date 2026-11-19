import { describe, expect, it } from 'vitest';
import type { ConversionSettings, ProcSource } from '@/types';
import { parseWorkbookCsv } from '../parse';
import { analyzeProcSql } from '../sqlParse';
import { convertProcedures, DEFAULT_SETTINGS } from './convert';
import { analyzeSqlFile, checkSqlFileMeta, procedureName } from './intake';
import { buildMappingIndex, logicalTable, resolveColumn } from './resolve';
import { parseSqlExpr } from './sqlExpr';
import { templateById, templateRow, traqRuleDoc, validateForExport } from './templates';
import { foldConstants, translate, type TranslateContext } from './translate';

// Workbook fixture: PRO.AccountCal columns documented as feeding FCT_PRODUCT_MASTER (as on the real FCT_PRODUCT_MASTER sheet).
const HDR = 'Sheet_Name,Row_No,Col_1,Col_2,Col_3,Col_4,Col_5,Col_6,Col_7,Col_8,Col_9,Col_10,Col_11';
const CSV = [
  HDR,
  '01 Index,3,TRAQ TABLE,LAYER,COLUMNS,MAPPED,ROWS IN DB,STRUCTURE FROM,,,,,',
  '01 Index,4,FCT_PRODUCT_MASTER,MART,3,3,0,MART (live),,,,,',
  'FCT_PRODUCT_MASTER,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
  'FCT_PRODUCT_MASTER,5,OVERDUE_DPD,NUMBER,,CrisMac,PRO.AccountCal,DPD_Overdue,-,DERIVED,Days since OVERDUE_DATE + 1.,,',
  'FCT_PRODUCT_MASTER,6,OVERDUE_DATE,DATE,,CrisMac,PRO.AccountCal,OverDueSinceDt,-,DERIVED,Oldest unpaid due.,,',
  'FCT_PRODUCT_MASTER,7,DATA_SOURCE_ID,NUMBER,,CrisMac,PRO.AccountCal,SourceAlt_Key,-,DIRECT,,,',
].join('\n');
const model = parseWorkbookCsv(CSV);

// Mirrors DPD_Calculation: reset, a @TIMEKEY-guarded CASE with DATEDIFF, then a zero floor.
const SQL = `
CREATE PROCEDURE [PRO].[DPD_Test] @TIMEKEY INT, @ProcessDate DATE AS
BEGIN
  UPDATE A SET A.DPD_Overdue = 0 FROM ##AccountCal A
  IF @TIMEKEY > 26267
  BEGIN
    UPDATE A SET A.DPD_Overdue = (CASE WHEN A.OverDueSinceDt IS NOT NULL THEN DATEDIFF(DAY, A.OverDueSinceDt, @ProcessDate) + 1 ELSE 0 END)
    FROM ##AccountCal A
  END
  /* IF ANY DPD IS NEGATIVE THEN ZERO */
  UPDATE ##AccountCal SET DPD_Overdue = 0 WHERE isnull(DPD_Overdue, 0) < 0
  UPDATE ##AccountCal SET Unknown_Flag = 1
END`;
const proc: ProcSource = analyzeProcSql({ name: 'DPD_Test', folder: 'test', file: '07_S02_PRO.DPD_Test.sql' }, SQL);
const settings = (patch: Partial<ConversionSettings> = {}): ConversionSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('Agent 3 parser additions', () => {
  it('keeps unclipped expressions, WHERE text and structured IF guards', () => {
    const guarded = proc.steps.find((s) => s.guards?.length);
    expect(guarded?.guards?.[0]).toContain('@TIMEKEY > 26267');
    expect(guarded?.columns[0].expressionFull).toContain('DATEDIFF(DAY, A.OverDueSinceDt, @ProcessDate) + 1');
    expect(proc.steps.some((s) => s.where?.toLowerCase().includes('isnull(dpd_overdue, 0) < 0'))).toBe(true);
    expect(guarded?.aliases?.A).toBe('ACCOUNTCAL');
  });

  it('reads MERGE statements: target, source, ON condition and the columns set', () => {
    const p = analyzeProcSql({ name: 'M', folder: 't', file: 'm.sql' }, `CREATE PROC M AS
      MERGE INTO PRO.AccountCal AS T USING dbo.Src S ON T.Id = S.Id
      WHEN MATCHED AND S.Flag = 1 THEN UPDATE SET T.DPD_Overdue = S.Dpd
      WHEN NOT MATCHED THEN INSERT (Id, DPD_Overdue) VALUES (S.Id, 0);`);
    const m = p.steps.find((s) => s.type === 'MERGE');
    expect(m?.table).toBe('ACCOUNTCAL');
    expect(m?.joins?.[0]).toMatchObject({ kind: 'USING', table: 'SRC', alias: 'S' });
    expect(m?.joins?.[0].on).toContain('T.Id = S.Id');
    expect(m?.where).toContain('S.Flag = 1');
    expect(m?.columns.map((c) => c.name)).toEqual(['DPD_OVERDUE', 'ID', 'DPD_OVERDUE']);
  });

  it('does not mistake the MERGE join hint for a MERGE statement', () => {
    const p = analyzeProcSql({ name: 'H', folder: 't', file: 'h.sql' }, `CREATE PROC H AS
      UPDATE A SET A.X = B.Y FROM T A INNER MERGE JOIN U B ON A.K = B.K OPTION (MERGE JOIN)`);
    expect(p.steps.map((s) => s.type)).toEqual(['UPDATE']);
  });

  it('records JOIN kinds and ON conditions', () => {
    const p = analyzeProcSql({ name: 'J', folder: 't', file: 'j.sql' }, `CREATE PROC J AS
      UPDATE A SET A.X = B.Y FROM PRO.AccountCal A INNER JOIN DimProduct B ON A.ProductAlt_Key = B.ProductAlt_Key
      LEFT OUTER JOIN DimBranch C ON C.Id = A.BranchId WHERE A.Flag = 'Y'`);
    const s = p.steps[0];
    expect(s.joins?.map((j) => `${j.kind}:${j.table}:${j.alias}`)).toEqual(['INNER:DIMPRODUCT:B', 'LEFT:DIMBRANCH:C']);
    expect(s.where).toBe("A.Flag = 'Y'");
  });
});

describe('expression translation', () => {
  const ctx: TranslateContext = {
    entity: 'T',
    column: (parts) => ({ text: `"T"."${parts[parts.length - 1]}"`, resolution: null }),
    param: (name) => ({ name, status: 'unresolved', value: '', note: '' }),
  };
  const tr = (sql: string) => translate(parseSqlExpr(sql), ctx);

  it('rewrites CASE, IS NULL, ISNULL and comparisons into the FPM_DA_RULES syntax', () => {
    expect(tr("CASE WHEN a IS NULL THEN 'Y' ELSE 'N' END").text).toBe('IF(ISEMPTY("T"."A"))THEN("Y")ELSE("N")');
    expect(tr('ISNULL(a, 0) >= 91').text).toBe('COALESCE("T"."A",0)>=91');
    expect(tr("a IN ('K','E')").text).toBe('("T"."A")IN["K","E"]');
    expect(tr('a = 1 AND (b <> 2 OR c IS NOT NULL)').text).toBe('AND("T"."A"==1,OR("T"."B"!=2,ISNOTEMPTY("T"."C")))');
  });

  it('expands constructs with no TRAQ keyword and pushes NOT inwards', () => {
    expect(tr('a BETWEEN 1 AND 5').text).toBe('AND("T"."A">=1,"T"."A"<=5)');
    expect(tr("a NOT IN ('x','y')").text).toBe('AND("T"."A"!="x","T"."A"!="y")');
    expect(tr('NOT (a = 1 OR b IS NULL)').text).toBe('AND("T"."A"!=1,ISNOTEMPTY("T"."B"))');
    expect(tr('LTRIM(RTRIM(a))').text).toBe('TRIM("T"."A")');
  });

  it('writes DATEDIFF in the live-rule argument order and flags it', () => {
    const r = tr('DATEDIFF(DAY, a, b) + 1');
    expect(r.text).toBe('DATEDIFF("T"."B","T"."A","d")+1');
    expect(r.issues.some((i) => i.code === 'DATEDIFF_ORDER')).toBe(true);
  });

  it('flags what it cannot translate instead of guessing', () => {
    const r = tr("a LIKE 'X%' OR EXISTS (SELECT 1 FROM t)");
    expect(r.text).toContain('[[UNSUPPORTED');
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.code).sort()).toEqual(['LIKE', 'UNSUPPORTED']);
    expect(tr('@X + 1').text).toBe('[[PARAM @X]]+1');
  });

  it('folds comparisons on parameters with a known value', () => {
    const e = foldConstants(parseSqlExpr('CASE WHEN @TIMEKEY > 26267 THEN 1 ELSE 2 END'), { '@TIMEKEY': '26400' });
    expect(translate(e, ctx).text).toBe('1');
  });
});

describe('mapping resolution', () => {
  it('normalises CrisMac table names and uses documented workbook mappings', () => {
    expect(logicalTable('[PRO].[##AccountCal]')).toBe('ACCOUNTCAL');
    const idx = buildMappingIndex(model, []);
    const r = resolveColumn(model, idx, '##AccountCal', 'DPD_Overdue');
    expect(r.status).toBe('documented');
    expect(r.chosen).toMatchObject({ table: 'FCT_PRODUCT_MASTER', column: 'OVERDUE_DPD', basis: 'workbook' });
  });

  it('prefers Agent 4 manual mappings over the workbook', () => {
    const idx = buildMappingIndex(model, [{ id: 'manual:x', targetTable: 'FCT_PRODUCT_MASTER', targetColumn: 'DATA_SOURCE_ID', targetType: 'NUMBER', sourceTable: 'PRO.AccountCal', sourceColumn: 'DPD_Overdue', sourceType: '' }]);
    const r = resolveColumn(model, idx, 'ACCOUNTCAL', 'DPD_OVERDUE');
    expect(r.status).toBe('approved');
    expect(r.chosen?.column).toBe('DATA_SOURCE_ID');
  });

  it('reports a missing mapping instead of inventing one', () => {
    expect(resolveColumn(model, buildMappingIndex(model, []), 'ACCOUNTCAL', 'NO_SUCH').status).toBe('missing');
  });
});

describe('convertProcedures', () => {
  const rule = (s: ConversionSettings) => convertProcedures(model, { procedures: [proc], reviewed: [], settings: s }).rules.find((r) => r.crismacColumn === 'DPD_OVERDUE');

  it('composes the statements into one rule written with TRAQ names only', () => {
    const r = rule(settings({ paramValues: { '@TIMEKEY': '26400' } }))!;
    expect(r.target.chosen).toMatchObject({ table: 'FCT_PRODUCT_MASTER', column: 'OVERDUE_DPD' });
    expect(r.statements).toHaveLength(3);
    expect(r.traq.entity).toBe('FCT_PRODUCT_MASTER');
    expect(r.traq.expression).toContain('"FCT_PRODUCT_MASTER"."OVERDUE_DATE"');
    expect(r.traq.expression).toContain('"FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE"');
    expect(r.traq.expression).not.toMatch(/AccountCal|OverDueSinceDt|DPD_Overdue|@TIMEKEY|26267/i);
    expect(r.traq.expression.startsWith('IF(COALESCE(')).toBe(true); // the zero floor wraps the earlier result
    expect(r.traq.dataType).toBe('Integer');
    expect(r.traq.columnType).toBe('Physical');
    expect(r.traq.crismac).toMatch(/^DPD_Test \d+-\d+$/);
    expect(r.traq.explanation).toContain('IF ANY DPD IS NEGATIVE THEN ZERO');
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
    expect(r.status).toBe('needs-review'); // @ProcessDate mapping is a default that must be confirmed
  });

  it('leaves unset parameters as placeholders and flags them', () => {
    const r = rule(settings())!;
    expect(r.traq.expression).toContain('[[PARAM @TIMEKEY]]');
    expect(r.issues.some((i) => i.code === 'PARAM_UNRESOLVED')).toBe(true);
  });

  it('fails a rule whose CrisMac column has no TRAQ target', () => {
    const res = convertProcedures(model, { procedures: [proc], reviewed: [], settings: settings() });
    const r = res.rules.find((x) => x.crismacColumn === 'UNKNOWN_FLAG')!;
    expect(r.status).toBe('failed');
    expect(r.confidence.value).toBe(0);
    expect(res.stats.failed).toBe(1);
  });
});

describe('templates and export checks', () => {
  const res = convertProcedures(model, { procedures: [proc], reviewed: [], settings: settings({ paramValues: { '@TIMEKEY': '26400' } }) });
  const ok = res.rules.filter((r) => r.status !== 'failed');

  it('uses the exact dd_export header and formats dates per template', () => {
    const t = templateById('dd-export');
    expect(t.columns.map((c) => c.header)).toEqual(['Entity Name', 'Column Name', 'Column Type', 'Derivation Option', 'Display Derivation Expression', 'Rule Explanation', 'Effective Start Date', 'Status', 'Data Type']);
    const row = templateRow(t, { ...ok[0].traq, effectiveStartDate: '2026-04-01' });
    expect(row[6]).toBe('01-04-2026');
    expect(templateRow(templateById('fpm-da-rules'), { ...ok[0].traq, effectiveStartDate: '2026-04-01' })[5]).toBe('01-Apr-2026');
  });

  it('blocks export while a mandatory field is empty, then passes', () => {
    const t = templateById('dd-export');
    expect(validateForExport(t, ok, {}, '').some((c) => c.severity === 'error' && c.field === 'Effective Start Date')).toBe(true);
    expect(validateForExport(t, ok, {}, '2026-04-01').filter((c) => c.severity === 'error')).toEqual([]);
    const doc = traqRuleDoc(t, ok, {}, '2026-04-01', '2026-11-17T10:00:00Z');
    expect(doc.sheets[0].rows).toHaveLength(ok.length);
  });

  it('rejects placeholders left in an expression', () => {
    const t = templateById('dd-export');
    const withParam = convertProcedures(model, { procedures: [proc], reviewed: [], settings: settings() }).rules.filter((r) => r.status !== 'failed');
    expect(validateForExport(t, withParam, {}, '2026-04-01').some((c) => c.field === 'expression')).toBe(true);
  });
});

describe('file intake', () => {
  it('validates type and size and names the procedure from its header', () => {
    expect(checkSqlFileMeta('a.txt', 10)).toMatch(/not a \.sql/);
    expect(checkSqlFileMeta('a.sql', 0)).toMatch(/empty/);
    expect(procedureName('x.sql', 'CREATE OR ALTER PROCEDURE [PRO].[Foo] AS').name).toBe('Foo');
    const a = analyzeSqlFile({ fileName: 'script.sql', size: 20, content: 'UPDATE T SET A = 1' });
    expect(a.procedure?.name).toBe('script');
    expect(a.warnings[0]).toMatch(/No CREATE PROCEDURE/);
  });
});
