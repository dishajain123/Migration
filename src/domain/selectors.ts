import type { ColumnDef, CoverageRow, MappingRow, TableDef, TableSummary, WorkbookModel } from '@/types';
import { NONFEED } from './constants';
import { memo } from './memo';

export const colKey = (t: string, c: string) => `${t}::${c}`;

export const isFeeding = (m: MappingRow): boolean =>
  !!m.targetTable && !!m.targetColumn && !NONFEED.has(m.mapType.toUpperCase());

export function feedingMappings(model: WorkbookModel): MappingRow[] {
  return memo(model, 'feeding', () => model.mappings.filter(isFeeding));
}

export function fedKeySet(model: WorkbookModel): Set<string> {
  return memo(model, 'fedKeys', () => new Set(feedingMappings(model).map((m) => colKey(m.targetTable, m.targetColumn))));
}

export function mappingsByTarget(model: WorkbookModel): Map<string, MappingRow[]> {
  return memo(model, 'byTarget', () => {
    const map = new Map<string, MappingRow[]>();
    for (const m of model.mappings) {
      if (!m.targetTable || !m.targetColumn) continue;
      const k = colKey(m.targetTable, m.targetColumn);
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return map;
  });
}

export function mappingsBySource(model: WorkbookModel): Map<string, MappingRow[]> {
  return memo(model, 'bySource', () => {
    const map = new Map<string, MappingRow[]>();
    for (const m of model.mappings) {
      if (!m.sourceTable) continue;
      for (const sc of m.sourceColumns) {
        const k = colKey(m.sourceTable, sc);
        map.set(k, [...(map.get(k) ?? []), m]);
      }
    }
    return map;
  });
}

export function tableByName(model: WorkbookModel): Map<string, TableDef> {
  return memo(model, 'tableByName', () => new Map(model.tables.map((t) => [t.name, t])));
}

/** Dictionary-only tables (RECEPTION/APP/DI) are not in the load path and excluded from coverage. */
export const isLoadPathTable = (t: TableDef) => t.system === 'TRAQ' && (t.layer === 'STAGING' || t.layer === 'MART');

export const coverageColumns = (t: TableDef): ColumnDef[] => t.columns.filter((c) => !c.traqOnly);

export function summarizeTable(model: WorkbookModel, t: TableDef): TableSummary {
  const fed = fedKeySet(model);
  return {
    name: t.name, system: t.system, layer: t.layer, sheet: t.sheet, declaredColumns: t.declaredColumns,
    listedColumns: t.columns.length,
    fedColumns: t.system === 'TRAQ' ? t.columns.filter((c) => fed.has(colKey(t.name, c.name))).length : 0,
    rowsInDb: t.rowsInDb, structureFrom: t.structureFrom,
  };
}

export function tableCoverage(model: WorkbookModel): CoverageRow[] {
  return memo(model, 'coverage', () => {
    const fed = fedKeySet(model);
    const out: CoverageRow[] = [];
    for (const t of model.tables) {
      if (!isLoadPathTable(t)) continue;
      const cols = coverageColumns(t);
      if (cols.length === 0) continue;
      const f = cols.filter((c) => fed.has(colKey(t.name, c.name))).length;
      out.push({ table: t.name, layer: t.layer, fed: f, total: cols.length, pct: Math.round((f / cols.length) * 100) });
    }
    return out.sort((a, b) => a.pct - b.pct);
  });
}

export function parsePrimaryKey(banner: string): string[] {
  const m = /primary key\s*\(([^)]+)\)/i.exec(banner);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export function countBy<T>(items: T[], key: (x: T) => string): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const i of items) map.set(key(i), (map.get(key(i)) ?? 0) + 1);
  return Array.from(map, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
