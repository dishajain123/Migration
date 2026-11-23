import type { ColumnResolution, ConvertedRule, MappingStatus, RuleEdit } from '@/types';
import type { ExportDoc } from '../exporters';

/*
 * Rules that cannot reach TRAQ because a CrisMac column they write or read has no confirmed TRAQ column. Kept apart from the
 * approval and export logic on purpose: this is a read-only view of the gaps (what is missing, which rules it blocks), never a
 * place where a mapping is guessed. A gap is a column whose resolution is 'missing' (no TRAQ column at all), 'suggested' (only
 * Agent 4's Simulated heuristic found one) or 'ambiguous' (several documented candidates).
 */

export type GapKind = 'missing' | 'suggested' | 'ambiguous';
const GAP_STATUS: Partial<Record<MappingStatus, GapKind>> = { missing: 'missing', suggested: 'suggested', ambiguous: 'ambiguous' };

export interface GapRuleRef {
  ruleId: string;
  procedure: string;
  /** CrisMac table.column the rule writes. */
  label: string;
  role: 'writes' | 'reads';
  decision: 'approved' | 'rejected' | 'pending';
  /** How many OTHER missing columns the same rule has. */
  otherGaps: number;
}

export interface ColumnGap {
  key: string;
  crismacTable: string;
  crismacColumn: string;
  kind: GapKind;
  /** Agent 4's Simulated suggestion for it, if any ("TABLE.COLUMN (n%)"); never applied. */
  suggestion: string;
  note: string;
  rules: GapRuleRef[];
  writtenBy: number;
  readBy: number;
  /** Rules for which this is the ONLY missing column (mapping it would unblock them). */
  unblocks: number;
}

export interface RuleGap {
  rule: ConvertedRule;
  decision: 'approved' | 'rejected' | 'pending';
  gaps: { key: string; kind: GapKind; role: 'writes' | 'reads' }[];
}

export interface GapReport {
  columns: ColumnGap[];
  rules: RuleGap[];
  stats: { totalRules: number; rulesWithGap: number; columns: number; missing: number; suggested: number; ambiguous: number; writeGaps: number };
}

const SEVERITY: Record<GapKind, number> = { missing: 0, suggested: 1, ambiguous: 2 };

export function findGaps(rules: ConvertedRule[], edits: Record<string, RuleEdit>): GapReport {
  const columns = new Map<string, ColumnGap>();
  const ruleGaps: RuleGap[] = [];
  const consider = (r: ConvertedRule, res: ColumnResolution, role: 'writes' | 'reads', into: RuleGap) => {
    const kind = GAP_STATUS[res.status];
    if (!kind) return;
    const key = `${res.crismacTable}.${res.crismacColumn}`;
    if (into.gaps.some((g) => g.key === key)) return;
    into.gaps.push({ key, kind, role });
    const c = columns.get(key) ?? {
      key, crismacTable: res.crismacTable, crismacColumn: res.crismacColumn, kind, note: res.note, rules: [], writtenBy: 0, readBy: 0, unblocks: 0,
      suggestion: res.status === 'suggested' && res.chosen ? `${res.chosen.table}.${res.chosen.column} (${res.chosen.confidence ?? '?'}%, Simulated)` : '',
    };
    if (role === 'writes') c.writtenBy++; else c.readBy++;
    if (SEVERITY[kind] < SEVERITY[c.kind]) c.kind = kind;
    columns.set(key, c);
  };
  for (const r of rules) {
    const entry: RuleGap = { rule: r, decision: edits[r.id]?.decision ?? 'pending', gaps: [] };
    consider(r, r.target, 'writes', entry);
    for (const x of r.references) consider(r, x, 'reads', entry);
    if (entry.gaps.length === 0) continue;
    ruleGaps.push(entry);
    for (const g of entry.gaps) {
      const c = columns.get(g.key);
      if (!c) continue;
      c.rules.push({ ruleId: r.id, procedure: r.procedure, label: `${r.crismacTable}.${r.crismacColumn}`, role: g.role, decision: entry.decision, otherGaps: entry.gaps.length - 1 });
      if (entry.gaps.length === 1) c.unblocks++;
    }
  }
  const list = Array.from(columns.values()).sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind] || b.rules.length - a.rules.length || a.key.localeCompare(b.key));
  return {
    columns: list,
    rules: ruleGaps,
    stats: {
      totalRules: rules.length, rulesWithGap: ruleGaps.length, columns: list.length,
      missing: list.filter((c) => c.kind === 'missing').length, suggested: list.filter((c) => c.kind === 'suggested').length, ambiguous: list.filter((c) => c.kind === 'ambiguous').length,
      writeGaps: list.filter((c) => c.writtenBy > 0).length,
    },
  };
}

export const GAP_LABEL: Record<GapKind, string> = { missing: 'No TRAQ column', suggested: 'Simulated suggestion only', ambiguous: 'Ambiguous' };

/** Excel/CSV/PDF/JSON of the gap report: the missing columns, then every affected rule with its logic and the unresolved expression. */
export function gapsDoc(report: GapReport, generatedAt: string): ExportDoc {
  const byKey = new Map(report.columns.map((c) => [c.key, c]));
  return {
    title: 'CrisMac columns missing in TRAQ, and the rules they block',
    subtitle: `${report.stats.columns} column(s) block ${report.stats.rulesWithGap} of ${report.stats.totalRules} rule(s)`,
    generatedAt,
    source: 'Rule conversion of the uploaded CrisMac SQL; columns with no confirmed TRAQ mapping in Agent 4 or the workbook. Nothing here is a mapping.',
    sheets: [
      {
        name: 'Missing columns',
        columns: ['CrisMac table', 'CrisMac column', 'Gap', 'Simulated suggestion (not applied)', 'Rules blocked', 'Rules that write it', 'Rules that read it', 'Rules unblocked if mapped', 'Rules'],
        rows: report.columns.map((c) => [c.crismacTable, c.crismacColumn, GAP_LABEL[c.kind], c.suggestion, c.rules.length, c.writtenBy, c.readBy, c.unblocks, c.rules.map((r) => r.label).join(', ')]),
      },
      {
        name: 'Affected rules',
        columns: ['Procedure', 'Rule (CrisMac column written)', 'Missing column', 'Role', 'Gap', 'Other missing columns in this rule', 'Review', 'Original CrisMac logic', 'TRAQ expression (unresolved parts shown)', 'Source lines'],
        rows: report.rules.flatMap((rg) => rg.gaps.map((g) => [
          rg.rule.procedure, `${rg.rule.crismacTable}.${rg.rule.crismacColumn}`, g.key, g.role, GAP_LABEL[byKey.get(g.key)?.kind ?? g.kind], rg.gaps.length - 1, rg.decision,
          rg.rule.crismacLogic, rg.rule.traq.expression, rg.rule.traq.crismac,
        ])),
      },
    ],
  };
}
