import { describe, expect, it } from 'vitest';
import { parseWorkbookCsv } from './parse';
import { buildLineage, traceColumn } from './lineage';
import { extractRules } from './rules';
import { runValidation } from './validate';
import { fedKeySet, colKey } from './selectors';
import { compat, parseType } from './typeUtils';

// Minimal CSV in the same flattened layout as the real workbook (Sheet_Name,Row_No,Col_1..Col_11).
// Sheet names must be in the parser's in-scope list (src/domain/constants.ts), so real names are reused:
// FCT_COLLATERAL is a shape-A sheet here, STG_BILLS a shape-C sheet.
const HDR = 'Sheet_Name,Row_No,Col_1,Col_2,Col_3,Col_4,Col_5,Col_6,Col_7,Col_8,Col_9,Col_10,Col_11';
const CSV = [
  HDR,
  '01 Index,3,TRAQ TABLE,LAYER,COLUMNS,MAPPED,ROWS IN DB,STRUCTURE FROM,,,,,',
  '01 Index,4,STG_BILLS,STAGING,2,1,"1,000",RECP (live),,,,,',
  '01 Index,5,FCT_COLLATERAL,MART,3,2,0,MART (live),,,,,',
  '01 Index,6,FCT_NPA_PRODUCT,MART,5,0,0,MART (live),,,,,',
  // Shape A target sheet
  'FCT_COLLATERAL,1,FCT_COLLATERAL,,,,,,,,,,',
  'FCT_COLLATERAL,2,"MART | 3 columns | primary key (PERIOD_ID, ID)",,,,,,,,,,',
  'FCT_COLLATERAL,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
  'FCT_COLLATERAL,5,PERIOD_ID,NUMBER,NOT NULL,Finacle,feed_a,DATE_OF_DATA,DATE,DERIVED,period from date,,',
  'FCT_COLLATERAL,6,AMT,"NUMBER(21,3)",,Finacle,stg_bills,AMOUNT,"NUMBER(10,2)",DIRECT,,,',
  'FCT_COLLATERAL,7,UNFED_COL,VARCHAR2(10),NOT NULL,,,,,NOT FED,,,',
  // Shape C staging sheet
  'STG_BILLS,4,SOURCE SYSTEM,SOURCE TABLE,SOURCE COLUMN,SOURCE DATATYPE,TARGET TABLE,TARGET COLUMN,TARGET DATATYPE,MAP TYPE,REMARK,,',
  'STG_BILLS,5,Finacle,feed_a,AMOUNT,"NUMBER(10,2)",STG_BILLS,AMOUNT,NUMBER,DIRECT,,,',
  'STG_BILLS,6,Finacle,feed_a,NOTE,VARCHAR2(5),,-,,NOT CARRIED,dropped,,',
  // Out-of-scope sheet must be ignored
  'FCT_NPA_PRODUCT,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
  'FCT_NPA_PRODUCT,5,SOMETHING,NUMBER,,,,,,,,,',
  // Rules sheet
  'FPM_DA_RULES,4,RUN,TRAQ COLUMN,KIND,DATATYPE,RULE,IN FORCE FROM,CRISMAC,READS,LOGIC,EXPRESSION AS SAVED IN THE APP,VERSION',
  'FPM_DA_RULES,5,1,ASSET_NORM,Physical,String,Formula,05-Nov-2026,x,IS_LAD,ALWAYS_STD when IS_LAD = 1,expr,v1',
].join('\n');

