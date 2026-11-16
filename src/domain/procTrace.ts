import type { BusinessRule, ProcSource, ProcTrace, TraqColumnLink, ValidationResult, WorkbookModel } from '@/types';
import { memo } from './memo';

/*
 * Traceability between source-procedure SQL and the TRAQ data model. Links are made ONLY from facts present in the
 * inputs: (1) a column the SQL writes whose name equals a TRAQ column (case and underscores ignored), and (2) rows of the
 * workbook's FPM_DA_RULES that name the procedure or a column the procedure writes. Nothing is inferred beyond that,
 * and no TRAQ SQL is generated.
 */

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const MIN_KEY = 5; // ignore very short names (ID, FLAG...) that would match unrelated columns by accident
const MAX_TARGETS = 3;

function traqColumnIndex(model: WorkbookModel): Map<string, { table: string; column: string }[]> {
  return memo(model, 'traqColumnIndex', () => {
    const idx = new Map<string, { table: string; column: string }[]>();
    for (const t of model.tables) {
      if (t.system !== 'TRAQ') continue;
      for (const c of t.columns) {
        const k = key(c.name);
        if (k.length < MIN_KEY) continue;
        idx.set(k, [...(idx.get(k) ?? []), { table: t.name, column: c.name }]);
      }
    }
    return idx;
  });
}

export function traceProcedure(model: WorkbookModel, proc: ProcSource): ProcTrace {
  const idx = traqColumnIndex(model);
  const links = new Map<string, TraqColumnLink>();
  const writtenKeys = new Set<string>();
  let writtenColumns = 0;
  for (const s of proc.steps) {
    if (s.housekeeping || s.tableKind === 'local-temp') continue;
    for (const c of s.columns) {
      writtenColumns++;
      const k = key(c.name);
      writtenKeys.add(k);
      for (const t of (idx.get(k) ?? []).slice(0, MAX_TARGETS)) {
        const id = `${s.table}.${c.name}=>${t.table}.${t.column}`;
        const l = links.get(id) ?? { procTable: s.table, procColumn: c.name, traqTable: t.table, traqColumn: t.column, stepIds: [] };
        if (!l.stepIds.includes(s.id)) l.stepIds.push(s.id);
        links.set(id, l);
      }
    }
  }
  const needle = proc.name.toLowerCase();
  const daRules = model.daRules.filter((d) => (needle.length >= 6 && `${d.crismac} ${d.reads} ${d.logic} ${d.expression}`.toLowerCase().includes(needle))
    || (key(d.column).length >= MIN_KEY && writtenKeys.has(key(d.column))));
  const known = new Set(model.tables.map((t) => t.name.toUpperCase()));
  const traceable = links.size > 0 || daRules.length > 0;
  return {
    proc: proc.name,
    writtenColumns,
    links: Array.from(links.values()),
    daRules,
    readTables: proc.tablesRead.map((name) => ({ name, inWorkbook: known.has(name) })),
    status: traceable ? 'traceable' : 'untraced',
    note: traceable
      ? 'Links are name matches against TRAQ columns and FPM_DA_RULES rows; they show where to look, not that the logic is equivalent.'
      : 'No written column name or FPM_DA_RULES row ties this procedure to a TRAQ column in the workbook. Its outputs may belong to tables outside the migration scope (for example NPA/SMA), or the TRAQ side is not documented.',
  };
}

export function traceAll(model: WorkbookModel, procs: ProcSource[]): ProcTrace[] {
  return procs.map((p) => traceProcedure(model, p));
}

/** Agent 5 rules taken from procedure steps that assign a column with a TRAQ counterpart. */
export function procedureRules(procs: ProcSource[], traces: ProcTrace[]): BusinessRule[] {
  const byName = new Map(procs.map((p) => [p.name, p]));
  const rules: BusinessRule[] = [];
  for (const t of traces) {
    const p = byName.get(t.proc);
    if (!p) continue;
    for (const l of t.links) {
      for (const sid of l.stepIds.slice(0, 3)) {
        const s = p.steps.find((x) => x.id === sid);
        const c = s?.columns.find((x) => x.name === l.procColumn);
        if (!s || !c) continue;
        rules.push({
          id: `proc:${s.id}:${l.procColumn}:${l.traqTable}.${l.traqColumn}`, kind: 'derivation', table: l.traqTable, column: l.traqColumn,
          text: `${p.name} step ${s.index} (${s.type}, lines ${s.lineStart}-${s.lineEnd}) sets ${s.table}.${c.name}${c.expression ? ` = ${c.expression}` : ''}${s.guard ? `. Applies when: ${s.guard}` : ''}`,
          sheet: `SQL ${p.file}`, rowNo: s.lineStart, origin: 'derived',
        });
      }
    }
  }
  return rules;
}

/** Validation check C8: every procedure should be traceable to the TRAQ model. */
export function traceValidation(procs: ProcSource[], traces: ProcTrace[]): ValidationResult[] {
  return traces.map((t) => {
    const p = procs.find((x) => x.name === t.proc);
    const ok = t.status === 'traceable';
    return {
      id: `C8:${t.proc}`, checkId: 'C8', check: 'Procedure logic is traceable to a TRAQ column', table: t.proc,
      severity: ok ? 'pass' : 'warn',
      message: ok
        ? `${t.links.length} written column(s) match TRAQ columns; ${t.daRules.length} FPM_DA_RULES row(s) relate to it`
        : 'No TRAQ column or FPM_DA_RULES row ties this procedure to the TRAQ model',
      checked: t.writtenColumns, flagged: ok ? 0 : t.writtenColumns,
      items: ok ? [] : (p?.tablesWritten ?? []).map((w) => `writes ${w.table} (${w.columns.length} column(s))`).slice(0, 50),
    };
  });
}
