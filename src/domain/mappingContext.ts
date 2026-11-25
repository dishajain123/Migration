import type { WorkbookModel } from '@/types';
import type { SchemaTable } from './aiPrompts';
import { candidatePool } from './mappingEngine';

/** Every source column the engine compares for a target table, grouped by table (the "SOURCE SCHEMA" the AI may propose from). */
export function candidateSchema(model: WorkbookModel, tableName: string): SchemaTable[] {
  const t = model.tables.find((x) => x.name === tableName);
  if (!t) return [];
  const by = new Map<string, SchemaTable>();
  for (const p of candidatePool(model, t)) {
    const e = by.get(p.table) ?? { table: p.table, columns: [] };
    e.columns.push({ name: p.column, type: p.type });
    by.set(p.table, e);
  }
  return Array.from(by.values()).sort((a, b) => a.table.localeCompare(b.table));
}
