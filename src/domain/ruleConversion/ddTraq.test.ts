import { describe, expect, it } from 'vitest';
import type { ColumnResolution, ConversionSettings, MappingRow, TableDef, WorkbookModel } from '@/types';
import { blockingColumns, coverageByProcedure, DD_HEADER, migrateDdRows, needsMappingDoc, readyDoc } from './ddMigrate';
import { traqifyExpression } from './ddTraq';

const BD = '"E"."var"."BUSINESS_DATE"';
const PID = '"E"."PERIOD_ID"';
const res = (crismacTable: string, crismacColumn: string, table: string, column: string, dataType: string): [string, ColumnResolution] => [
  `${crismacTable}.${crismacColumn}`.toUpperCase(),
  { crismacTable, crismacColumn, chosen: { table, column, dataType, basis: 'workbook' }, candidates: [], status: 'documented', note: '' } as ColumnResolution,
];
const tq = (expression: string, over: { resolved?: [string, ColumnResolution][]; settings?: Parameters<typeof traqifyExpression>[1]['settings']; entityColumns?: Set<string> } = {}) =>
  traqifyExpression(expression, { entity: 'E', entityColumns: over.entityColumns ?? new Set(['PERIOD_ID']), resolved: new Map(over.resolved ?? []), settings: over.settings });

describe('DATEDIFF order', () => {
  it('swaps (earlier, later, "DAY") to TRAQ (later, earlier, "d") so a DPD stays positive', () => {
    const r = tq('DATEDIFF("A"."B", @ProcessDate, "DAY") + 1');
    expect(r.text).toBe(`DATEDIFF(${BD}, "A"."B", "d") + 1`);
    expect(r.notes.join(' ')).toMatch(/DATEDIFF argument order: 1 call/);
  });

  it('handles nested arguments and several calls', () => {
    const r = tq('IF(DATEDIFF(COALESCE("A"."B", "1900-01-01"), @ProcessDate, "DAY") > 5)THEN(DATEDIFF("A"."C", "A"."D", "DAY"))ELSE(0)');
    expect(r.text).toBe(`IF(DATEDIFF(${BD}, COALESCE("A"."B", "1900-01-01"), "d") > 5)THEN(DATEDIFF("A"."D", "A"."C", "d"))ELSE(0)`);
  });

  it('does not swap twice, and leaves other units alone with a note', () => {
    expect(tq('DATEDIFF(@ProcessDate, "A"."B", "d")').text).toBe(`DATEDIFF(${BD}, "A"."B", "d")`);
    const m = tq('DATEDIFF("A"."B", "A"."C", "MONTH")');
    expect(m.text).toBe('DATEDIFF("A"."B", "A"."C", "MONTH")');
    expect(m.notes.join(' ')).toMatch(/other than "DAY"/);
  });
});

describe('run-date parameters', () => {
  it('maps @ProcessDate and @ProcessingDate to the run-date variable by default, in any case', () => {
    for (const p of ['@ProcessDate', '@PROCESSDATE', '@ProcessingDate']) expect(tq(`"A"."B" == ${p}`).text).toBe(`"A"."B" == ${BD}`);
    expect(tq('@ProcessDate').notes.join(' ')).toMatch(/SysDayMatrix.*BUSINESS_DATE/);
  });

  it('uses a user mapping or value, and reports a variable with neither', () => {
    expect(tq('@ProcessDate', { settings: { paramValues: {}, paramMappings: { '@PROCESSDATE': '"{ENTITY}"."var"."MY_DATE"' } } }).text).toBe('"E"."var"."MY_DATE"');
    expect(tq('@FlgPreErosion == "N"', { settings: { paramValues: { '@FLGPREEROSION': 'N' }, paramMappings: {} } }).text).toBe('"N" == "N"');
    expect(tq('@REFPERIOD > 1', { settings: { paramValues: { '@REFPERIOD': '90' }, paramMappings: {} } }).text).toBe('90 > 1');
    const missing = tq('IF(@FlgPreErosion == "N")THEN(1)ELSE(0)');
    expect(missing.unresolved).toEqual([{ name: '@FLGPREEROSION', reason: expect.stringContaining('no TRAQ equivalent') }]);
  });
});