describe('parseWorkbookCsv', () => {
  const model = parseWorkbookCsv(CSV);

  it('rejects a file that is not the combined workbook', () => {
    expect(() => parseWorkbookCsv('a,b\n1,2')).toThrow(/Sheet_Name/);
  });

  it('reads index metadata and excludes out-of-scope tables', () => {
    const stg = model.tables.find((t) => t.name === 'STG_BILLS')!;
    expect(stg.layer).toBe('STAGING');
    expect(stg.rowsInDb).toBe(1000);
    expect(model.tables.find((t) => t.name === 'FCT_NPA_PRODUCT')).toBeUndefined();
  });

  it('parses shape A columns, nullability and banner', () => {
    const y = model.tables.find((t) => t.name === 'FCT_COLLATERAL')!;
    expect(y.columns.map((c) => c.name)).toEqual(['PERIOD_ID', 'AMT', 'UNFED_COL']);
    expect(y.columns[0].nullable).toBe(false);
    expect(y.columns[1].nullable).toBe(true);
    expect(y.banner).toContain('primary key');
  });

  it('builds mappings and resolves TRAQ tables case-insensitively', () => {
    const amt = model.mappings.find((m) => m.targetTable === 'FCT_COLLATERAL' && m.targetColumn === 'AMT')!;
    expect(amt.sourceTable).toBe('STG_BILLS'); // 'stg_bills' resolved to the index table
    expect(amt.mapType).toBe('DIRECT');
  });

  it('tracks which target columns are fed', () => {
    const fed = fedKeySet(model);
    expect(fed.has(colKey('FCT_COLLATERAL', 'PERIOD_ID'))).toBe(true);
    expect(fed.has(colKey('FCT_COLLATERAL', 'UNFED_COL'))).toBe(false);
    expect(fed.has(colKey('STG_BILLS', 'AMOUNT'))).toBe(true);
  });

  it('parses the rules sheet', () => {
    expect(model.daRules).toHaveLength(1);
    expect(model.daRules[0].column).toBe('ASSET_NORM');
  });
});

describe('derived analysis', () => {
  const model = parseWorkbookCsv(CSV);

  it('builds lineage edges source -> target', () => {
    const g = buildLineage(model, { includeNotUsed: false, internalOnly: false });
    expect(g.edges.some((e) => e.source === 'feed_a' && e.target === 'STG_BILLS')).toBe(true);
    expect(g.edges.some((e) => e.source === 'STG_BILLS' && e.target === 'FCT_COLLATERAL')).toBe(true);
    const rank = new Map(g.nodes.map((n) => [n.id, n.rank]));
    expect(rank.get('FCT_COLLATERAL')!).toBeGreaterThan(rank.get('STG_BILLS')!);
  });

  it('traces a column upstream through staging', () => {
    const t = traceColumn(model, 'FCT_COLLATERAL', 'AMT', 'upstream');
    expect(t.children[0].table).toBe('STG_BILLS');
    expect(t.children[0].children[0].table).toBe('feed_a');
  });

  it('flags an unfed NOT NULL column as a validation failure', () => {
    const rep = runValidation(model);
    const c1 = rep.results.find((r) => r.checkId === 'C1' && r.table === 'FCT_COLLATERAL')!;
    expect(c1.severity).toBe('fail');
    expect(c1.items).toContain('UNFED_COL');
  });

  it('extracts mandatory and derived rules with provenance', () => {
    const rules = extractRules(model);
    expect(rules.some((r) => r.kind === 'mandatory' && r.column === 'PERIOD_ID')).toBe(true);
    expect(rules.some((r) => r.kind === 'transform' && r.column === 'PERIOD_ID')).toBe(true);
    expect(rules.every((r) => r.sheet && r.rowNo > 0)).toBe(true);
  });
});

describe('type utilities', () => {
  it('parses families and lengths', () => {
    expect(parseType('VARCHAR2(50 CHAR)')).toMatchObject({ family: 'char', length: 50 });
    expect(parseType('NUMBER(21,3)').family).toBe('number');
    expect(parseType('smalldatetime').family).toBe('date');
    expect(parseType('-').family).toBe('unknown');
  });
  it('detects truncation and incompatibility', () => {
    expect(compat('varchar(50)', 'VARCHAR2(30)').level).toBe('warn');
    expect(compat('NUMBER', 'DATE').level).toBe('incompatible');
    expect(compat('NUMBER(5)', 'NUMBER(10)').level).toBe('compatible');
  });
});
