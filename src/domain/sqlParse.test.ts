import { describe, expect, it } from 'vitest';
import { parseWorkbookCsv } from './parse';
import { procedureRules, traceProcedure, traceValidation } from './procTrace';
import { analyzeProcSql, maskSql } from './sqlParse';

const SQL = `USE [DB]
GO
/*=====
 AUTHER : X
 CREATE DATE : 27-11-2019
 DESCRIPTION : CALCULATION OF DPD */
CREATE PROC [PRO].[Demo_Proc] @TIMEKEY INT, @FLAG CHAR(1)='N'
AS
BEGIN
 SET NOCOUNT ON
 BEGIN TRY
 DECLARE @D DATE=(SELECT Date FROM SysDayMatrix WHERE TimeKey=@TIMEKEY)
 TRUNCATE TABLE PRO.ACCOUNTCAL
 INSERT INTO ##ACCOUNTCAL (ACCOUNTENTITYID, FLGDEG, Asset_Norm)
 SELECT ABD.ACCOUNTENTITYID, FLGDEG='N', 'NORMAL' AS Asset_Norm
 FROM DBO.AdvAcBasicDetail ABD WHERE ABD.EffectiveFromTimeKey<=@TIMEKEY
 IF @TIMEKEY > 26267
 BEGIN
   -- changed on 17-03-2021 as per email
   UPDATE A SET A.DPD_Overdue = CASE WHEN A.OverDueSinceDt IS NOT NULL THEN DATEDIFF(DAY,A.OverDueSinceDt,@D)+1 ELSE 0 END, A.DPD_Renewal = 0
   FROM ##AccountCal A INNER JOIN DimProduct B ON A.ProductAlt_Key=B.ProductAlt_Key
 END
 ELSE
   UPDATE ##AccountCal SET DPD_Overdue = 0
 SELECT A.X INTO #TMP FROM ##ACCOUNTCAL A
 UPDATE PRO.ACLRUNNINGPROCESSSTATUS SET COMPLETED='Y' WHERE RUNNINGPROCESSNAME='Demo_Proc'
 END TRY
 BEGIN CATCH
 UPDATE PRO.ACLRUNNINGPROCESSSTATUS SET COMPLETED='N'
 END CATCH
END
GO
`;
const info = { name: 'Demo_Proc', folder: 'Demo_Proc', file: '07_S02_PRO.Demo_Proc.StoredProcedure.sql' };
const proc = analyzeProcSql(info, SQL);
const real = proc.steps.filter((s) => !s.housekeeping);

describe('maskSql', () => {
  it('blanks comments and string contents without shifting offsets', () => {
    const src = "SELECT 'a,b' -- note\n/* x */ y";
    const { code, text } = maskSql(src);
    expect(code.length).toBe(src.length);
    expect(text.length).toBe(src.length);
    expect(code).not.toContain('note');
    expect(code).not.toContain('a,b');
    expect(text).toContain('a,b');
  });
});

describe('analyzeProcSql', () => {
  it('reads header, stage, order and parameters', () => {
    expect(proc.stage).toBe('S02');
    expect(proc.order).toBe(7);
    expect(proc.author).toBe('X');
    expect(proc.created).toBe('27-11-2019');
    expect(proc.descriptions).toEqual(['CALCULATION OF DPD']);
    expect(proc.params.map((p) => `${p.name} ${p.type} ${p.defaultValue}`.trim())).toEqual(['@TIMEKEY INT', "@FLAG CHAR(1) 'N'"]);
  });

  it('splits statements and keeps bookkeeping separate', () => {
    expect(real.map((s) => s.type)).toEqual(['TRUNCATE', 'INSERT', 'UPDATE', 'UPDATE', 'SELECT_INTO']);
    expect(proc.steps.filter((s) => s.housekeeping)).toHaveLength(2);
  });

  it('pairs INSERT columns with their expressions and normalises working tables', () => {
    const ins = real[1];
    expect(ins.table).toBe('ACCOUNTCAL');
    expect(ins.tableKind).toBe('working');
    expect(ins.columns.map((c) => c.name)).toEqual(['ACCOUNTENTITYID', 'FLGDEG', 'ASSET_NORM']);
    expect(ins.columns[1].expression).toBe("'N'");
    expect(ins.reads).toEqual(['ADVACBASICDETAIL']);
  });

  it('resolves UPDATE aliases, expressions and enclosing conditions', () => {
    const up = real[2];
    expect(up.table).toBe('ACCOUNTCAL');
    expect(up.guard).toBe('IF @TIMEKEY > 26267');
    expect(up.columns.map((c) => c.name)).toEqual(['DPD_OVERDUE', 'DPD_RENEWAL']);
    expect(up.columns[0].expression).toContain('DATEDIFF');
    expect(up.reads).toEqual(['DIMPRODUCT']);
    expect(up.functions).toContain('DATEDIFF');
    expect(real[3].guard.startsWith('ELSE')).toBe(true);
  });

  it('aggregates tables written/read without temp tables', () => {
    const w = proc.tablesWritten.find((t) => t.table === 'ACCOUNTCAL')!;
    expect(w.columns).toEqual(expect.arrayContaining(['ASSET_NORM', 'DPD_OVERDUE', 'DPD_RENEWAL']));
    expect(proc.tablesRead).toEqual(expect.arrayContaining(['ADVACBASICDETAIL', 'DIMPRODUCT']));
    expect(proc.tablesRead).not.toContain('TMP');
    expect(proc.tablesWritten.some((t) => t.table === 'TMP')).toBe(false);
  });

  it('collects dated change comments verbatim', () => {
    expect(proc.changeLog).toHaveLength(1);
    expect(proc.changeLog[0].text).toContain('17-03-2021');
  });
});