describe('@TIMEKEY against a number: never guessed into a date', () => {
  it('stays as written and the rule waits, with the reason', () => {
    const r = tq('IF(@TIMEKEY > 26267)THEN(1)ELSE(0)');
    expect(r.text).toBe('IF(@TIMEKEY > 26267)THEN(1)ELSE(0)');
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/@TIMEKEY > 26267/);
    expect(r.unresolved[0].reason).toMatch(/no SysDayMatrix rows/);
    expect(r.unresolved[0].reason).toMatch(/rather than guessing a calendar/);
    expect(r.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('reports the reversed form and lists several cut-offs once', () => {
    const r = tq('IF(26267 < @TIMEKEY)THEN(IF(@TIMEKEY > 26384)THEN(1)ELSE(2))ELSE(0)');
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/26267 < @TIMEKEY/);
    expect(r.unresolved[0].reason).toMatch(/@TIMEKEY > 26384/);
    expect(r.text).toContain('@TIMEKEY');
  });

  it('evaluates the branch instead when the user gave @TIMEKEY a known value', () => {
    const s = { paramValues: { '@TIMEKEY': '26400' }, paramMappings: {} };
    const a = tq('IF(@TIMEKEY > 26267)THEN(1)ELSE(0)', { settings: s });
    expect(a.text).toBe('IF(1==1)THEN(1)ELSE(0)');
    expect(a.unresolved).toEqual([]);
    expect(tq('@TIMEKEY > 30000', { settings: s }).text).toBe('1==0');
    expect(tq('26267 < @TIMEKEY', { settings: s }).text).toBe('1==1');
  });

  it('ignores @TIMEKEY inside text literals', () => {
    const r = tq('IF("A"."B" == "@TIMEKEY > 26267")THEN(1)ELSE(0)');
    expect(r.text).toBe('IF("A"."B" == "@TIMEKEY > 26267")THEN(1)ELSE(0)');
    expect(r.unresolved).toEqual([]);
  });

  it('reports an unusual use once', () => {
    const r = tq('ISNULL(@TIMEKEY, 0)');
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/calendar key/);
  });
});

