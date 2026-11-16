import type { DocExpression, ProcKind, ProcObject, ProcReference, SqlAnalysis, WorkbookModel } from '@/types';
import { memo } from './memo';
import { tableByName } from './selectors';

/*
 * The workbook has NO SQL bodies. This module catalogues objects that are merely REFERENCED in banners/remarks,
 * and reports only what the surrounding text says. Operation detection is keyword matching on that text.
 */

interface Pattern { re: RegExp; kind: ProcKind | ((name: string) => ProcKind) }
const PATTERNS: Pattern[] = [
  { re: /\bE_TRAQ_[A-Za-z0-9_]+(?:<[a-z]+>)?/g, kind: 'view' },
  { re: /\bRECP\.PRC_[A-Za-z0-9_]+/g, kind: 'traq-procedure' },
  { re: /\bm_TRAQ_[A-Za-z0-9_]+/g, kind: 'di-mapping' },
  { re: /\bwf_TRAQ_[A-Za-z0-9_<>]+/g, kind: 'di-workflow' },
  { re: /\bPRO\.[A-Za-z_]+[A-Za-z0-9_]*/g, kind: (n) => (/(Processing|Updation|Insert|Marking|Appropriation)/i.test(n) ? 'crismac-procedure' : 'crismac-object') },
  { re: /\b(?:InsertDataforAssetClassficationRBL|Marking_FlgDeg_Degreason|SecurityAppropriation)\b/g, kind: 'crismac-procedure' },
];

const OPS: [RegExp, string][] = [
  [/delete (the )?period|delete from/i, 'DELETE'],
  [/\binsert/i, 'INSERT'],
  [/\bupdate/i, 'UPDATE'],
  [/\bmerge/i, 'MERGE'],
  [/\bunion/i, 'UNION'],
  [/\bjoin/i, 'JOIN'],
  [/\bread[s]? /i, 'READ'],
  [/\bwrite|\bwritten/i, 'WRITE'],
];
const TABLE_RE = /\b(?:STG|FCT|DIM|UPLOAD|RECP|ACCOUNT)_[A-Z0-9_]+\b/g;

function clipAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, idx + len + 160);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

export function buildCatalogue(model: WorkbookModel): ProcObject[] {
  return memo(model, 'procCatalogue', () => {
    const texts: { sheet: string; rowNo: number; text: string }[] = [];
    for (const s of model.sheets) if (s.inScope && s.banner) texts.push({ sheet: s.name, rowNo: 2, text: s.banner });
    for (const m of model.mappings) if (m.remark) texts.push({ sheet: m.sheet, rowNo: m.rowNo, text: m.remark });
    for (const d of model.daRules) texts.push({ sheet: 'FPM_DA_RULES', rowNo: d.rowNo, text: `${d.logic} ${d.crismac}` });
    for (const r of model.decisionRows) texts.push({ sheet: 'FPM_DA_RULES', rowNo: r.rowNo, text: `${r.meaning} ${r.crismac}` });

    const objects = new Map<string, ProcObject>();
    const coRefs = new Map<string, Set<string>>();
    for (const t of texts) {
      const found: string[] = [];
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = p.re.exec(t.text))) {
          const name = match[0].replace(/[.,;:]+$/, '');
          const kind = typeof p.kind === 'function' ? p.kind(name) : p.kind;
          found.push(name);
          let o = objects.get(name);
          if (!o) {
            o = { id: name, name, kind, references: [], sheets: [], operations: [], mentionedTables: [], related: [], sqlProvided: false };
            objects.set(name, o);
          }
          const dup = o.references.some((r) => r.sheet === t.sheet && r.rowNo === t.rowNo);
          if (!dup && o.references.length < 25) o.references.push({ sheet: t.sheet, rowNo: t.rowNo, snippet: clipAround(t.text, match.index, name.length) });
          if (!o.sheets.includes(t.sheet)) o.sheets.push(t.sheet);
          for (const [re, label] of OPS) if (re.test(t.text) && !o.operations.includes(label)) o.operations.push(label);
          const tbls = t.text.match(TABLE_RE) ?? [];
          for (const x of tbls) if (!o.mentionedTables.includes(x)) o.mentionedTables.push(x);
        }
      }
      for (const a of found) {
        const set = coRefs.get(a) ?? new Set<string>();
        for (const b of found) if (a !== b) set.add(b);
        coRefs.set(a, set);
      }
    }
    for (const o of objects.values()) o.related = Array.from(coRefs.get(o.name) ?? []).slice(0, 12);
    return Array.from(objects.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  });
}

