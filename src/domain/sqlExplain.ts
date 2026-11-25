import type { SqlAnalysis, SqlColumnExplained, SqlColumnHow, SqlStep, SqlStepExplanation, SqlTableUse, WorkbookModel } from '@/types';
import { KNOWN_FUNCTIONS, analyzeProcSql, maskSql } from './sqlParse';
import { tableByName } from './selectors';

/*
 * Plain-language explanation of pasted T-SQL. Everything here is derived from the SQL text by the structural parser in
 * sqlParse.ts (not AI, nothing guessed): statements, targets, columns with their expressions, enclosing IF/ELSE
 * conditions, joins, WHERE, DECLAREd variables and dated change comments. Business meaning is never inferred.
 */

/** Documented T-SQL behaviour of the functions the parser recognises. */
const FUNCTION_MEANING: Record<string, string> = {
  CASE: 'Returns the value of the first WHEN condition that is true, otherwise the ELSE value (NULL if there is no ELSE).',
  DATEDIFF: 'DATEDIFF(part, start, end): number of part boundaries (e.g. DAY) crossed between start and end; negative if end is before start.',
  DATEADD: 'DATEADD(part, n, date): the date moved forward by n parts.',
  DATEPART: 'Returns one part (year, month, day ...) of a date as a number.',
  DATENAME: 'Returns one part of a date as text.',
  EOMONTH: 'Last day of the month of the given date.',
  ISNULL: 'ISNULL(x, y): y when x is NULL, otherwise x.',
  COALESCE: 'First argument that is not NULL.',
  NULLIF: 'NULLIF(a, b): NULL when a equals b, otherwise a.',
  CAST: 'Converts a value to the given data type.',
  CONVERT: 'Converts a value to the given data type (optionally with a style code).',
  MAX: 'Largest value in the group.',
  MIN: 'Smallest value in the group.',
  SUM: 'Sum of the values in the group.',
  COUNT: 'Number of rows / non-NULL values in the group.',
  AVG: 'Average of the values in the group.',
  ROW_NUMBER: 'Sequence number of the row within its partition and order.',
  GETDATE: 'Current system date and time of the SQL Server.',
  ERROR_MESSAGE: 'Text of the error caught by the enclosing CATCH block.',
  LEN: 'Number of characters.',
  SUBSTRING: 'Part of a string from a start position for a length.',
  REPLACE: 'Replaces every occurrence of a substring.',
  UPPER: 'Upper-case text.',
  LOWER: 'Lower-case text.',
  IIF: 'IIF(cond, a, b): a when cond is true, otherwise b.',
};
const EXTRA_FUNCTIONS = new Set(['ERROR_MESSAGE']);

const TYPE_VERB: Record<SqlStep['type'], string> = {
  INSERT: 'Inserts rows into', UPDATE: 'Updates', DELETE: 'Deletes rows from', TRUNCATE: 'Empties', SELECT_INTO: 'Creates and fills', MERGE: 'Merges rows into', EXEC: 'Calls',
};
const KIND_LABEL: Record<SqlStep['tableKind'], string> = {
  table: 'table', working: 'working table (## temp or PRO schema)', 'local-temp': 'local temp table (#)',
};