describe('@TIMEKEY against EffectiveFromTimeKey / EffectiveToTimeKey', () => {
  const resolved = [
    res('DIMPRODUCT', 'EffectiveFromTimeKey', 'DIM_X', 'RECORD_START_DATE', 'DATE'),
    res('DIMPRODUCT', 'EffectiveToTimeKey', 'DIM_X', 'RECORD_END_DATE', 'DATE'),
    res('UPLOADSRC', 'EffectiveFromTimeKey', 'UPLOAD_X', 'EFFECTIVEFROMTIMEKEY', 'NUMBER(10,0)'),
    res('UPLOADSRC', 'EffectiveToTimeKey', 'UPLOAD_X', 'EFFECTIVETOTIMEKEY', 'NUMBER(10,0)'),
    res('OTHERDIM', 'EffectiveFromTimeKey', 'DIM_Y', 'SOME_NUMBER', 'NUMBER(10)'),
    res('DIMPRODUCT', 'LastDt', 'DIM_X', 'OTHER_DATE', 'DATE'),
  ];

  it('compares a mapped SCD2 date window with BUSINESS_DATE, moving the inclusive end to TRAQ\'s exclusive end', () => {
    const r = tq('AND("DIMPRODUCT"."EffectiveFromTimeKey" <= @TIMEKEY, "DIMPRODUCT"."EffectiveToTimeKey" >= @TIMEKEY)', { resolved });
    expect(r.text).toBe(`AND(DATEDIFF(${BD}, "DIM_X"."RECORD_START_DATE", "d") >= 0, DATEDIFF(${BD}, "DIM_X"."RECORD_END_DATE", "d") < 0)`);
    expect(r.unresolved).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/inclusive, TRAQ's RECORD_END_DATE is exclusive/);
  });

  it('handles the reversed operand order for SCD2 dates', () => {
    expect(tq('@TIMEKEY >= "DIMPRODUCT"."EffectiveFromTimeKey"', { resolved }).text).toBe(`DATEDIFF(${BD}, "DIM_X"."RECORD_START_DATE", "d") >= 0`);
    expect(tq('@TIMEKEY <= "DIMPRODUCT"."EffectiveToTimeKey"', { resolved }).text).toBe(`DATEDIFF(${BD}, "DIM_X"."RECORD_END_DATE", "d") < 0`);
  });

  it('writes @TIMEKEY as "<Entity>"."PERIOD_ID" against a TRAQ column that kept the TimeKey format', () => {
    const a = tq('AND("UPLOADSRC"."EffectiveFromTimeKey" <= @TIMEKEY, "UPLOADSRC"."EffectiveToTimeKey" >= @TIMEKEY)', { resolved });
    expect(a.text).toBe(`AND("UPLOADSRC"."EffectiveFromTimeKey" <= ${PID}, "UPLOADSRC"."EffectiveToTimeKey" >= ${PID})`);
    expect(a.unresolved).toEqual([]);
    expect(a.notes.join(' ')).toMatch(/PERIOD_ID is the run's period.*confirm EFFECTIVEFROMTIMEKEY holds the same kind of value/);
    expect(tq('@TIMEKEY >= "UPLOADSRC"."EffectiveFromTimeKey"', { resolved }).text).toBe(`${PID} >= "UPLOADSRC"."EffectiveFromTimeKey"`);
  });

  it('does not use PERIOD_ID when the entity has no such column in the workbook', () => {
    const r = tq('"UPLOADSRC"."EffectiveFromTimeKey" <= @TIMEKEY', { resolved, entityColumns: new Set(['SOMETHING']) });
    expect(r.text).toContain('@TIMEKEY');
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/E has no PERIOD_ID column in the workbook/);
  });

  it('leaves @TIMEKEY untouched and reports it when the mapping confirms neither', () => {
    const boundary = tq('"DIMPRODUCT"."EffectiveToTimeKey" > @TIMEKEY', { resolved });
    expect(boundary.text).toContain('@TIMEKEY');
    expect(boundary.unresolved[0].reason).toMatch(/inclusive, TRAQ's is exclusive/);
    const other = tq('"DIMPRODUCT"."LastDt" > @TIMEKEY', { resolved });
    expect(other.unresolved).toHaveLength(1);
    expect(other.unresolved[0].reason).toMatch(/not CrisMac's EffectiveFromTimeKey \/ EffectiveToTimeKey/);
    const odd = tq('"OTHERDIM"."EffectiveFromTimeKey" > @TIMEKEY', { resolved });
    expect(odd.unresolved).toHaveLength(1);
    expect(odd.unresolved[0].reason).toMatch(/neither RECORD_START_DATE \/ RECORD_END_DATE nor a column that kept the TimeKey format/);
  });
});

describe('what is said, not hidden', () => {
  it('notes functions and constructs no live TRAQ rule shows', () => {
    const r = tq('MAX(IF("A"."B" > 1)THEN(1)ELSEIF("A"."B" > 0)THEN(2)ELSE(3), 0)');
    expect(r.notes.join(' ')).toMatch(/MAX\(\.\.\.\) is not used by any live rule/);
    expect(r.notes.join(' ')).toMatch(/ELSEIF\(\.\.\.\) is kept as written/);
    expect(tq('IF(ISNOTEMPTY("A"."B"))THEN(COALESCE("A"."B", 0))ELSE(0)').notes).toEqual([]);
  });
});

// ---- whole rules through the dd migration ----
const col = (table: string, name: string, dataType: string) => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: 0, traqOnly: false, sheet: 's', rowNo: 0 });
const map = (src: string, sc: string, tt: string, tc: string, targetType: string): MappingRow => ({
  id: `${tt}.${tc}`, sourceSystem: 'X', sourceTable: src, sourceColumn: sc, sourceColumns: [sc], sourceType: '', targetTable: tt, targetColumn: tc, targetType, mapType: 'DERIVED', remark: '', sheet: 'S', rowNo: 1,
});
const model = {
  tables: [
    { name: 'FCT_PRODUCT_MASTER', system: 'TRAQ', layer: 'MART', columns: [col('FCT_PRODUCT_MASTER', 'PERIOD_ID', 'VARCHAR2(8)'), col('FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DATE', 'DATE'), col('FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DPD', 'NUMBER')] } as TableDef,
    { name: 'DIM_PRODUCT_TYPE', system: 'TRAQ', layer: 'MART', columns: [col('DIM_PRODUCT_TYPE', 'RECORD_START_DATE', 'DATE'), col('DIM_PRODUCT_TYPE', 'RECORD_END_DATE', 'DATE'), col('DIM_PRODUCT_TYPE', 'SCHEME_TYPE', 'VARCHAR2(10)')] } as TableDef,
    { name: 'UPLOAD_X', system: 'TRAQ', layer: 'STAGING', columns: [col('UPLOAD_X', 'EFFECTIVEFROMTIMEKEY', 'NUMBER(10,0)')] } as TableDef,
  ],
  mappings: [
    map('AccountCal', 'IntNotServicedDt', 'FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DATE', 'DATE'),
    map('AccountCal', 'DPD_IntService', 'FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DPD', 'NUMBER'),
    map('DimProduct', 'EffectiveFromTimeKey', 'DIM_PRODUCT_TYPE', 'RECORD_START_DATE', 'DATE'),
    map('DimProduct', 'EffectiveToTimeKey', 'DIM_PRODUCT_TYPE', 'RECORD_END_DATE', 'DATE'),
    map('DimProduct', 'SchemeType', 'DIM_PRODUCT_TYPE', 'SCHEME_TYPE', 'VARCHAR2(10)'),
    map('UploadSrc', 'EffectiveFromTimeKey', 'UPLOAD_X', 'EFFECTIVEFROMTIMEKEY', 'NUMBER(10,0)'),
  ],
  unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as unknown as WorkbookModel;

const rowOf = (column: string, expr: string, dataType = 'Integer'): string[] => ['AccountCal', column, 'Physical', 'Formula Expression', expr, 'Explanation.', '30-11-2021', 'PENDING_REVIEW', dataType];
const FULL: ConversionSettings = { effectiveStartDate: '', paramValues: {}, paramMappings: {} };

// DPD_Calculation / DPD_IntService, as in the project's dd_export.csv.
const DPD_INT_SERVICE = 'MAX(IF(@TIMEKEY > 26267)THEN(IF(@TIMEKEY > 26384)THEN(IF(ISNOTEMPTY("AccountCal"."IntNotServicedDt"))THEN(DATEDIFF("AccountCal"."IntNotServicedDt", @ProcessDate, "DAY") + 2)ELSE(0))ELSEIF(ISNOTEMPTY("AccountCal"."IntNotServicedDt"))THEN(DATEDIFF("AccountCal"."IntNotServicedDt", @ProcessDate, "DAY") + 1)ELSE(0))ELSEIF(ISNOTEMPTY("AccountCal"."IntNotServicedDt"))THEN(DATEDIFF("AccountCal"."IntNotServicedDt", @ProcessDate, "DAY"))ELSE(0), 0)';

describe('dd_export rules migrated to TRAQ 4X (full mode, the default)', () => {
  it('holds back DPD_IntService because its @TIMEKEY cut-offs are CrisMac TimeKey numbers, and says why', () => {
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('DPD_IntService', DPD_INT_SERVICE)], []);
    expect(r.status).toBe('needs-mapping');
    expect(r.unmapped).toEqual([expect.objectContaining({ role: 'parameter', crismac: '@TIMEKEY' })]);
    expect(r.unmapped[0].reason).toMatch(/26267/);
    expect(r.traqRow).toEqual(r.original);
  });

  it('is ready once @TIMEKEY has a known value, with DATEDIFF reordered and the run date in place', () => {
    const settings = { ...FULL, paramValues: { '@TIMEKEY': '26400' } };
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('DPD_IntService', DPD_INT_SERVICE)], [], undefined, settings);
    expect(r.status).toBe('ready');
    expect([r.traqRow[0], r.traqRow[1]]).toEqual(['FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DPD']);
    const e = r.traqRow[4];
    expect(e).not.toMatch(/@|AccountCal/);
    expect(e).toContain('IF(1==1)THEN(IF(1==1)THEN(');
    // IntNotServicedDt (earlier) is read FROM the run date, so the DPD is run date minus that date: positive when overdue.
    expect(e).toContain('DATEDIFF("FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE", "FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE", "d") + 2');
    expect(e).toContain('DATEDIFF("FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE", "FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE", "d") + 1');
    for (const i of [2, 3, 5, 6, 7, 8]) expect(r.traqRow[i]).toBe(r.original[i]);
    const notes = r.notes.join('\n');
    expect(notes).toMatch(/DATEDIFF argument order/);
    expect(notes).toMatch(/MAX\(\.\.\.\)/);
    expect(notes).toMatch(/ELSEIF/);
    expect(r.original[4]).toBe(DPD_INT_SERVICE);
  });

  it('turns a dimension validity window into TRAQ\'s RECORD_START_DATE / RECORD_END_DATE test against BUSINESS_DATE', () => {
    const expr = 'IF(AND("DimProduct"."EffectiveFromTimeKey" <= @TIMEKEY, "DimProduct"."EffectiveToTimeKey" >= @TIMEKEY, "DimProduct"."SchemeType" == "ODA"))THEN(NULL)ELSE("AccountCal"."IntNotServicedDt")';
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('IntNotServicedDt', expr, 'Date')], []);
    expect(r.status).toBe('ready');
    expect(r.traqRow[4]).toBe('IF(AND(DATEDIFF("FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE", "DIM_PRODUCT_TYPE"."RECORD_START_DATE", "d") >= 0, DATEDIFF("FCT_PRODUCT_MASTER"."var"."BUSINESS_DATE", "DIM_PRODUCT_TYPE"."RECORD_END_DATE", "d") < 0, "DIM_PRODUCT_TYPE"."SCHEME_TYPE" == "ODA"))THEN(NULL)ELSE("FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE")');
  });

  it('compares a TimeKey-format TRAQ column with the entity\'s PERIOD_ID', () => {
    const expr = 'IF("UploadSrc"."EffectiveFromTimeKey" <= @TIMEKEY)THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)';
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('IntNotServicedDt', expr, 'Date')], []);
    expect(r.status).toBe('ready');
    expect(r.traqRow[4]).toBe('IF("UPLOAD_X"."EFFECTIVEFROMTIMEKEY" <= "FCT_PRODUCT_MASTER"."PERIOD_ID")THEN("FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE")ELSE(NULL)');
    expect(r.notes.join(' ')).toMatch(/PERIOD_ID is the run's period/);
  });

  it('keeps a rule out of the ready file, untouched, when a parameter cannot be converted', () => {
    const expr = 'IF(@FlgPreErosion == "N")THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)';
    const [r] = migrateDdRows(model, 'Final', DD_HEADER, [rowOf('IntNotServicedDt', expr, 'Date')], []);
    expect(r.status).toBe('needs-mapping');
    expect(r.unmapped).toEqual([expect.objectContaining({ role: 'parameter', crismac: '@FLGPREEROSION' })]);
    expect(r.traqRow).toEqual(r.original);
    expect(readyDoc([r], 't').sheets[0].rows).toHaveLength(0);
    const apart = needsMappingDoc([r], 't').sheets[0].rows;
    expect(apart[0][10]).toBe('@FLGPREEROSION');
    expect(apart[0][11]).toMatch(/@FLGPREEROSION: @FLGPREEROSION is a procedure parameter/);
  });

  it('becomes ready once the parameter is given a value in the conversion settings', () => {
    const expr = 'IF(@FlgPreErosion == "N")THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)';
    const settings = { ...FULL, paramValues: { '@FLGPREEROSION': 'N' } };
    const [r] = migrateDdRows(model, 'Final', DD_HEADER, [rowOf('IntNotServicedDt', expr, 'Date')], [], undefined, settings);
    expect(r.status).toBe('ready');
    expect(r.traqRow[4]).toBe('IF("N" == "N")THEN("FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE")ELSE(NULL)');
  });

  it('does not convert @TIMEKEY against a column that is not CrisMac\'s EffectiveFrom/ToTimeKey', () => {
    const expr = 'IF("AccountCal"."DPD_IntService" > @TIMEKEY)THEN(1)ELSE(0)';
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('DPD_IntService', expr)], []);
    expect(r.status).toBe('needs-mapping');
    expect(r.unmapped[0].reason).toMatch(/not CrisMac's EffectiveFromTimeKey/);
  });
});