const EXPR_RE = /(CASE WHEN|DATEDIFF|GREATEST|COALESCE|NVL\(|TO_DATE|TO_NUMBER|NULLIF|ADD_TO_DATE)/;

export function documentedExpressions(model: WorkbookModel): DocExpression[] {
  return memo(model, 'docExpr', () =>
    model.mappings
      .filter((m) => m.targetTable && m.remark && EXPR_RE.test(m.remark))
      .map((m) => ({ id: m.id, targetTable: m.targetTable, targetColumn: m.targetColumn, expression: m.remark, sheet: m.sheet, rowNo: m.rowNo })));
}

export function describeKind(k: ProcKind): string {
  switch (k) {
    case 'view': return 'TRAQ source view (E_TRAQ_*) that reshapes RECP data for a load';
    case 'traq-procedure': return 'TRAQ procedure in the RECP schema';
    case 'di-mapping': return 'Data Integration (DI) mapping';
    case 'di-workflow': return 'Data Integration (DI) workflow';
    case 'crismac-procedure': return 'CrisMac procedure referenced as the origin of a rule';
    default: return 'CrisMac object (table or procedure) referenced in the workbook';
  }
}

/** Client-side regex analysis of pasted SQL. Heuristic only. */
export function analyzeSql(model: WorkbookModel, sql: string): SqlAnalysis {
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const statements: SqlAnalysis['statements'] = [];
  const stmtRe = /\b(INSERT\s+INTO|UPDATE|MERGE\s+INTO|DELETE\s+FROM)\s+([A-Za-z0-9_.$"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(stripped))) statements.push({ type: m[1].toUpperCase().replace(/\s+/g, ' '), table: m[2].replace(/"/g, '') });

  const cte = new Set<string>();
  const cteRe = /([A-Za-z0-9_]+)\s+AS\s*\(/gi;
  while ((m = cteRe.exec(stripped))) cte.add(m[1].toUpperCase());

  const src = new Set<string>();
  const srcRe = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_.$"]+)/gi;
  while ((m = srcRe.exec(stripped))) {
    const name = m[1].replace(/"/g, '');
    if (!cte.has(name.toUpperCase())) src.add(name);
  }
  const known = tableByName(model);
  const sourceTables = Array.from(src).map((name) => {
    const bare = name.includes('.') ? name.split('.').pop()! : name;
    return { name, knownInWorkbook: known.has(name) || known.has(bare) || known.has(bare.toUpperCase()) };
  });

  const fnNames = ['CASE', 'COALESCE', 'NVL', 'DECODE', 'NULLIF', 'TO_DATE', 'TO_NUMBER', 'TO_CHAR', 'TRIM', 'SUBSTR', 'GREATEST', 'LEAST', 'SUM', 'MAX', 'MIN', 'COUNT', 'ROW_NUMBER', 'LISTAGG'];
  const functions = fnNames.filter((f) => new RegExp(`\\b${f}\\b`, 'i').test(stripped));
  const clauses = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION', 'WITH'].filter((c) => new RegExp(`\\b${c.replace(' ', '\\s+')}\\b`, 'i').test(stripped));

  const warnings: string[] = [];
  if (statements.length === 0 && /\bSELECT\b/i.test(stripped)) warnings.push('SELECT-only text: no INSERT/UPDATE/MERGE/DELETE target detected.');
  if (statements.length === 0 && !/\bSELECT\b/i.test(stripped)) warnings.push('No recognisable SQL statement found.');
  if (/\bMERGE\b/i.test(stripped) && !/\bWHEN\s+MATCHED\b/i.test(stripped)) warnings.push('MERGE found without WHEN MATCHED clause.');
  for (const s of sourceTables) if (!s.knownInWorkbook) warnings.push(`Source table ${s.name} is not described in the workbook.`);
  return { statements, sourceTables, functions, clauses, warnings };
}
