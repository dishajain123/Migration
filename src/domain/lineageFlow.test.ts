import { describe, expect, it } from 'vitest';
import { buildFlow, flowKind, groupEdges, layoutFlow, nodeHeight, TABLE_HANDLE, tableCatalog, visibleColumnMap } from './lineageFlow';
import { parseWorkbookCsv } from './parse';
import type { FlowRequest } from '@/types';

// Same flattened layout as parse.test.ts. Chain: feed_a -> STG_BILLS -> FCT_COLLATERAL.
const HDR = 'Sheet_Name,Row_No,Col_1,Col_2,Col_3,Col_4,Col_5,Col_6,Col_7,Col_8,Col_9,Col_10,Col_11';
const CSV = [
  HDR,
  '01 Index,3,TRAQ TABLE,LAYER,COLUMNS,MAPPED,ROWS IN DB,STRUCTURE FROM,,,,,',
  '01 Index,4,STG_BILLS,STAGING,2,1,"1,000",RECP (live),,,,,',
  '01 Index,5,FCT_COLLATERAL,MART,3,2,0,MART (live),,,,,',
  'FCT_COLLATERAL,1,FCT_COLLATERAL,,,,,,,,,,',
  'FCT_COLLATERAL,2,"MART | 3 columns | primary key (PERIOD_ID, ID)",,,,,,,,,,',
  'FCT_COLLATERAL,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
  'FCT_COLLATERAL,5,PERIOD_ID,NUMBER,NOT NULL,Finacle,feed_a,DATE_OF_DATA,DATE,DERIVED,period from date,,',
  'FCT_COLLATERAL,6,AMT,"NUMBER(21,3)",,Finacle,stg_bills,AMOUNT,"NUMBER(10,2)",DIRECT,,,',
  'FCT_COLLATERAL,7,UNFED_COL,VARCHAR2(10),NOT NULL,,,,,NOT FED,,,',
  'STG_BILLS,4,SOURCE SYSTEM,SOURCE TABLE,SOURCE COLUMN,SOURCE DATATYPE,TARGET TABLE,TARGET COLUMN,TARGET DATATYPE,MAP TYPE,REMARK,,',
  'STG_BILLS,5,Finacle,feed_a,AMOUNT,"NUMBER(10,2)",STG_BILLS,AMOUNT,NUMBER,DIRECT,,,',
].join('\n');

const model = parseWorkbookCsv(CSV);
const base: FlowRequest = { tables: ['FCT_COLLATERAL'], upstream: true, downstream: true, depth: 0, includeNotUsed: false, internalOnly: false };