describe('"Names only" audit mode', () => {
  const names = { ...FULL, namesOnly: true };

  it('replaces only the names and keeps the CrisMac syntax exactly as written, without holding the rule back', () => {
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('DPD_IntService', DPD_INT_SERVICE)], [], undefined, names);
    expect(r.status).toBe('ready');
    expect(r.traqRow[4]).toBe(DPD_INT_SERVICE.replace(/"AccountCal"\."IntNotServicedDt"/g, '"FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE"'));
    expect(r.traqRow[4]).toContain('@TIMEKEY > 26267');
    expect(r.traqRow[4]).toContain('DATEDIFF("FCT_PRODUCT_MASTER"."OUT_OF_ORDER_DATE", @ProcessDate, "DAY") + 2');
    expect([r.traqRow[0], r.traqRow[1]]).toEqual(['FCT_PRODUCT_MASTER', 'OUT_OF_ORDER_DPD']);
    for (const i of [2, 3, 5, 6, 7, 8]) expect(r.traqRow[i]).toBe(r.original[i]);
    expect(r.notes.join(' ')).toMatch(/Names only: the CrisMac syntax is kept as written/);
  });

  it('still keeps a rule with an unmapped column out of the ready file', () => {
    const expr = 'IF("DIMPRODUCT"."Unmapped" == "ODA")THEN(NULL)ELSE("AccountCal"."IntNotServicedDt")';
    const [r] = migrateDdRows(model, 'DPD_Calculation', DD_HEADER, [rowOf('IntNotServicedDt', expr, 'Date')], [], undefined, names);
    expect(r.status).toBe('needs-mapping');
    expect(r.unmapped.map((u) => u.crismac)).toEqual(['DIMPRODUCT.Unmapped']);
  });

  it('is the default only when asked for: without the switch the same rule is translated', () => {
    const settings = { ...FULL, paramValues: { '@TIMEKEY': '26400' } };
    const [on] = migrateDdRows(model, 'D', DD_HEADER, [rowOf('DPD_IntService', DPD_INT_SERVICE)], [], undefined, { ...settings, namesOnly: true });
    const [off] = migrateDdRows(model, 'D', DD_HEADER, [rowOf('DPD_IntService', DPD_INT_SERVICE)], [], undefined, { ...settings, namesOnly: false });
    expect(on.traqRow[4]).toContain('@ProcessDate');
    expect(off.traqRow[4]).not.toContain('@ProcessDate');
    expect(off.traqRow[4]).toContain('"var"."BUSINESS_DATE"');
  });
});

