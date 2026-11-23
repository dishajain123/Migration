import type { ConvertedRule, ExportCheck, RuleEdit, RuleTemplate, TraqRuleFields } from '@/types';
import type { ExportDoc } from '../exporters';
import { exportBlockers } from './approval';

/*
 * TRAQ rule file layouts. Both are copied from real project files, not invented:
 *  - dd-export: the header row of every public/data/latest dd output/<proc>/dd_export.csv (TRAQ data-dictionary
 *    derivation export). Allowed values are the ones those 14 files use.
 *  - fpm-da-rules: row 4 of the workbook sheet FPM_DA_RULES (the Derived Attribute rules as the TRAQ app shows them).
 * "Mandatory" means filled in every sample row; the workbook does not state TRAQ's own required-field rules.
 */

export const TEMPLATES: RuleTemplate[] = [
  {
    id: 'dd-export',
    name: 'TRAQ data-dictionary derivation (dd_export)',
    provenance: 'Header of the 14 dd_export.csv files in public/data/latest dd output (TRAQ derivation export, one row per derived column).',
    provisional: false,
    dateFormat: 'dd-mm-yyyy',
    mandatoryBasis: 'Mandatory = filled in every row of the 14 dd_export samples. Allowed values = the values those samples use.',
    columns: [
      { header: 'Entity Name', field: 'entity', mandatory: true, hint: 'TRAQ table the rule writes (from the Agent 4 mapping of the CrisMac target column).' },
      { header: 'Column Name', field: 'column', mandatory: true, hint: 'TRAQ column the rule derives.' },
      { header: 'Column Type', field: 'columnType', mandatory: true, allowed: ['Physical', 'Temporary'], hint: 'Physical = a real column of the table; Temporary = a rule variable (var.X).' },
      { header: 'Derivation Option', field: 'derivationOption', mandatory: true, allowed: ['Formula Expression', 'Decision Table'], hint: 'Only Formula Expression is generated; decision tables are entered in TRAQ.' },
      { header: 'Display Derivation Expression', field: 'expression', mandatory: true, hint: 'The rule in TRAQ syntax, reading TRAQ columns only.' },
      { header: 'Rule Explanation', field: 'explanation', mandatory: true, hint: 'Plain-language description of the business logic.' },
      { header: 'Effective Start Date', field: 'effectiveStartDate', mandatory: true, hint: 'dd-mm-yyyy, as in the samples.' },
      { header: 'Status', field: 'status', mandatory: true, allowed: ['PENDING_REVIEW'], hint: 'All sample rows are PENDING_REVIEW: TRAQ reviews imported rules itself.' },
      { header: 'Data Type', field: 'dataType', mandatory: true, allowed: ['Date', 'Integer', 'String', 'Decimal'], hint: 'From the TRAQ column type: DATE -> Date, NUMBER(p,s>0) -> Decimal, other NUMBER -> Integer, text -> String.' },
    ],
  },
  {
    id: 'fpm-da-rules',
    name: 'FPM_DA_RULES (workbook Derived Attribute rules)',
    provenance: 'Workbook sheet FPM_DA_RULES, header row 4 (rules on FCT_PRODUCT_MASTER as the TRAQ app shows them).',
    provisional: false,
    dateFormat: 'dd-Mon-yyyy',
    mandatoryBasis: 'Mandatory = filled for every Formula Expression rule in FPM_DA_RULES. RUN and VERSION are assigned by the TRAQ app.',
    columns: [
      { header: 'RUN', field: 'run', mandatory: false, hint: "The app's PRIORITY, assigned by TRAQ when the rule is saved." },
      { header: 'TRAQ COLUMN', field: 'column', mandatory: true, hint: 'Column on FCT_PRODUCT_MASTER (this sheet covers that table only).' },
      { header: 'KIND', field: 'columnType', mandatory: true, allowed: ['Physical', 'Temporary'], hint: 'Physical column or Temporary rule variable.' },
      { header: 'DATATYPE', field: 'dataType', mandatory: true, allowed: ['String', 'Date', 'Integer', 'Decimal'], hint: 'String, Date and Integer appear in the sheet; Decimal comes from dd_export.' },
      { header: 'RULE', field: 'derivationOption', mandatory: true, allowed: ['Formula Expression', 'Decision Table'], hint: 'Formula Expression or Decision Table.' },
      { header: 'IN FORCE FROM', field: 'effectiveStartDate', mandatory: true, hint: 'dd-Mon-yyyy, as in the sheet (e.g. 01-Apr-2026).' },
      { header: 'CRISMAC', field: 'crismac', mandatory: true, hint: 'The CrisMac source, as "procedure first-last line".' },
      { header: 'READS', field: 'reads', mandatory: false, hint: 'TRAQ columns the expression reads.' },
      { header: 'LOGIC', field: 'explanation', mandatory: true, hint: 'Plain-language description.' },
      { header: 'EXPRESSION AS SAVED IN THE APP', field: 'expression', mandatory: true, hint: 'The rule in TRAQ syntax.' },
      { header: 'VERSION IN THE APP, SAVED ON', field: 'version', mandatory: false, hint: 'Assigned by TRAQ on save; empty for new rules.' },
    ],
  },
];