function classify(expr: string): SqlColumnHow {
  const e = expr.trim();
  if (!e) return 'unparsed';
  if (/^\(?\s*NULL\s*\)?$/i.test(e)) return 'null';
  if (/^\(?\s*[-+]?\d+(?:\.\d+)?\s*\)?$/.test(e) || /^\(?\s*'[^']*'\s*\)?$/.test(e)) return 'constant';
  if (/^\(?\s*CASE\b/i.test(e)) return 'conditional';
  if (/^(?:\[?\w+\]?\.)?\[?\w+\]?$/.test(e) || /^@\w+$/.test(e)) return 'copy';
  return 'computed';
}

function functionsIn(expr: string): string[] {
  const found = Array.from(expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g), (m) => m[1].toUpperCase()).filter((f) => KNOWN_FUNCTIONS.has(f) || EXTRA_FUNCTIONS.has(f));
  return Array.from(new Set(found));
}

function explainColumn(name: string, expression: string, full: string | undefined): SqlColumnExplained {
  const expr = full ?? expression;
  const how = classify(expr);
  let plain: string;
  switch (how) {
    case 'null': plain = 'Cleared to NULL.'; break;
    case 'constant': plain = `Set to the constant ${expr.replace(/^\(|\)$/g, '').trim()}.`; break;
    case 'copy': plain = `Copied from ${expr.trim()}.`; break;
    case 'conditional': {
      const whens = (expr.match(/\bWHEN\b/gi) ?? []).length;
      const fns = functionsIn(expr).filter((f) => f !== 'CASE');
      plain = `Conditional value: ${whens} WHEN branch${whens === 1 ? '' : 'es'}${/\bELSE\b/i.test(expr) ? ' with an ELSE' : ' (no ELSE, so NULL when none match)'}${fns.length ? `; uses ${fns.join(', ')}` : ''}.`;
      break;
    }
    case 'computed': {
      const fns = functionsIn(expr);
      plain = fns.length ? `Computed expression using ${fns.join(', ')}.` : 'Computed from other columns / values.';
      break;
    }
    default: plain = 'Expression could not be read from the statement.';
  }
  return { name, expression: expr, how, plain };
}

function explainStep(s: SqlStep): SqlStepExplanation {
  const target = s.type === 'EXEC' ? s.callee : s.table;
  const n = s.columns.length;
  let headline: string;
  if (s.type === 'EXEC') headline = `Calls procedure ${s.callee || '(unnamed)'}.`;
  else if (s.type === 'TRUNCATE' || s.type === 'DELETE') headline = `${TYPE_VERB[s.type]} ${s.table} (${KIND_LABEL[s.tableKind]}).`;
  else headline = `${TYPE_VERB[s.type]} ${s.table} (${KIND_LABEL[s.tableKind]})${n ? `, ${n} column${n === 1 ? '' : 's'}` : ''}.`;
  return {
    index: s.index, type: s.type, target, targetKind: s.tableKind, lineStart: s.lineStart, lineEnd: s.lineEnd, headline,
    condition: s.guard, where: s.where ?? '', joins: s.joins ?? [], reads: s.reads,
    columns: s.columns.map((c) => explainColumn(c.name, c.expression, c.expressionFull)),
    functions: s.functions, comment: s.note, housekeeping: s.housekeeping, sql: s.sql,
  };
}

/** DECLARE @x TYPE [= value]; the value is read to the end of its parenthesis group or line. */
function declaredVariables(code: string, text: string): SqlAnalysis['variables'] {
  const out: SqlAnalysis['variables'] = [];
  for (const m of code.matchAll(/\bDECLARE\s+(@\w+)\s+(?:AS\s+)?([A-Za-z]+(?:\s*\([^)]*\))?)\s*(=)?/gi)) {
    let definition = '';
    if (m[3]) {
      let i = (m.index ?? 0) + m[0].length;
      while (i < code.length && /[ \t]/.test(code[i])) i++;
      let end = i;
      if (code[i] === '(') {
        let depth = 0;
        for (; end < code.length; end++) {
          if (code[end] === '(') depth++;
          else if (code[end] === ')') { depth--; if (depth === 0) { end++; break; } }
        }
      } else {
        while (end < code.length && code[end] !== '\n') end++;
      }
      definition = text.slice(i, end).replace(/\s+/g, ' ').trim();
    }
    out.push({ name: m[1], type: m[2].replace(/\s+/g, '').toUpperCase(), definition });
  }
  return out;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Regex-only fallback, used when the structural parser finds no statement (e.g. quoted identifiers, SELECT-only text). */
function basicAnalysis(model: WorkbookModel, sql: string): SqlAnalysis {
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
  return {
    statements, sourceTables, functions, clauses, warnings, overview: [], procedure: null, variables: [], tables: [], steps: [],
    functionNotes: functions.filter((f) => FUNCTION_MEANING[f]).map((f) => ({ name: f, meaning: FUNCTION_MEANING[f] })), changeLog: [], mode: 'basic',
  };
}

export function explainSql(model: WorkbookModel, sql: string): SqlAnalysis {
  const nameM = /CREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\s+([[\]\w.]+)/i.exec(sql);
  const procName = nameM ? nameM[1].replace(/[[\]]/g, '') : '(pasted SQL)';
  const src = analyzeProcSql({ name: procName, folder: '', file: '' }, sql);
  if (src.steps.length === 0) return basicAnalysis(model, sql);

  const { code, text } = maskSql(sql);
  const known = tableByName(model);
  const inWorkbook = (name: string) => known.has(name) || known.has(name.toUpperCase());
  const steps = src.steps.map(explainStep);
  const real = steps.filter((s) => !s.housekeeping);

  // Table roles: every written/read name with its kind (working tables are CrisMac intermediates, never in the workbook).
  const kindOf = new Map<string, SqlStep['tableKind']>();
  const written = new Map<string, Set<string>>();
  const read = new Set<string>();
  for (const s of src.steps) {
    if (s.type === 'EXEC') continue;
    if (s.table) {
      kindOf.set(s.table, s.tableKind);
      if (!s.housekeeping) { const set = written.get(s.table) ?? new Set<string>(); s.columns.forEach((c) => set.add(c.name)); written.set(s.table, set); }
    }
    if (!s.housekeeping) s.reads.forEach((r) => read.add(r));
  }
  // Tables read only inside DECLARE @x = (SELECT ... FROM t ...).
  const variables = declaredVariables(code, text);
  for (const v of variables) for (const x of v.definition.matchAll(/\b(?:FROM|JOIN)\s+([#[\]\w.]+)/gi)) {
    const nm = (x[1].replace(/[[\]#]/g, '').split('.').pop() ?? '').toUpperCase();
    if (nm) read.add(nm);
  }
  const names = new Set<string>([...written.keys(), ...read]);
  const tables: SqlTableUse[] = Array.from(names).sort().map((name) => {
    const isW = written.has(name);
    const isR = read.has(name);
    return {
      name, role: isW && isR ? 'read+written' : isW ? 'written' : 'read', kind: kindOf.get(name) ?? 'table',
      knownInWorkbook: inWorkbook(name), columnsWritten: Array.from(written.get(name) ?? []).sort(),
    };
  });

  const warnings: string[] = [];
  for (const t of tables) {
    if (t.knownInWorkbook || t.kind !== 'table' || !t.role.startsWith('read')) continue;
    warnings.push(`Source table ${t.name} is not described in the workbook.`);
  }
  if (/\bEXEC(?:UTE)?\s*\(/i.test(code) || /\bsp_executesql\b/i.test(code)) warnings.push('Dynamic SQL (EXEC(...)/sp_executesql) is present; its text is built at run time and is not analysed.');
  if (src.steps.some((s) => s.type === 'EXEC' && !s.callee)) warnings.push('An EXEC statement could not be resolved to a procedure name.');
  const noTarget = real.filter((s) => s.type !== 'EXEC' && !s.target).length;
  if (noTarget) warnings.push(`${plural(noTarget, 'statement')} had no readable target table.`);

  // Distinct enclosing conditions, in order of first use.
  const conditions = Array.from(new Set(real.map((s) => s.condition).filter(Boolean)));
  const byType = new Map<string, number>();
  real.forEach((s) => byType.set(s.type, (byType.get(s.type) ?? 0) + 1));
  const typeSummary = Array.from(byType, ([t, n]) => `${n} ${t}`).join(', ');
  const housekeeping = steps.length - real.length;

  const overview: string[] = [];
  overview.push(nameM
    ? `Stored procedure ${procName}${src.params.length ? ` with ${src.params.length === 1 ? 'parameter' : 'parameters'} ${src.params.map((p) => `${p.name} ${p.type}`).join(', ')}` : ''}.`
    : 'Pasted script (no CREATE PROCEDURE header found).');
  if (src.descriptions.length) overview.push(`Header description: ${src.descriptions.join(' / ')}.`);
  overview.push(`${plural(real.length, 'processing statement')}${typeSummary ? ` (${typeSummary})` : ''}${housekeeping ? `, plus ${plural(housekeeping, 'status-bookkeeping or CATCH statement')} shown separately` : ''}.`);
  const w = tables.filter((t) => t.role !== 'read');
  if (w.length) overview.push(`Writes to ${w.map((t) => `${t.name}${t.kind === 'table' ? '' : ' (working)'} [${plural(t.columnsWritten.length, 'column')}]`).join(', ')}.`);
  const r = tables.filter((t) => t.role === 'read');
  if (r.length) overview.push(`Reads from ${r.map((t) => `${t.name}${inWorkbook(t.name) ? '' : t.kind === 'table' ? ' (not in workbook)' : ''}`).join(', ')}.`);
  if (variables.length) overview.push(`Declares ${variables.map((v) => v.name).join(', ')}.`);
  if (conditions.length) overview.push(`${plural(conditions.length, 'distinct IF/ELSE condition')} decide which statements run: ${conditions.slice(0, 4).join(' | ')}${conditions.length > 4 ? ' ...' : ''}.`);
  if (src.changeLog.length) overview.push(`${plural(src.changeLog.length, 'dated change comment')} found in the source.`);

  const fnSet = new Set<string>();
  if (/\bCASE\b/i.test(code)) fnSet.add('CASE');
  for (const s of steps) s.functions.forEach((f) => fnSet.add(f));
  for (const v of variables) functionsIn(v.definition).forEach((f) => fnSet.add(f));
  functionsIn(code).forEach((f) => fnSet.add(f));
  const functions = Array.from(fnSet);
  const clauses = ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION', 'WITH', 'JOIN'].filter((c) => new RegExp(`\\b${c.replace(' ', '\\s+')}\\b`, 'i').test(code));

  return {
    statements: real.filter((s) => s.type !== 'EXEC').map((s) => ({ type: s.type, table: s.target })),
    sourceTables: r.concat(tables.filter((t) => t.role === 'read+written')).map((t) => ({ name: t.name, knownInWorkbook: t.knownInWorkbook })),
    functions, clauses, warnings, overview,
    procedure: { name: procName, params: src.params, author: src.author, created: src.created, modified: src.modified, descriptions: src.descriptions },
    variables, tables, steps,
    functionNotes: functions.filter((f) => FUNCTION_MEANING[f]).map((f) => ({ name: f, meaning: FUNCTION_MEANING[f] })),
    changeLog: src.changeLog, mode: 'structural',
  };
}
