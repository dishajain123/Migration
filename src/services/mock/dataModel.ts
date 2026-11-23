import { KNOWN_GAPS } from '@/domain/constants';
import { relationshipsFor } from '@/domain/relationships';
import { colKey, feedingMappings, fedKeySet, mappingsBySource, mappingsByTarget, parsePrimaryKey, summarizeTable } from '@/domain/selectors';
import { compat } from '@/domain/typeUtils';
import type { ComparePair, ColumnDetail, TableDetail } from '@/types';
import { getWorkbook } from '../workbookSource';
import type { DataModelService } from '../types';
import { respond } from './respond';

const NOTE = 'Workbook-derived metadata';

export const mockDataModel: DataModelService = {
  getScope: () => respond(async () => {
    const m = await getWorkbook();
    return {
      inScopeSheets: m.sheets.filter((s) => s.inScope),
      outOfScope: m.outOfScope,
      counts: {
        traqTables: m.tables.filter((t) => t.system === 'TRAQ').length,
        sourceTables: m.tables.filter((t) => t.system === 'CrisMac').length,
        columns: m.tables.reduce((a, t) => a + t.columns.length, 0),
        mappings: m.mappings.length,
      },
      gaps: KNOWN_GAPS,
    };
  }, { simulated: false, note: NOTE }),

  listTables: (q) => respond(async () => {
    const m = await getWorkbook();
    const s = q?.search?.trim().toLowerCase();
    return m.tables
      .filter((t) => (!q?.system || t.system === q.system) && (!q?.layer || t.layer === q.layer) && (!s || t.name.toLowerCase().includes(s)))
      .map((t) => summarizeTable(m, t))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, { simulated: false, note: NOTE }),

  getTable: (name) => respond(async (): Promise<TableDetail> => {
    const m = await getWorkbook();
    const t = m.tables.find((x) => x.name === name);
    if (!t) throw new Error(`Table ${name} not found`);
    const byTarget = mappingsByTarget(m);
    const bySource = mappingsBySource(m);
    const fed = fedKeySet(m);
    const columns: ColumnDetail[] = t.columns.map((c) => ({
      name: c.name, dataType: c.dataType, nullable: c.nullable, traqOnly: c.traqOnly,
      feeds: (byTarget.get(colKey(t.name, c.name)) ?? []).map((x) => ({ sourceTable: x.sourceTable, sourceColumn: x.sourceColumn, mapType: x.mapType, sheet: x.sheet, rowNo: x.rowNo })),
      usedBy: (bySource.get(colKey(t.name, c.name)) ?? []).slice(0, 8).map((x) => ({ targetTable: x.targetTable, targetColumn: x.targetColumn })),
      isFed: fed.has(colKey(t.name, c.name)),
    }));
    const notes: string[] = [];
    if (t.declaredColumns !== undefined && t.declaredColumns !== t.columns.length) {
      notes.push(`Index declares ${t.declaredColumns} column(s) but ${t.columns.length} distinct column(s) are listed in the workbook.`);
    }
    if (t.rowsInDb !== undefined) notes.push(`Index reports ${t.rowsInDb.toLocaleString()} row(s) in DB.`);
    if (t.columns.length === 0) notes.push('No column list is provided in the workbook for this table.');
    if (parsePrimaryKey(t.banner ?? '').length === 0) notes.push('No primary key is stated in the workbook for this table.');
    return { table: summarizeTable(m, t), banner: t.banner ?? '', primaryKey: parsePrimaryKey(t.banner ?? ''), columns, notes };
  }, { simulated: false, note: NOTE }),

  getRelationships: (table) => respond(async () => relationshipsFor(await getWorkbook(), table), {
    simulated: false, note: 'Derived from LOOKUP/JOIN mapping rows; physical foreign keys are not stated in the workbook.',
  }),

  exportMetadata: () => respond(async () => getWorkbook(), { simulated: false, note: 'Full parsed workbook metadata' }),

  compare: (source, target) => respond(async () => {
    const m = await getWorkbook();
    const s = m.tables.find((x) => x.name === source);
    const t = m.tables.find((x) => x.name === target);
    if (!s || !t) throw new Error('Source or target table not found');
    const pairs: ComparePair[] = [];
    const usedSrc = new Set<string>();
    for (const x of feedingMappings(m)) {
      if (x.sourceTable !== source || x.targetTable !== target) continue;
      const c = compat(x.sourceType, x.targetType);
      for (const sc of x.sourceColumns.length ? x.sourceColumns : ['']) {
        usedSrc.add(sc);
        pairs.push({ sourceColumn: sc, sourceType: x.sourceType, targetColumn: x.targetColumn, targetType: x.targetType, mapType: x.mapType, compat: c.level, note: c.note });
      }
    }
    const tgtMapped = new Set(pairs.map((p) => p.targetColumn));
    return {
      source: summarizeTable(m, s), target: summarizeTable(m, t), pairs,
      unusedSourceColumns: s.columns.filter((c) => !usedSrc.has(c.name)).map((c) => c.name),
      unfedTargetColumns: t.columns.filter((c) => !c.traqOnly && !tgtMapped.has(c.name)).map((c) => c.name),
    };
  }, { simulated: false, note: 'Comparison uses documented mappings only' }),
};
