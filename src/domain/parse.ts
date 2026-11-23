import Papa from 'papaparse';
import type {
  ColumnDef, DaRule, DecisionRow, Layer, MappingRow, SheetInfo, SystemKind, TableDef, UnmappedColumn, WorkbookModel,
} from '@/types';
import { IN_SCOPE_SHEETS, INDEX_SHEET, OUT_OF_SCOPE_TABLES, RULES_SHEET } from './constants';

interface RawRow { rowNo: number; c: string[] }
interface IndexMeta { layer: Layer; cols?: number; mapped?: number; rows?: number; structure: string }
type Kind = 'A' | 'B' | 'C';
type Mode = 'map' | 'unmappedHeader' | 'unmapped' | 'traqOnly';

const num = (s: string): number | undefined => {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const clean = (s: string) => (s === '-' ? '' : s);
const splitCols = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const sysOf = (s: string): SystemKind => (/^TRAQ/i.test(s) ? 'TRAQ' : 'CrisMac');
function toLayer(s: string): Layer {
  const u = s.toUpperCase();
  const found = (['RECEPTION', 'STAGING', 'MART', 'APP', 'DI'] as const).find((l) => l === u);
  return found ?? 'MART';
}

/**
 * Parse the flattened workbook CSV (Sheet_Name, Row_No, Col_1..Col_11).
 * Sheet shapes: A = TRAQ-centric mapping, B = source-centric mapping, C = source->target mapping.
 * Nothing is inferred beyond what the cells contain.
 */
export function parseWorkbookCsv(text: string): WorkbookModel {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length || (rows[0][0] ?? '').trim().replace(/^﻿/, '') !== 'Sheet_Name') {
    throw new Error('Not a valid combined workbook CSV (expected a header starting with Sheet_Name).');
  }

  const bySheet = new Map<string, RawRow[]>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[0] ?? '').trim();
    if (!name) continue;
    const c = Array.from({ length: 11 }, (_, k) => (r[k + 2] ?? '').trim());
    const list = bySheet.get(name) ?? [];
    list.push({ rowNo: Number(r[1]) || i, c });
    bySheet.set(name, list);
  }

  // ---- Index sheet ----
  const indexMeta = new Map<string, IndexMeta>();
  let inIdx = false;
  for (const r of bySheet.get(INDEX_SHEET) ?? []) {
    if (r.c[0] === 'TRAQ TABLE' && r.c[1] === 'LAYER') { inIdx = true; continue; }
    if (!inIdx || !r.c[0] || !r.c[1]) continue;
    indexMeta.set(r.c[0], {
      layer: toLayer(r.c[1]), cols: num(r.c[2]), mapped: num(r.c[3]), rows: num(r.c[4]), structure: r.c[5],
    });
  }
  const upperMap = new Map<string, string[]>();
  for (const n of indexMeta.keys()) {
    const u = n.toUpperCase();
    upperMap.set(u, [...(upperMap.get(u) ?? []), n]);
  }

  // ---- Tables ----
  const tables = new Map<string, TableDef>();
  const colSets = new Map<string, Set<string>>();

  function layerOf(name: string): Layer {
    const m = indexMeta.get(name);
    if (m) return m.layer;
    const u = name.toUpperCase();
    if (u.startsWith('STG_')) return 'STAGING';
    if (u.startsWith('RECP_')) return 'RECEPTION';
    return 'MART';
  }
  function ensureTable(name: string, system: SystemKind): TableDef {
    let t = tables.get(name);
    if (!t) {
      t = { name, system, layer: system === 'CrisMac' ? 'CRISMAC' : layerOf(name), columns: [] };
      tables.set(name, t);
      colSets.set(name, new Set());
    }
    return t;
  }
  function addColumn(
    t: TableDef, name: string, dataType: string, nullable: boolean | null, sheet: string, rowNo: number, traqOnly: boolean,
  ) {
    name = clean(name);
    if (!name) return;
    const set = colSets.get(t.name)!;
    if (set.has(name)) return;
    set.add(name);
    const col: ColumnDef = {
      id: `${t.name}::${name}`, table: t.name, name, dataType: clean(dataType), nullable,
      ordinal: t.columns.length + 1, traqOnly, sheet, rowNo,
    };
    t.columns.push(col);
  }
  function resolveSource(system: string, table: string): { name: string; system: SystemKind } {
    if (indexMeta.has(table)) return { name: table, system: 'TRAQ' };
    const u = upperMap.get(table.toUpperCase());
    if (u && u.length === 1) return { name: u[0], system: 'TRAQ' };
    return { name: table, system: sysOf(system) };
  }

  const mappings: MappingRow[] = [];
  const unmapped: UnmappedColumn[] = [];
  const sheetInfos: SheetInfo[] = [];

  function pushMapping(
    sheet: string, rowNo: number, sourceSystem: string, sourceTableRaw: string, sourceColumn: string, sourceType: string,
    targetTable: string, targetColumn: string, targetType: string, mapType: string, remark: string,
  ) {
    const src = sourceTableRaw ? resolveSource(sourceSystem, sourceTableRaw) : { name: '', system: sysOf(sourceSystem) };
    const m: MappingRow = {
      id: `${sheet}:${rowNo}`, sourceSystem, sourceTable: src.name, sourceColumn, sourceColumns: splitCols(sourceColumn),
      sourceType, targetTable, targetColumn, targetType, mapType, remark, sheet, rowNo,
    };
    mappings.push(m);
    if (src.name) {
      const st = ensureTable(src.name, src.system);
      for (const sc of m.sourceColumns) {
        if (sc.startsWith('(') || /^the /i.test(sc)) continue; // free-text descriptors, not columns
        addColumn(st, sc, m.sourceColumns.length === 1 ? sourceType : '', null, sheet, rowNo, false);
      }
    }
  }

  function processSheet(sheet: string, sheetRows: RawRow[]) {
    let kind: Kind | null = null;
    let mode: Mode = 'map';
    for (const r of sheetRows) {
      const c = r.c;
      if (c[0] === 'TRAQ COLUMN' && c[1] === 'DATATYPE') { kind = 'A'; mode = 'map'; continue; }
      if (c[0] === 'CRISMAC SOURCE' && c[4] === 'TRAQ TABLE') {
        if (c[6] === 'DECISION') mode = 'unmapped';
        else { kind = 'B'; mode = 'map'; }
        continue;
      }
      if (c[0] === 'SOURCE SYSTEM' && c[1] === 'SOURCE TABLE') { kind = 'C'; mode = 'map'; continue; }
      if (c[0] === 'TRAQ TABLE' && c[1] === 'TRAQ COLUMN') { mode = 'traqOnly'; continue; }
      if (c[0].startsWith('CRISMAC COLUMNS WITH NO TRAQ TARGET')) { mode = 'unmappedHeader'; continue; }
      if (!kind) continue;

      if (mode === 'unmappedHeader') continue;
      if (mode === 'traqOnly') {
        if (c[0] && c[1]) addColumn(ensureTable(c[0], 'TRAQ'), c[1], c[2], c[3].toUpperCase() === 'NOT NULL' ? false : true, sheet, r.rowNo, true);
        continue;
      }
      if (mode === 'unmapped') {
        if (!c[0] || !c[1]) continue;
        const src = resolveSource(c[0], c[1]);
        addColumn(ensureTable(src.name, src.system), c[2], c[3], null, sheet, r.rowNo, false);
        unmapped.push({
          id: `u:${sheet}:${r.rowNo}`, sheet, sourceSystem: c[0], sourceTable: src.name, column: c[2], dataType: c[3],
          traqTable: c[4], traqColumn: c[5], decision: c[6], note: '', rowNo: r.rowNo,
        });
        continue;
      }

      // mode === 'map'
      if (kind === 'A') {
        if (!c[0]) continue;
        const target = ensureTable(sheet, 'TRAQ');
        addColumn(target, c[0], c[1], c[2].toUpperCase() === 'NOT NULL' ? false : true, sheet, r.rowNo, false);
        if (c[3] || c[7]) {
          pushMapping(sheet, r.rowNo, c[3], clean(c[4]), clean(c[5]), c[6], sheet, c[0], c[1], c[7], c[8]);
        }
      } else if (kind === 'B') {
        if (!c[1]) continue;
        const srcTable = c[1].startsWith('on the') ? `${sheet} (CrisMac)` : c[1];
        const targetTable = c[4];
        if (!targetTable) {
          const src = resolveSource(c[0], srcTable);
          addColumn(ensureTable(src.name, src.system), c[2], c[3], null, sheet, r.rowNo, false);
          unmapped.push({
            id: `u:${sheet}:${r.rowNo}`, sheet, sourceSystem: c[0], sourceTable: src.name, column: c[2], dataType: c[3],
            traqTable: '', traqColumn: '', decision: c[7], note: c[8], rowNo: r.rowNo,
          });
          continue;
        }
        addColumn(ensureTable(targetTable, 'TRAQ'), c[5], c[6], null, sheet, r.rowNo, false);
        pushMapping(sheet, r.rowNo, c[0], srcTable, c[2], c[3], targetTable, clean(c[5]), c[6], c[7], c[8]);
      } else {
        if (!c[1] && !c[4]) continue;
        const targetTable = clean(c[4]);
        const targetColumn = clean(c[5]);
        if (targetTable && targetColumn) addColumn(ensureTable(targetTable, 'TRAQ'), targetColumn, c[6], null, sheet, r.rowNo, false);
        pushMapping(sheet, r.rowNo, c[0], clean(c[1]), clean(c[2]), c[3], targetTable, targetColumn, c[6], c[7], c[8]);
      }
    }
  }

  const kindOfSheet = new Map<string, SheetInfo['kind']>();
  for (const [name, list] of bySheet) {
    const inScope = IN_SCOPE_SHEETS.includes(name);
    const banner = list.find((r) => r.rowNo === 2)?.c[0] ?? '';
    let kind: SheetInfo['kind'] = 'other';
    if (name === INDEX_SHEET) kind = 'index';
    else if (name === RULES_SHEET) kind = 'rules';
    else {
      for (const r of list) {
        if (r.c[0] === 'TRAQ COLUMN' && r.c[1] === 'DATATYPE') { kind = 'A'; break; }
        if (r.c[0] === 'CRISMAC SOURCE' && r.c[4] === 'TRAQ TABLE' && r.c[6] !== 'DECISION') { kind = 'B'; break; }
        if (r.c[0] === 'SOURCE SYSTEM' && r.c[1] === 'SOURCE TABLE') { kind = 'C'; break; }
      }
    }
    kindOfSheet.set(name, kind);
    sheetInfos.push({ name, rowCount: list.length, banner, kind, inScope: inScope || name === INDEX_SHEET || name === RULES_SHEET });
    if (inScope) processSheet(name, list);
  }

  // ---- Apply index metadata to TRAQ tables (skip out-of-scope) ----
  for (const [name, meta] of indexMeta) {
    if (OUT_OF_SCOPE_TABLES.includes(name)) continue;
    const t = tables.get(name) ?? ensureTable(name, 'TRAQ');
    t.layer = meta.layer;
    t.declaredColumns = meta.cols;
    t.declaredMapped = meta.mapped;
    t.rowsInDb = meta.rows;
    t.structureFrom = meta.structure;
    if (bySheet.has(name)) {
      t.sheet = name;
      t.banner = bySheet.get(name)!.find((r) => r.rowNo === 2)?.c[0] ?? '';
    }
  }

  // ---- FPM_DA_RULES ----
  const daRules: DaRule[] = [];
  const decisionRows: DecisionRow[] = [];
  let rmode: 'none' | 'rules' | 'decision' = 'none';
  for (const r of bySheet.get(RULES_SHEET) ?? []) {
    const c = r.c;
    if (c[0] === 'RUN' && c[1] === 'TRAQ COLUMN') { rmode = 'rules'; continue; }
    if (c[0] === 'ROW' && c[1] === 'CONDITION NAME') { rmode = 'decision'; continue; }
    if (!c[0]) continue;
    if (rmode === 'rules') {
      daRules.push({
        run: c[0], column: c[1], kind: c[2], dataType: c[3], ruleType: c[4], inForceFrom: c[5], crismac: c[6],
        reads: c[7], logic: c[8], expression: c[9], version: c[10], rowNo: r.rowNo,
      });
    } else if (rmode === 'decision') {
      decisionRows.push({
        row: c[0], name: c[1], result: c[2], npaId: c[3], crismac: c[6], meaning: c[8], conditions: c[9], rowNo: r.rowNo,
      });
    }
  }

  return {
    tables: Array.from(tables.values()),
    mappings,
    unmapped,
    daRules,
    decisionRows,
    sheets: sheetInfos,
    outOfScope: OUT_OF_SCOPE_TABLES,
    loadedAt: new Date().toISOString(),
  };
}
