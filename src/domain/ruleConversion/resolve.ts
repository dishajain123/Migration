import type { ColumnResolution, MappingBasis, MappingCandidate, MappingStatus, ReviewedMapping, WorkbookModel } from '@/types';
import { memo } from '../memo';
import { traqNameMatches } from '../procTrace';
import { feedingMappings, tableByName } from '../selectors';

/*
 * CrisMac column -> TRAQ column, using only mappings that already exist in the project:
 *   1. manual mappings entered in Agent 4,
 *   2. suggestions approved in Agent 4,
 *   3. documented workbook mapping rows (feeding MAP TYPEs only),
 *   4. a TRAQ column with the same name (unconfirmed - always needs review).
 * The highest tier that has any candidate wins; nothing is invented.
 */

/** Logical table name: schema, brackets and # prefixes removed, upper-case ("PRO.AccountCal" and "##AccountCal" -> ACCOUNTCAL). */
export function logicalTable(name: string): string {
  return (name.replace(/[[\]]/g, '').split('.').pop() ?? '').replace(/^#+/, '').toUpperCase();
}

const ck = (table: string, column: string) => `${logicalTable(table)}.${column.toUpperCase()}`;

const LAYER_RANK: Record<string, number> = { MART: 0, STAGING: 1, APP: 2, RECEPTION: 3, DI: 4, CRISMAC: 5 };

export interface MappingIndex {
  byTier: Map<MappingBasis, Map<string, MappingCandidate[]>>;
  /** Columns each CrisMac table is known to have (from mapping rows), to place unqualified column names. */
  knownColumns: Map<string, Set<string>>;
}

function workbookIndex(model: WorkbookModel): { map: Map<string, MappingCandidate[]>; known: Map<string, Set<string>> } {
  return memo(model, 'ruleConv:workbookIndex', () => {
    const tmap = tableByName(model);
    const map = new Map<string, MappingCandidate[]>();
    const known = new Map<string, Set<string>>();
    for (const m of model.mappings) {
      if (!m.sourceTable) continue;
      const t = logicalTable(m.sourceTable);
      const set = known.get(t) ?? new Set<string>();
      m.sourceColumns.forEach((c) => set.add(c.toUpperCase()));
      known.set(t, set);
    }
    for (const m of feedingMappings(model)) {
      if (!m.sourceTable || tmap.get(m.targetTable)?.system !== 'TRAQ') continue;
      const dataType = m.targetType || tmap.get(m.targetTable)?.columns.find((c) => c.name === m.targetColumn)?.dataType || '';
      for (const sc of m.sourceColumns) {
        const k = ck(m.sourceTable, sc);
        const list = map.get(k) ?? [];
        if (!list.some((x) => x.table === m.targetTable && x.column === m.targetColumn)) {
          list.push({ table: m.targetTable, column: m.targetColumn, dataType, basis: 'workbook', mapType: m.mapType, sheet: m.sheet, rowNo: m.rowNo });
        }
        map.set(k, list);
      }
    }
    return { map, known };
  });
}

export function buildMappingIndex(model: WorkbookModel, reviewed: ReviewedMapping[]): MappingIndex {
  const wb = workbookIndex(model);
  const manual = new Map<string, MappingCandidate[]>();
  const approved = new Map<string, MappingCandidate[]>();
  for (const r of reviewed) {
    const target = r.id.startsWith('manual:') ? manual : approved;
    const k = ck(r.sourceTable, r.sourceColumn);
    const list = target.get(k) ?? [];
    list.push({ table: r.targetTable, column: r.targetColumn, dataType: r.targetType, basis: r.id.startsWith('manual:') ? 'agent4-manual' : 'agent4-approved' });
    target.set(k, list);
  }
  return {
    byTier: new Map<MappingBasis, Map<string, MappingCandidate[]>>([['agent4-manual', manual], ['agent4-approved', approved], ['workbook', wb.map]]),
    knownColumns: wb.known,
  };
}

const STATUS: Record<MappingBasis, MappingStatus> = {
  'agent4-manual': 'approved', 'agent4-approved': 'approved', workbook: 'documented', 'name-match': 'name-match',
};
const BASIS_TEXT: Record<MappingBasis, string> = {
  'agent4-manual': 'manual mapping entered in Agent 4',
  'agent4-approved': 'suggestion approved in Agent 4',
  workbook: 'documented workbook mapping',
  'name-match': 'same column name in TRAQ (unconfirmed)',
};

/**
 * Resolve one CrisMac column. `preferTable` (the rule's TRAQ table) breaks ties between several targets of the same tier,
 * because a rule's expression should read columns of the table it writes.
 */
export function resolveColumn(
  model: WorkbookModel, index: MappingIndex, table: string, column: string, preferTable?: string,
): ColumnResolution {
  const crismacTable = logicalTable(table);
  const crismacColumn = column.toUpperCase();
  const k = `${crismacTable}.${crismacColumn}`;
  let candidates: MappingCandidate[] = [];
  let tier: MappingBasis | null = null;
  for (const b of ['agent4-manual', 'agent4-approved', 'workbook'] as MappingBasis[]) {
    const list = index.byTier.get(b)?.get(k) ?? [];
    if (list.length) { candidates = list; tier = b; break; }
  }
  if (!tier) {
    const tmap = tableByName(model);
    candidates = traqNameMatches(model, crismacColumn).map((m) => ({
      table: m.table, column: m.column, basis: 'name-match' as const,
      dataType: tmap.get(m.table)?.columns.find((c) => c.name === m.column)?.dataType ?? '',
    }));
    if (candidates.length) tier = 'name-match';
  }
  if (!tier) {
    return { crismacTable, crismacColumn, status: 'missing', chosen: null, candidates: [], note: 'No Agent 4 or workbook mapping, and no TRAQ column with this name.' };
  }
  const tmap = tableByName(model);
  const ordered = [...candidates].sort((a, b) => (LAYER_RANK[tmap.get(a.table)?.layer ?? ''] ?? 9) - (LAYER_RANK[tmap.get(b.table)?.layer ?? ''] ?? 9) || a.table.localeCompare(b.table));
  const preferred = preferTable ? ordered.filter((c) => c.table === preferTable) : [];
  const pool = preferred.length ? preferred : ordered;
  const distinctTargets = new Set(pool.map((c) => `${c.table}.${c.column}`));
  const chosen = pool[0];
  const ambiguous = distinctTargets.size > 1;
  const others = candidates.length - 1;
  return {
    crismacTable, crismacColumn, chosen, candidates: ordered,
    status: ambiguous ? 'ambiguous' : STATUS[tier],
    note: ambiguous
      ? `${distinctTargets.size} possible TRAQ columns from ${BASIS_TEXT[tier]}s; ${chosen.table}.${chosen.column} chosen by layer order - confirm in Agent 4.`
      : `${BASIS_TEXT[tier]}${others > 0 ? `; ${others} target(s) in other tables not used here` : ''}.`,
  };
}

/** Which CrisMac table an unqualified column most likely belongs to, given the tables a statement touches. */
export function placeColumn(index: MappingIndex, column: string, tables: string[]): string {
  const c = column.toUpperCase();
  const hits = tables.filter((t) => index.knownColumns.get(logicalTable(t))?.has(c));
  return hits[0] ?? tables[0] ?? '';
}