describe('buildFlow', () => {
  it('follows upstream lineage through intermediate tables', () => {
    const f = buildFlow(model, base);
    expect(f.tables.map((t) => t.name).sort()).toEqual(['FCT_COLLATERAL', 'STG_BILLS', 'feed_a']);
    expect(f.tables.find((t) => t.name === 'feed_a')?.role).toBe('upstream');
    expect(f.tables.find((t) => t.name === 'FCT_COLLATERAL')?.role).toBe('selected');
    expect(f.stats.downstream).toBe(0);
  });

  it('limits the walk by depth', () => {
    const f = buildFlow(model, { ...base, depth: 1 });
    expect(f.tables.map((t) => t.name).sort()).toEqual(['FCT_COLLATERAL', 'STG_BILLS', 'feed_a']);
    const f1 = buildFlow(model, { ...base, depth: 1, tables: ['FCT_COLLATERAL'] });
    // feed_a feeds FCT_COLLATERAL.PERIOD_ID directly, so it is one hop away as well
    expect(f1.tableEdges.some((e) => e.source === 'feed_a' && e.target === 'FCT_COLLATERAL')).toBe(true);
    const only = buildFlow(model, { ...base, tables: ['STG_BILLS'], depth: 1, downstream: false });
    expect(only.tables.map((t) => t.name).sort()).toEqual(['STG_BILLS', 'feed_a']);
  });

  it('traces downstream and respects the direction switches', () => {
    const down = buildFlow(model, { ...base, tables: ['feed_a'], upstream: false });
    expect(down.tables.map((t) => t.name).sort()).toEqual(['FCT_COLLATERAL', 'STG_BILLS', 'feed_a']);
    expect(down.tables.find((t) => t.name === 'STG_BILLS')?.role).toBe('downstream');
    const none = buildFlow(model, { ...base, upstream: false, downstream: false });
    expect(none.tables).toHaveLength(1);
    expect(none.columnEdges).toHaveLength(0);
  });

  it('classifies column mappings as direct or transformed and keeps the remark verbatim', () => {
    const f = buildFlow(model, base);
    const amt = f.columnEdges.find((e) => e.targetColumn === 'AMT')!;
    expect(amt.kind).toBe('direct');
    expect(amt.sourceTable).toBe('STG_BILLS');
    const period = f.columnEdges.find((e) => e.targetColumn === 'PERIOD_ID')!;
    expect(period.kind).toBe('transformed');
    expect(period.transformation).toBe('period from date');
    expect(f.columnEdges.some((e) => e.targetColumn === 'UNFED_COL')).toBe(false);
    expect(f.stats.direct + f.stats.transformed + f.stats.unspecified).toBe(f.columnEdges.length);
  });

  it('reports tables without lineage instead of failing', () => {
    const f = buildFlow(model, { ...base, tables: ['NOPE'] });
    expect(f.untraceable).toEqual(['NOPE']);
    expect(f.tables).toHaveLength(0);
  });

  it('ranks tables left to right', () => {
    const f = buildFlow(model, base);
    const r = new Map(f.tables.map((t) => [t.name, t.rank]));
    expect(r.get('feed_a')!).toBeLessThan(r.get('STG_BILLS')!);
    expect(r.get('STG_BILLS')!).toBeLessThan(r.get('FCT_COLLATERAL')!);
  });
});

describe('catalog, grouping and layout', () => {
  it('lists upstream and downstream counts per table', () => {
    const c = tableCatalog(model, { includeNotUsed: false, internalOnly: false });
    expect(c.find((x) => x.name === 'FCT_COLLATERAL')?.upstreamCount).toBe(2);
    expect(c.find((x) => x.name === 'feed_a')?.downstreamCount).toBe(2);
  });

  it('draws one arrow per table pair when tables are collapsed and per column pair when expanded', () => {
    const f = buildFlow(model, base);
    const collapsed = new Set(f.tables.map((t) => t.name));
    const flat = groupEdges(f.columnEdges, visibleColumnMap(f.tables, collapsed, new Set(), 10));
    expect(flat.every((g) => g.sourceHandle === TABLE_HANDLE && g.targetHandle === TABLE_HANDLE)).toBe(true);
    expect(flat).toHaveLength(f.tableEdges.length);
    const open = groupEdges(f.columnEdges, visibleColumnMap(f.tables, new Set(), new Set(), 10));
    expect(open.some((g) => g.sourceHandle === 'AMOUNT' && g.targetHandle === 'AMT')).toBe(true);
  });

  it('caps the rows drawn unless show-all is on', () => {
    const f = buildFlow(model, base);
    const t = f.tables.find((x) => x.name === 'FCT_COLLATERAL')!;
    expect(visibleColumnMap(f.tables, new Set(), new Set(), 1).get(t.name)).toHaveLength(1);
    expect(visibleColumnMap(f.tables, new Set(), new Set([t.name]), 1).get(t.name)).toHaveLength(t.columns.length);
  });

  it('places layers left to right without overlapping tables in a layer', () => {
    const f = buildFlow(model, base);
    const pos = layoutFlow(f.tables, f.tableEdges, () => nodeHeight(2, false));
    expect(pos.get('feed_a')!.x).toBeLessThan(pos.get('STG_BILLS')!.x);
    expect(pos.get('STG_BILLS')!.x).toBeLessThan(pos.get('FCT_COLLATERAL')!.x);
  });

  it('maps MAP TYPE to a kind', () => {
    expect(flowKind('RENAME')).toBe('direct');
    expect(flowKind('lookup')).toBe('transformed');
    expect(flowKind('')).toBe('unspecified');
  });
});