describe('TRAQ traceability', () => {
  const HDR = 'Sheet_Name,Row_No,Col_1,Col_2,Col_3,Col_4,Col_5,Col_6,Col_7,Col_8,Col_9,Col_10,Col_11';
  const model = parseWorkbookCsv([
    HDR,
    '01 Index,3,TRAQ TABLE,LAYER,COLUMNS,MAPPED,ROWS IN DB,STRUCTURE FROM,,,,,',
    '01 Index,4,FCT_COLLATERAL,MART,2,1,0,MART (live),,,,,',
    'FCT_COLLATERAL,1,FCT_COLLATERAL,,,,,,,,,,',
    'FCT_COLLATERAL,2,"MART | 2 columns",,,,,,,,,,',
    'FCT_COLLATERAL,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
    'FCT_COLLATERAL,5,ASSET_NORM,VARCHAR2(20),,Finacle,feed_a,A,VARCHAR(20),DIRECT,,,',
    'FCT_COLLATERAL,6,DPD_OVERDUE,NUMBER,,Finacle,feed_a,B,INT,DIRECT,,,',
    'FPM_DA_RULES,4,RUN,TRAQ COLUMN,KIND,DATATYPE,RULE,IN FORCE FROM,CRISMAC,READS,LOGIC,EXPRESSION AS SAVED IN THE APP,VERSION',
    'FPM_DA_RULES,5,1,ASSET_NORM,Physical,String,Formula,05-Nov-2026,x,IS_LAD,ALWAYS_STD when IS_LAD = 1,expr,v1',
  ].join('\n'));
  const trace = traceProcedure(model, proc);

  it('links written columns to TRAQ columns by name and relates FPM_DA_RULES rows', () => {
    const l = trace.links.find((x) => x.procColumn === 'DPD_OVERDUE');
    expect(l?.traqTable).toBe('FCT_COLLATERAL');
    expect(l?.stepIds.length).toBe(2);
    expect(trace.daRules.map((d) => d.column)).toContain('ASSET_NORM');
    expect(trace.status).toBe('traceable');
  });

  it('does not link short generic names and flags procedures with no link', () => {
    const none = analyzeProcSql({ name: 'Zzz_Unrelated_Proc', folder: 'z', file: 'z.sql' }, 'CREATE PROC [PRO].[Zzz_Unrelated_Proc] @T INT AS BEGIN UPDATE ##T SET ID = 1 END');
    const t = traceProcedure(model, none);
    expect(t.links).toEqual([]);
    expect(t.status).toBe('untraced');
    expect(traceValidation([none], [t])[0].severity).toBe('warn');
  });

  it('turns linked assignments into Agent 5 derivation rules with provenance', () => {
    const rules = procedureRules([proc], [trace]);
    const r = rules.find((x) => x.column === 'DPD_OVERDUE')!;
    expect(r.kind).toBe('derivation');
    expect(r.origin).toBe('derived');
    expect(r.text).toContain('DATEDIFF');
    expect(r.sheet).toContain('07_S02');
    expect(r.rowNo).toBeGreaterThan(0);
  });
});
