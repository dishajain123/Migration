import type {
  ColumnResolution, DdMigratedRule, DdUnmappedRef, ReviewedMapping, WorkbookModel,
} from '@/types';
import type { ExportDoc } from '../exporters';
import { buildMappingIndex, resolveColumn, type MappingIndex } from './resolve';

/*
 * Migrate the corrected rules the project already has (public/data/latest dd output/<proc>/dd_export.csv) to TRAQ names.
 * Nothing about the rule is rewritten: Derivation Option, Rule Explanation, dates, Status, Data Type and the expression's
 * structure, operators, literals and parameters stay exactly as written. Only the Entity Name, Column Name and the
 * quoted "Table"."Column" references are replaced, and only where Agent 4 / the workbook confirm the TRAQ column.
 * A rule with any reference that is not confirmed is NOT converted at all: it is listed separately with its original
 * text untouched, so the output never contains placeholder text such as "unmapped".
 */

export const DD_HEADER = ['Entity Name', 'Column Name', 'Column Type', 'Derivation Option', 'Display Derivation Expression', 'Rule Explanation', 'Effective Start Date', 'Status', 'Data Type'];

/** Resolution statuses that count as a confirmed TRAQ column (an exact same-name TRAQ column is kept but noted). */
const CONFIRMED = new Set<ColumnResolution['status']>(['approved', 'documented', 'name-match']);

