import type { ColumnResolution, ConversionStatus, ConvertedRule, MappingStatus, ProcSource, RuleEdit } from '@/types';

/** Selectors for the rule-migration screens (filtering and roll-ups), kept out of the components. */

export type DecisionFilter = 'all' | 'pending' | 'approved' | 'rejected';
export interface RuleFilter {
  status: ConversionStatus | 'all';
  decision: DecisionFilter;
  procedure: string;
  withTarget: boolean;
  query: string;
}

export const decisionOf = (r: ConvertedRule, edits: Record<string, RuleEdit>) => edits[r.id]?.decision ?? 'pending';

export function filterRules(rules: ConvertedRule[], edits: Record<string, RuleEdit>, f: RuleFilter): ConvertedRule[] {
  const q = f.query.trim().toLowerCase();
  return rules.filter((r) => (f.status === 'all' || r.status === f.status)
    && (f.decision === 'all' || decisionOf(r, edits) === f.decision)
    && (!f.procedure || r.procedure === f.procedure)
    && (!f.withTarget || !!r.target.chosen)
    && (!q || `${r.crismacTable}.${r.crismacColumn} ${r.traq.entity}.${r.traq.column} ${r.procedure}`.toLowerCase().includes(q)));
}

export interface MappingRow {
  key: string;
  resolution: ColumnResolution;
  writtenBy: number;
  readBy: number;
  rules: string[];
}

const STATUS_ORDER: Record<MappingStatus, number> = { missing: 0, ambiguous: 1, 'name-match': 2, documented: 3, approved: 4 };

/** Every distinct CrisMac column the rules write or read, with its TRAQ resolution and how many rules depend on it. */
export function mappingRows(rules: ConvertedRule[]): MappingRow[] {
  const rows = new Map<string, MappingRow>();
  const add = (res: ColumnResolution, ruleId: string, role: 'w' | 'r') => {
    const key = `${res.crismacTable}.${res.crismacColumn}`;
    const row = rows.get(key) ?? { key, resolution: res, writtenBy: 0, readBy: 0, rules: [] };
    if (role === 'w') row.writtenBy++; else row.readBy++;
    if (!row.rules.includes(ruleId)) row.rules.push(ruleId);
    // keep the most specific resolution (one made with a preferred table) if they differ
    if (STATUS_ORDER[res.status] > STATUS_ORDER[row.resolution.status]) row.resolution = res;
    rows.set(key, row);
  };
  for (const r of rules) {
    add(r.target, r.id, 'w');
    r.references.forEach((x) => add(x, r.id, 'r'));
  }
  return Array.from(rows.values()).sort((a, b) => STATUS_ORDER[a.resolution.status] - STATUS_ORDER[b.resolution.status] || (b.writtenBy + b.readBy) - (a.writtenBy + a.readBy));
}

export function decisionCounts(rules: ConvertedRule[], edits: Record<string, RuleEdit>) {
  const c = { approved: 0, rejected: 0, pending: 0, edited: 0 };
  for (const r of rules) {
    c[decisionOf(r, edits)]++;
    if (edits[r.id]?.traq) c.edited++;
  }
  return c;
}

export interface ProcedureSummary {
  name: string;
  stage: string;
  statements: Record<string, number>;
  joins: number;
  wheres: number;
  cases: number;
  guarded: number;
  tablesRead: string[];
  tablesWritten: string[];
  calls: string[];
  params: string[];
}

export function summarizeProcedure(p: ProcSource): ProcedureSummary {
  const statements: Record<string, number> = {};
  let joins = 0; let wheres = 0; let cases = 0; let guarded = 0;
  for (const s of p.steps) {
    if (s.housekeeping) continue;
    statements[s.type] = (statements[s.type] ?? 0) + 1;
    joins += s.joins?.length ?? 0;
    if (s.where) wheres++;
    if (s.guard) guarded++;
    cases += s.columns.filter((c) => /\bCASE\b/i.test(c.expressionFull ?? c.expression)).length;
  }
  return {
    name: p.name, stage: p.stage, statements, joins, wheres, cases, guarded,
    tablesRead: p.tablesRead, tablesWritten: p.tablesWritten.map((t) => t.table), calls: p.calls, params: p.params.map((x) => x.name),
  };
}
