import type { ProcSource, WorkbookModel } from '@/types';
import type { MappingDecisionRecord } from '@/types/decisions';

/*
 * Few-shot context for Agent 4's transformation suggestions: how THIS bank already expresses conversions, quoted verbatim
 * from the workbook's REMARK column, FPM_DA_RULES and the sample procedure SQL, plus earlier human decisions. Nothing is
 * rewritten or invented here; the lines are evidence for the model to imitate, not rules to apply.
 */

const LIMITS = { remarks: 4, rules: 3, procs: 3, approved: 4, rejected: 6 };
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}...` : t; };
const PLAIN = new Set(['DIRECT', 'RENAME', '']);
const isPlainColumn = (e: string) => /^\[?[A-Za-z_][\w.]*\]?$/.test(e.trim());

export interface TransformExamples { examples: string[]; decisionNotes: string[] }

export function transformationExamples(model: WorkbookModel, table: string, procs: ProcSource[] | undefined, decisions: MappingDecisionRecord[] | undefined): TransformExamples {
  const t = model.tables.find((x) => x.name === table);
  const mine = new Set((t?.columns ?? []).map((c) => c.name.toUpperCase()));
  const examples: string[] = [];

  // 1. Workbook REMARK text on non-direct mappings: this table first, then others.
  const remarks = model.mappings.filter((m) => m.remark.trim() && !PLAIN.has(m.mapType.toUpperCase()) && m.sourceColumns.length > 0 && m.targetColumn);
  const seenRemark = new Set<string>();
  for (const m of [...remarks.filter((r) => r.targetTable === table), ...remarks.filter((r) => r.targetTable !== table)]) {
    const key = m.remark.trim().toLowerCase();
    if (seenRemark.has(key)) continue;
    seenRemark.add(key);
    examples.push(`Workbook ${m.sheet} row ${m.rowNo} (${m.mapType || 'no map type'}): ${m.sourceTable}.${m.sourceColumns.join('+')} -> ${m.targetTable}.${m.targetColumn}: "${clip(m.remark, 220)}"`);
    if (seenRemark.size >= LIMITS.remarks) break;
  }

  // 2. FPM_DA_RULES expressions (this table's columns first).
  const rules = model.daRules.filter((d) => d.expression.trim());
  let nRules = 0;
  for (const d of [...rules.filter((r) => mine.has(r.column.toUpperCase())), ...rules.filter((r) => !mine.has(r.column.toUpperCase()))]) {
    examples.push(`FPM_DA_RULES row ${d.rowNo}: ${d.column}${d.logic ? ` (${clip(d.logic, 80)})` : ''}: ${clip(d.expression, 220)}`);
    if (++nRules >= LIMITS.rules) break;
  }

  // 3. Sample procedure SQL: computed (non-plain) column expressions written to this table's columns, then any table.
  let nProcs = 0;
  const written: { line: string; mine: boolean }[] = [];
  for (const p of procs ?? []) {
    for (const s of p.steps) {
      if (s.housekeeping) continue;
      for (const c of s.columns) {
        const e = (c.expressionFull ?? c.expression).trim();
        if (!e || isPlainColumn(e) || e.length > 400) continue;
        written.push({ line: `Procedure ${p.file} line ${s.lineStart}: ${s.table}.${c.name} = ${clip(e, 220)}`, mine: s.table.toUpperCase() === table.toUpperCase() });
      }
    }
  }
  for (const w of [...written.filter((x) => x.mine), ...written.filter((x) => !x.mine)]) {
    examples.push(w.line);
    if (++nProcs >= LIMITS.procs) break;
  }

  // 4. Human decisions: approved ones are examples (with their transformation), rejected ones are things not to repeat.
  const ds = decisions ?? [];
  const approved = ds.filter((d) => d.decision === 'approved').sort((a, b) => (b.targetTable === table ? 1 : 0) - (a.targetTable === table ? 1 : 0)).slice(0, LIMITS.approved);
  for (const d of approved) {
    examples.push(`Human-approved: ${d.sourceTable}.${d.sourceColumn} -> ${d.targetTable}.${d.targetColumn}${d.transformation ? ` using ${clip(d.transformation, 200)}` : ''}`);
  }
  const decisionNotes = ds.filter((d) => d.decision === 'rejected' && d.targetTable === table).slice(0, LIMITS.rejected)
    .map((d) => `A reviewer REJECTED ${d.sourceTable}.${d.sourceColumn} -> ${d.targetTable}.${d.targetColumn}${d.comment ? ` ("${clip(d.comment, 100)}")` : ''}; do not propose it again.`);
  return { examples, decisionNotes };
}