export const templateById = (id: RuleTemplate['id']): RuleTemplate => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string, fmt: RuleTemplate['dateFormat']): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return fmt === 'dd-mm-yyyy' ? `${m[3]}-${m[2]}-${m[1]}` : `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
}

/** The rule's fields with the reviewer's edits applied and the batch date filled in when the rule has none. */
export function effectiveFields(rule: ConvertedRule, edit: RuleEdit | undefined, batchDate: string): TraqRuleFields {
  const f = { ...rule.traq, ...(edit?.traq ?? {}) };
  if (!f.effectiveStartDate) f.effectiveStartDate = batchDate;
  return f;
}

export function templateRow(t: RuleTemplate, f: TraqRuleFields): string[] {
  return t.columns.map((c) => {
    if (c.field === 'run' || c.field === 'version') return '';
    if (c.field === 'reads') return f.reads.join(', ');
    if (c.field === 'effectiveStartDate') return formatDate(f.effectiveStartDate, t.dateFormat);
    return String(f[c.field] ?? '');
  });
}

/** validated = approved AND every column confirmed (Agent 4 or documented) AND no placeholders: the only scope that is "Ready for TRAQ". */
export type ExportScope = 'validated' | 'approved' | 'approved-and-pending';

export function rulesInScope(rules: ConvertedRule[], edits: Record<string, RuleEdit>, scope: ExportScope): ConvertedRule[] {
  return rules.filter((r) => {
    const d = edits[r.id]?.decision;
    if (d === 'rejected') return false;
    if (scope === 'validated') return exportBlockers(r, edits[r.id]).length === 0;
    return scope === 'approved' ? d === 'approved' : r.status !== 'failed' || d === 'approved';
  });
}

export interface ReadinessSplit {
  ready: ConvertedRule[];
  /** Everything else, with the reasons it is not Ready (rejected rules included, marked as such). */
  pending: { rule: ConvertedRule; reasons: string[] }[];
}

/** Ready rules and the rest, using the same checks as the 'validated' scope. */
export function splitByReadiness(rules: ConvertedRule[], edits: Record<string, RuleEdit>): ReadinessSplit {
  const out: ReadinessSplit = { ready: [], pending: [] };
  for (const r of rules) {
    const reasons = exportBlockers(r, edits[r.id]);
    if (reasons.length === 0) out.ready.push(r); else out.pending.push({ rule: r, reasons });
  }
  return out;
}

/** Checks run before a TRAQ file may be generated. Any error blocks the download. */
export function validateForExport(
  t: RuleTemplate, rules: ConvertedRule[], edits: Record<string, RuleEdit>, batchDate: string,
): ExportCheck[] {
  const out: ExportCheck[] = [];
  const seen = new Map<string, string>();
  for (const r of rules) {
    const f = effectiveFields(r, edits[r.id], batchDate);
    const row = templateRow(t, f);
    t.columns.forEach((c, i) => {
      const v = row[i].trim();
      if (c.mandatory && !v) out.push({ ruleId: r.id, field: c.header, severity: 'error', message: `${c.header} is empty.` });
      else if (v && c.allowed && !c.allowed.includes(v)) out.push({ ruleId: r.id, field: c.header, severity: 'error', message: `${c.header} "${v}" is not one of ${c.allowed.join(', ')}.` });
    });
    if (/\[\[(UNMAPPED|PARAM|UNSUPPORTED)/.test(f.expression)) {
      out.push({ ruleId: r.id, field: 'expression', severity: 'error', message: 'The expression still contains [[...]] placeholders (unmapped columns, parameters or unsupported SQL).' });
    }
    if (r.target.status === 'suggested' || r.references.some((x) => x.status === 'suggested')) {
      out.push({ ruleId: r.id, field: 'expression', severity: 'error', message: "The expression reads or writes a column resolved only by Agent 4's Simulated suggestion heuristic, not a confirmed mapping. Map it in Agent 4 (the suggested table/column is pre-filled) before this rule can export." });
    }
    if (r.status === 'failed' && !edits[r.id]?.traq?.expression) {
      out.push({ ruleId: r.id, field: 'status', severity: 'error', message: 'Conversion failed and the rule was not corrected by hand.' });
    }
    if (t.id === 'fpm-da-rules' && f.entity && f.entity !== 'FCT_PRODUCT_MASTER') {
      out.push({ ruleId: r.id, field: 'TRAQ COLUMN', severity: 'warning', message: `FPM_DA_RULES lists FCT_PRODUCT_MASTER rules only; this rule writes ${f.entity}. Use the dd_export template for other tables.` });
    }
    const key = `${f.entity}.${f.column}`;
    const prev = seen.get(key);
    if (prev) out.push({ ruleId: r.id, field: 'Column Name', severity: 'error', message: `${key} is also derived by ${prev}. TRAQ keeps one derivation per column: reject one or merge them.` });
    else seen.set(key, r.procedure);
  }
  return out;
}

/** The TRAQ rule file (exact template headers), for CSV/Excel generation through domain/exporters. */
export function traqRuleDoc(t: RuleTemplate, rules: ConvertedRule[], edits: Record<string, RuleEdit>, batchDate: string, generatedAt: string): ExportDoc {
  return {
    title: 'TRAQ business rules converted from CrisMac',
    subtitle: `${t.name} - ${rules.length} rule(s)`,
    generatedAt,
    source: 'Rule-based conversion of CrisMac SQL using Agent 4 mappings (no AI)',
    sheets: [{ name: t.id === 'dd-export' ? 'dd_export' : 'FPM_DA_RULES', columns: t.columns.map((c) => c.header), rows: rules.map((r) => templateRow(t, effectiveFields(r, edits[r.id], batchDate))) }],
  };
}

/** Full conversion report: statistics, every rule with its status, issues and mapping resolution. */
export function conversionReportDoc(rules: ConvertedRule[], edits: Record<string, RuleEdit>, batchDate: string, generatedAt: string): ExportDoc {
  const decision = (r: ConvertedRule) => edits[r.id]?.decision ?? 'pending';
  const count = (p: (r: ConvertedRule) => boolean) => rules.filter(p).length;
  const split = splitByReadiness(rules, edits);
  const readyIds = new Set(split.ready.map((r) => r.id));
  const reasonsOf = new Map(split.pending.map((p) => [p.rule.id, p.reasons]));
  const exportStatus = (r: ConvertedRule) => (readyIds.has(r.id) ? 'Ready for TRAQ' : decision(r) === 'rejected' ? 'Rejected' : 'Pending');
  // Ready rules first, then pending, so the two groups are separate blocks in the sheet.
  const ordered = [...split.ready, ...split.pending.map((p) => p.rule)];
  return {
    title: 'CrisMac to TRAQ rule conversion report',
    subtitle: `${rules.length} rule(s) from ${new Set(rules.map((r) => r.procedure)).size} procedure(s)`,
    generatedAt,
    source: 'Rule-based conversion (no AI); confidence is a heuristic (Simulated)',
    csvSheet: 1,
    sheets: [
      {
        name: 'Summary', columns: ['Measure', 'Value'], rows: [
          ['Rules', rules.length],
          ['Converted (no open issues)', count((r) => r.status === 'converted')],
          ['Needs review', count((r) => r.status === 'needs-review')],
          ['Failed', count((r) => r.status === 'failed')],
          ['Ready for TRAQ (approved, all columns confirmed)', split.ready.length],
          ['Not ready (pending, rejected or incomplete)', split.pending.length],
          ['Approved', count((r) => decision(r) === 'approved')],
          ['Rejected', count((r) => decision(r) === 'rejected')],
          ['Pending review', count((r) => decision(r) === 'pending')],
          ['Edited by hand', count((r) => !!edits[r.id]?.traq)],
        ],
      },
      {
        name: 'Rules',
        columns: ['Export status', 'Why not ready', 'Procedure', 'CrisMac table', 'CrisMac column', 'TRAQ table', 'TRAQ column', 'Mapping', 'Status', 'Review', 'Confidence (simulated)', 'TRAQ expression', 'Original CrisMac logic', 'Errors', 'Warnings', 'Source lines'],
        rows: ordered.map((r) => {
          const f = effectiveFields(r, edits[r.id], batchDate);
          return [
            exportStatus(r), (reasonsOf.get(r.id) ?? []).join(' | '),
            r.procedure, r.crismacTable, r.crismacColumn, f.entity, f.column, r.target.status, r.status, decision(r), r.confidence.value,
            f.expression, r.crismacLogic,
            r.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' | '),
            r.issues.filter((i) => i.severity === 'warning').map((i) => i.message).join(' | '),
            r.traq.crismac,
          ];
        }),
      },
      {
        name: 'Column mappings',
        columns: ['Rule', 'Role', 'CrisMac table', 'CrisMac column', 'TRAQ table', 'TRAQ column', 'Status', 'Basis', 'Note'],
        rows: ordered.flatMap((r) => [{ role: 'target', x: r.target }, ...r.references.map((x) => ({ role: 'reads', x }))].map(({ role, x }) => [
          r.id, role, x.crismacTable, x.crismacColumn, x.chosen?.table ?? '', x.chosen?.column ?? '', x.status, x.chosen?.basis ?? '', x.note,
        ])),
      },
    ],
  };
}
