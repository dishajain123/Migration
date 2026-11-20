import type { Relationship, WorkbookModel } from '@/types';
import { memo } from './memo';

/**
 * Relationships are NOT stated as physical foreign keys in the workbook. They are derived from mapping rows whose
 * MAP TYPE is LOOKUP or JOIN: the target column resolves through a dimension (named in the remark, e.g. DIM_PRODUCT_TYPE)
 * or through the source table/column when no dimension is named.
 */
export function allRelationships(model: WorkbookModel): Relationship[] {
  return memo(model, 'relationships', () => {
    const out: Relationship[] = [];
    for (const m of model.mappings) {
      const kind = m.mapType.toUpperCase();
      if ((kind !== 'LOOKUP' && kind !== 'JOIN') || !m.targetTable || !m.targetColumn) continue;
      const dims = Array.from(new Set(m.remark.match(/\bDIM_[A-Z0-9_]+/g) ?? []));
      const toTables = dims.length ? dims : [m.sourceTable];
      for (const toTable of toTables) {
        if (!toTable || toTable === m.targetTable) continue;
        const toColumn = dims.length ? '(dimension key)' : m.sourceColumn || '(not stated)';
        out.push({
          id: dims.length > 1 ? `${m.id}:${toTable}` : m.id, fromTable: m.targetTable, fromColumn: m.targetColumn, toTable, toColumn, kind,
          remark: m.remark, sheet: m.sheet, rowNo: m.rowNo,
        });
      }
    }
    return out;
  });
}

export function relationshipsFor(model: WorkbookModel, table: string): Relationship[] {
  return allRelationships(model).filter((r) => r.fromTable === table || r.toTable === table);
}