const REF_RE = /"([^"]*)"(?:\.("[^"]*"))?(?:\.("[^"]*"))?/g;

interface Found { crismacTable: string; crismacColumn: string }

/** Two-part "Table"."Column" references in order; literals and three-part link/variable references are skipped. */
export function findReferences(expression: string): Found[] {
  const out: Found[] = [];
  for (const m of expression.matchAll(REF_RE)) {
    if (m[2] && !m[3]) out.push({ crismacTable: m[1], crismacColumn: m[2].slice(1, -1) });
  }
  return out;
}

function reasonFor(r: ColumnResolution): string {
  switch (r.status) {
    case 'missing': return 'no mapping in Agent 4 or the workbook, and no TRAQ column with this name';
    case 'suggested': return `only a Simulated suggestion exists (${r.chosen?.table}.${r.chosen?.column}, ${r.chosen?.confidence ?? '?'}% confidence); it is not a confirmed mapping`;
    case 'ambiguous': return `more than one possible TRAQ column (${r.candidates.map((c) => `${c.table}.${c.column}`).slice(0, 4).join(', ')})`;
    default: return r.note;
  }
}

function unmappedOf(r: ColumnResolution, role: DdUnmappedRef['role']): DdUnmappedRef {
  return {
    role, crismac: `${r.crismacTable}.${r.crismacColumn}`, status: r.status, reason: reasonFor(r),
    suggestion: r.status === 'suggested' && r.chosen ? `${r.chosen.table}.${r.chosen.column} (Simulated, not applied)` : '',
  };
}

export function migrateDdRows(
  model: WorkbookModel, procedure: string, header: string[], rows: string[][], reviewed: ReviewedMapping[], index?: MappingIndex,
): DdMigratedRule[] {
  const idx = index ?? buildMappingIndex(model, reviewed);
  const at = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const iEntity = at('Entity Name'); const iCol = at('Column Name'); const iExpr = at('Display Derivation Expression');
  if (iEntity < 0 || iCol < 0 || iExpr < 0) return [];
  const out: DdMigratedRule[] = [];
  rows.forEach((row, n) => {
    if (row.every((c) => !c.trim())) return;
    const original = header.map((_, i) => row[i] ?? '');
    const entity = original[iEntity].trim();
    const column = original[iCol].trim();
    const expression = original[iExpr];
    const target = resolveColumn(model, idx, entity, column);
    const unmapped: DdUnmappedRef[] = [];
    const notes: string[] = [];
    if (!CONFIRMED.has(target.status) || !target.chosen) unmapped.push(unmappedOf(target, 'rule column'));
    else if (target.status === 'name-match') notes.push(`${entity}.${column} -> ${target.chosen.table}.${target.chosen.column} is an exact same-name TRAQ column, not a documented mapping`);

    const resolved = new Map<string, ColumnResolution>();
    const refs: Found[] = findReferences(expression);
    for (const f of refs) {
      const k = `${f.crismacTable}.${f.crismacColumn}`.toUpperCase();
      if (resolved.has(k)) continue;
      const res = resolveColumn(model, idx, f.crismacTable, f.crismacColumn, target.chosen?.table);
      resolved.set(k, res);
      if (!CONFIRMED.has(res.status) || !res.chosen) unmapped.push(unmappedOf(res, 'reads'));
      else {
        if (res.status === 'name-match') notes.push(`${k} -> ${res.chosen.table}.${res.chosen.column} is an exact same-name TRAQ column, not a documented mapping`);
        if (target.chosen && res.chosen.table !== target.chosen.table) notes.push(`${res.chosen.table}.${res.chosen.column} is on another table than ${target.chosen.table}; confirm the TRAQ link`);
      }
    }
    if (/@[A-Za-z_]+/.test(expression)) notes.push('Run parameters (@TIMEKEY, @ProcessDate) are kept exactly as written');

    const ready = unmapped.length === 0 && !!target.chosen;
    const traqRow = [...original];
    if (ready && target.chosen) {
      traqRow[iEntity] = target.chosen.table;
      traqRow[iCol] = target.chosen.column;
      traqRow[iExpr] = expression.replace(REF_RE, (whole, a: string, b?: string, c?: string) => {
        if (!b || c) return whole;
        const res = resolved.get(`${a}.${b.slice(1, -1)}`.toUpperCase());
        return res?.chosen ? `"${res.chosen.table}"."${res.chosen.column}"` : whole;
      });
    }
    out.push({
      id: `${procedure}::${n + 2}`, procedure, rowNo: n + 2, original, traqRow, status: ready ? 'ready' : 'needs-mapping',
      entity: ready ? traqRow[iEntity] : '', column: ready ? traqRow[iCol] : '', unmapped, notes: Array.from(new Set(notes)),
    });
  });
  return out;
}

const uniq = (xs: string[]) => Array.from(new Set(xs));

/** Ready rules in exactly the dd_export layout (no extra columns, no placeholders). */
export function readyDoc(rules: DdMigratedRule[], generatedAt: string): ExportDoc {
  const ready = rules.filter((r) => r.status === 'ready');
  return {
    title: 'Corrected CrisMac rules mapped to TRAQ names', subtitle: `${ready.length} rule(s) - dd_export layout`, generatedAt,
    source: 'dd_export.csv rules with names replaced by confirmed TRAQ columns; logic, explanation, dates, status and data type unchanged',
    sheets: [{ name: 'dd_export', columns: DD_HEADER, rows: ready.map((r) => r.traqRow) }],
  };
}

/** Rules that could not be mapped yet: the original row verbatim, plus what is missing. Kept apart from the ready file. */
export function needsMappingDoc(rules: DdMigratedRule[], generatedAt: string): ExportDoc {
  const pending = rules.filter((r) => r.status === 'needs-mapping');
  return {
    title: 'Corrected CrisMac rules awaiting a TRAQ mapping', subtitle: `${pending.length} rule(s) - original text unchanged`, generatedAt,
    source: 'dd_export.csv rules with at least one column that has no confirmed TRAQ mapping. Not part of the ready file.',
    sheets: [{
      name: 'needs_mapping',
      columns: ['Procedure', ...DD_HEADER, 'Columns to map', 'Why', 'Suggestion (Simulated, not applied)'],
      rows: pending.map((r) => [
        r.procedure, ...r.original,
        uniq(r.unmapped.map((u) => u.crismac)).join(', '), uniq(r.unmapped.map((u) => `${u.crismac}: ${u.reason}`)).join(' | '),
        uniq(r.unmapped.map((u) => (u.suggestion ? `${u.crismac} -> ${u.suggestion}` : ''))).filter(Boolean).join(' | '),
      ]),
    }],
  };
}