describe('coverage and blockers', () => {
  it('ranks the columns and parameters that block the most rules, and counts ready rules per procedure', () => {
    const waiting = (col: string, expr: string) => migrateDdRows(model, 'Final', DD_HEADER, [rowOf(col, expr, 'Date')], [])[0];
    const rules = [
      waiting('IntNotServicedDt', 'IF(@FlgPreErosion == "N")THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)'),
      waiting('IntNotServicedDt', 'IF(@FlgPreErosion == "Y")THEN("AccountCal"."IntNotServicedDt")ELSE("OTHER"."X")'),
      waiting('IntNotServicedDt', 'IF("OTHER"."X" == "Y")THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)'),
      migrateDdRows(model, 'DPD', DD_HEADER, [rowOf('IntNotServicedDt', 'IF(ISNOTEMPTY("AccountCal"."IntNotServicedDt"))THEN("AccountCal"."IntNotServicedDt")ELSE(NULL)', 'Date')], [])[0],
    ];
    const b = blockingColumns(rules);
    expect(b.map((x) => [x.crismac, x.rules])).toEqual([['@FLGPREEROSION', 2], ['OTHER.X', 2]]);
    expect(b[0]).toMatchObject({ role: 'parameter', procedures: ['Final'] });
    expect(coverageByProcedure(rules)).toEqual([{ procedure: 'Final', total: 3, ready: 0 }, { procedure: 'DPD', total: 1, ready: 1 }]);
  });
});
