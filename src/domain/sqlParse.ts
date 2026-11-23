import type { ProcParam, ProcSource, SqlColumnWrite, SqlJoin, SqlStep, SqlStepType } from '@/types';

/*
 * Structural analysis of T-SQL stored procedures (regex + a small state machine, NOT a full parser and NOT AI).
 * It reports what the text literally says: statements, targets, columns assigned with their expressions, tables read,
 * enclosing IF/ELSE conditions and dated change comments. Anything it cannot see (dynamic SQL, exotic syntax) is
 * simply absent rather than guessed.
 */

const RESERVED = new Set([
  'SELECT', 'WHERE', 'SET', 'FROM', 'JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'INNER', 'LEFT',
  'RIGHT', 'FULL', 'OUTER', 'CROSS', 'GROUP', 'ORDER', 'BY', 'HAVING', 'UNION', 'ALL', 'DISTINCT', 'TOP', 'OPTION', 'WITH', 'VALUES', 'INTO',
  'EXISTS', 'IN', 'IS', 'LIKE', 'BETWEEN', 'HASH', 'MERGE', 'LOOP', 'REMOTE', 'USING', 'INSERT', 'UPDATE', 'DELETE',
]);
const HOUSEKEEPING = new Set(['ACLRUNNINGPROCESSSTATUS', 'PROCESSMONITOR']);
const KNOWN_FUNCTIONS = new Set([
  'DATEDIFF', 'DATEADD', 'DATENAME', 'DATEPART', 'EOMONTH', 'ISNULL', 'COALESCE', 'NULLIF', 'CAST', 'CONVERT', 'MAX', 'MIN', 'SUM', 'COUNT', 'AVG',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LEN', 'SUBSTRING', 'LTRIM', 'RTRIM', 'REPLACE', 'CHARINDEX', 'GETDATE', 'ABS', 'ROUND', 'CEILING', 'FLOOR',
  'STRING_AGG', 'YEAR', 'MONTH', 'DAY', 'IIF', 'LEAD', 'LAG', 'FORMAT', 'UPPER', 'LOWER',
]);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Same-length copies of the source: `code` has comments and string contents blanked; `text` keeps strings. */
export function maskSql(sql: string): { code: string; text: string } {
  const code: string[] = [];
  const text: string[] = [];
  const n = sql.length;
  const blank = (c: string) => (c === '\n' || c === '\r' ? c : ' ');
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      while (i < n && sql[i] !== '\n') { const b = blank(sql[i]); code.push(b); text.push(b); i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      const end = Math.min(n, j + 2);
      for (; i < end; i++) { const b = blank(sql[i]); code.push(b); text.push(b); }
      continue;
    }
    if (c === "'") {
      code.push("'"); text.push("'"); i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { code.push(' ', ' '); text.push("'", "'"); i += 2; continue; }
          break;
        }
        code.push(blank(sql[i])); text.push(sql[i]); i++;
      }
      if (i < n) { code.push("'"); text.push("'"); i++; }
      continue;
    }
    code.push(c); text.push(c); i++;
  }
  return { code: code.join(''), text: text.join('') };
}

function normName(raw: string): { name: string; kind: SqlStep['tableKind'] } | null {
  const s = raw.replace(/[[\]]/g, '').trim();
  if (!s || s.startsWith('@')) return null;
  const hashes = (/^#+/.exec(s) ?? [''])[0].length;
  const parts = s.replace(/#/g, '').split('.').filter(Boolean);
  const name = (parts[parts.length - 1] ?? '').toUpperCase();
  if (!name || RESERVED.has(name) || !/^[A-Z_][A-Z0-9_]*$/.test(name)) return null;
  const schema = parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : '';
  const kind = hashes === 1 ? 'local-temp' : hashes >= 2 || schema === 'PRO' ? 'working' : 'table';
  return { name, kind };
}

function splitTop(code: string, text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Index of the first depth-0 occurrence of any keyword at or after `from`, else `code.length`. */
function findTopKeyword(code: string, from: number, re: RegExp): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth <= 0 && /[A-Za-z]/.test(c) && (i === 0 || !/\w/.test(code[i - 1])) && re.test(code.slice(i, i + 12))) return i;
  }
  return code.length;
}
const FROM_RE = /^(?:FROM)\b/i;
const SET_END_RE = /^(?:FROM|WHERE|OUTPUT|OPTION)\b/i;
const WHERE_RE = /^WHERE\b/i;
const WHERE_END_RE = /^(?:GROUP|ORDER|OPTION|HAVING|UNION|OUTPUT)\b/i;
const JOIN_START_RE = /^(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN)\b/i;
const JOIN_HEAD_RE = /^((?:INNER|LEFT|RIGHT|FULL|CROSS)(?:\s+OUTER)?\s+)?JOIN\s+(\(|[#[\]\w.]+)(?:\s+(?:AS\s+)?(?!ON\b|WITH\b|WHERE\b|SELECT\b|INNER\b|LEFT\b|RIGHT\b|FULL\b|CROSS\b|JOIN\b)(\w+))?/i;

function closeParen(code: string, open: number, limit = code.length): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return limit;
}

/** JOINs (with ON text) and the WHERE condition of a statement, from its top-level FROM onwards. */
function fromAndWhere(code: string, text: string, start: number): { joins: SqlJoin[]; where: string } {
  const f = findTopKeyword(code, start, FROM_RE);
  const w = findTopKeyword(code, f < code.length ? f : start, WHERE_RE);
  const joins: SqlJoin[] = [];
  const nextJoin = (from: number) => {
    let n = findTopKeyword(code, from, JOIN_START_RE);
    while (n < w && !JOIN_HEAD_RE.test(code.slice(n, w))) n = findTopKeyword(code, n + 1, JOIN_START_RE);
    return n;
  };
  if (f < code.length) {
    let pos = nextJoin(f + 4);
    while (pos < w) {
      const h = JOIN_HEAD_RE.exec(code.slice(pos, w));
      if (!h) break;
      let after = pos + h[0].length;
      let table: string;
      let alias = '';
      if (h[2] === '(') {
        const close = closeParen(code, after - 1, w);
        table = '(subquery)';
        const a = /^\s*(?:AS\s+)?(?!ON\b)(\w+)/i.exec(code.slice(close + 1, w));
        alias = a ? a[1].toUpperCase() : '';
        after = close + 1 + (a ? a[0].length : 0);
      } else {
        table = normName(h[2])?.name ?? h[2].toUpperCase();
        alias = (h[3] ?? '').toUpperCase();
      }
      const next = nextJoin(after);
      const end = Math.min(next, w);
      const onM = /^\s*ON\b/i.exec(code.slice(after, end));
      joins.push({
        kind: ((h[1] ?? '').trim().toUpperCase().replace(/\s+OUTER$/, '') || 'INNER'),
        table, alias, on: onM ? squash(text.slice(after + onM[0].length, end)) : '',
      });
      pos = next;
    }
  }
  let where = '';
  if (w < code.length) where = squash(text.slice(w + 5, findTopKeyword(code, w + 5, WHERE_END_RE)));
  return { joins, where };
}

function aliasRecord(code: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [alias, raw] of aliasMap(code)) {
    const n = normName(raw);
    if (n) out[alias] = n.name;
  }
  return out;
}

/** MERGE INTO t USING s ON c WHEN MATCHED THEN UPDATE SET ... WHEN NOT MATCHED THEN INSERT (...) VALUES (...). */
function analyzeMerge(code: string, text: string): { target: string; columns: SqlColumnWrite[]; join: SqlJoin; where: string } | null {
  const h = /MERGE\s+(?:TOP\s*\([^)]*\)\s*)?(?:INTO\s+)?([#[\]\w.]+)(?:\s+(?:AS\s+)?(?!USING\b)(\w+))?\s+USING\s+/i.exec(code);
  if (!h) return null;
  let p = h.index + h[0].length;
  let source = '(subquery)';
  if (code[p] === '(') p = closeParen(code, p) + 1;
  else {
    const s = /^([#[\]\w.]+)/.exec(code.slice(p));
    if (s) { source = normName(s[1])?.name ?? s[1].toUpperCase(); p += s[0].length; }
  }
  const a = /^\s*(?:AS\s+)?(?!ON\b)(\w+)/i.exec(code.slice(p));
  const alias = a ? a[1].toUpperCase() : '';
  if (a) p += a[0].length;
  // WHEN [NOT] MATCHED clauses at parenthesis depth 0 (CASE WHEN inside SET items is not a clause).
  const clauseStarts: number[] = [];
  let depth = 0;
  for (let i = p; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === 'W' || c === 'w') && !/\w/.test(code[i - 1] ?? ' ') && /^WHEN\s+(?:NOT\s+)?MATCHED\b/i.test(code.slice(i, i + 40))) clauseStarts.push(i);
  }
  const onEnd = clauseStarts[0] ?? code.length;
  const onM = /^\s*ON\b/i.exec(code.slice(p, onEnd));
  const join: SqlJoin = { kind: 'USING', table: source, alias, on: onM ? squash(text.slice(p + onM[0].length, onEnd)) : '' };
  const columns: SqlColumnWrite[] = [];
  let where = '';
  clauseStarts.forEach((start, idx) => {
    const end = clauseStarts[idx + 1] ?? code.length;
    const cc = code.slice(start, end).replace(/;\s*$/, '');
    const ct = text.slice(start, start + cc.length);
    const cond = /^WHEN\s+(?:NOT\s+)?MATCHED(?:\s+BY\s+(?:TARGET|SOURCE))?\s+AND\s+([\s\S]*?)\s+THEN\b/i.exec(cc);
    const up = /\bTHEN\s+UPDATE\s+SET\b/i.exec(cc);
    if (up) {
      if (cond && !where) where = squash(ct.slice(cond.index + cond[0].indexOf(cond[1]), cond.index + cond[0].indexOf(cond[1]) + cond[1].length));
      const s = up.index + up[0].length;
      for (const item of splitTop(cc.slice(s), ct.slice(s))) {
        const m = /^\s*(?:[\w#[\]]+\.)?\[?(\w+)\]?\s*=(?!=)\s*([\s\S]*)$/.exec(item);
        if (m) columns.push({ name: m[1].toUpperCase(), expression: cleanExpr(m[2]), expressionFull: fullExpr(m[2]) });
      }
    }
    const ins = /\bTHEN\s+INSERT\s*\(/i.exec(cc);
    if (ins) {
      const open = ins.index + ins[0].length - 1;
      const close = closeParen(cc, open);
      const names = splitTop(cc.slice(open + 1, close), ct.slice(open + 1, close)).map((x) => x.replace(/[[\]\s]/g, '').toUpperCase());
      const v = /^\s*VALUES\s*\(/i.exec(cc.slice(close + 1));
      let vals: string[] = [];
      if (v) {
        const vo = close + 1 + v[0].length - 1;
        const vc = closeParen(cc, vo);
        vals = splitTop(cc.slice(vo + 1, vc), ct.slice(vo + 1, vc));
      }
      names.forEach((n, i) => columns.push({ name: n, expression: vals.length === names.length ? cleanExpr(vals[i]) : '', expressionFull: vals.length === names.length ? fullExpr(vals[i]) : undefined }));
    }
  });
  return { target: h[1], columns, join, where };
}

function aliasMap(code: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of code.matchAll(/\b(?:FROM|JOIN)\s+([#[\]\w.]+)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi)) {
    const alias = x[2];
    if (alias && !RESERVED.has(alias.toUpperCase())) m.set(alias.toUpperCase(), x[1]);
    m.set((x[1].replace(/[[\]#]/g, '').split('.').pop() ?? '').toUpperCase(), x[1]);
  }
  return m;
}

function deriveName(item: string): string {
  const s = squash(item);
  const a = /\bAS\s+\[?(\w+)\]?$/i.exec(s) ?? /^\[?(\w+)\]?\s*=(?!=)/.exec(s) ?? /(?:^|\.)\[?(\w+)\]?$/.exec(s);
  return a ? a[1].toUpperCase() : '';
}

function fullExpr(item: string): string {
  const s = squash(item);
  const eq = /^\[?\w+\]?\s*=(?!=)\s*([\s\S]+)$/.exec(s);
  return (eq ? eq[1] : s.replace(/\s+AS\s+\[?\w+\]?$/i, '')).trim();
}
function cleanExpr(item: string): string {
  return clip(fullExpr(item), 240);
}

interface SegResult { step: Omit<SqlStep, 'id' | 'index' | 'guard' | 'guards' | 'note' | 'lineStart' | 'lineEnd' | 'housekeeping'>; locals: string[] }

function analyzeSegment(type: SqlStepType, code: string, text: string): SegResult | null {
  const locals: string[] = [];
  const note = (n: { name: string; kind: SqlStep['tableKind'] } | null) => { if (n?.kind === 'local-temp') locals.push(n.name); return n; };
  const aliases = aliasMap(code);
  const resolve = (tok: string) => note(normName(aliases.get(tok.replace(/[[\]]/g, '').toUpperCase()) ?? tok));
  let target: { name: string; kind: SqlStep['tableKind'] } | null = null;
  let columns: SqlColumnWrite[] = [];
  let callee = '';
  let clauseStart = 0;
  let mergeJoin: SqlJoin | null = null;
  let mergeWhere = '';

  if (type === 'MERGE') {
    const m = analyzeMerge(code, text);
    if (!m) return null;
    target = note(normName(m.target));
    columns = m.columns;
    mergeJoin = m.join;
    mergeWhere = m.where;
  } else if (type === 'INSERT') {
    const h = /INSERT\s+(?:INTO\s+)?([#[\]\w.]+)\s*(\()?/i.exec(code);
    if (!h) return null;
    target = note(normName(h[1]));
    let names: string[] = [];
    let after = h.index + h[0].length;
    if (h[2]) {
      const open = h.index + h[0].length - 1;
      let depth = 0;
      let close = open;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '(') depth++;
        else if (code[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
      }
      names = splitTop(code.slice(open + 1, close), text.slice(open + 1, close)).map((s) => s.replace(/[[\]\s]/g, '').toUpperCase());
      after = close + 1;
    }
    const sel = /\bSELECT\b/i.exec(code.slice(after));
    let items: string[] = [];
    if (sel) {
      const from = after + sel.index + sel[0].length;
      const end = findTopKeyword(code, from, FROM_RE);
      items = splitTop(code.slice(from, end), text.slice(from, end));
      if (items.length) items[0] = items[0].replace(/^\s*(?:DISTINCT|TOP\s*\(?\d+\)?(?:\s+PERCENT)?)\s+/i, '');
    }
    const paired = items.length === names.length;
    columns = names.map((name, i) => ({ name, expression: paired ? cleanExpr(items[i]) : '', expressionFull: paired ? fullExpr(items[i]) : undefined }));
    clauseStart = after;
  } else if (type === 'UPDATE') {
    const h = /UPDATE\s+(?:TOP\s*\(\s*\d+\s*\)\s*)?([#[\]\w.]+)\s+SET\b/i.exec(code);
    if (!h) return null;
    target = resolve(h[1]);
    const from = h.index + h[0].length;
    const end = findTopKeyword(code, from, SET_END_RE);
    for (const item of splitTop(code.slice(from, end), text.slice(from, end))) {
      const a = /^\s*(?:[\w#[\]]+\.)?\[?(\w+)\]?\s*=(?!=)\s*([\s\S]*)$/.exec(item);
      if (a) columns.push({ name: a[1].toUpperCase(), expression: cleanExpr(a[2]), expressionFull: fullExpr(a[2]) });
    }
    clauseStart = end;
  } else if (type === 'DELETE') {
    const h = /DELETE\s+(?:TOP\s*\(\s*\d+\s*\)\s*)?(?:FROM\s+)?([#[\]\w.]+)/i.exec(code);
    if (!h) return null;
    target = resolve(h[1]);
    clauseStart = h.index + h[0].length;
  } else if (type === 'TRUNCATE') {
    const h = /TRUNCATE\s+TABLE\s+([#[\]\w.]+)/i.exec(code);
    if (!h) return null;
    target = note(normName(h[1]));
  } else if (type === 'SELECT_INTO') {
    const h = /SELECT\b([\s\S]*?)\bINTO\s+([#[\]\w.]+)/i.exec(code);
    if (!h) return null;
    target = note(normName(h[2]));
    const bodyStart = h.index + 6;
    const bodyEnd = bodyStart + h[1].length;
    columns = splitTop(code.slice(bodyStart, bodyEnd), text.slice(bodyStart, bodyEnd))
      .filter((s) => s !== '*')
      .map((s) => ({ name: deriveName(s), expression: cleanExpr(s), expressionFull: fullExpr(s) }))
      .filter((c) => c.name);
    clauseStart = bodyEnd;
  } else {
    const h = /EXEC(?:UTE)?\s+(?:@\w+\s*=\s*)?([#[\]\w.]+)/i.exec(code);
    if (!h) return null;
    callee = (h[1].replace(/[[\]]/g, '').split('.').pop() ?? '').trim();
  }

  const readsMeta: { name: string; kind: SqlStep['tableKind'] }[] = [];
  for (const x of code.matchAll(/\b(?:FROM|JOIN)\s+([#[\]\w.]+)/gi)) {
    const n = note(normName(x[1]));
    if (n) readsMeta.push(n);
  }
  let reads = Array.from(new Set(readsMeta.map((r) => r.name)));
  if ((type === 'UPDATE' || type === 'DELETE') && target && readsMeta.filter((r) => r.name === target?.name).length === 1) reads = reads.filter((r) => r !== target?.name);

  const functions = Array.from(new Set(Array.from(code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g), (m) => m[1].toUpperCase()).filter((f) => KNOWN_FUNCTIONS.has(f))));
  let joins: SqlJoin[] = [];
  let where = '';
  if (type === 'MERGE') {
    if (mergeJoin) {
      joins = [mergeJoin];
      if (mergeJoin.table !== '(subquery)' && !reads.includes(mergeJoin.table)) reads = [...reads, mergeJoin.table];
    }
    where = mergeWhere;
  } else if (type !== 'EXEC' && type !== 'TRUNCATE') {
    ({ joins, where } = fromAndWhere(code, text, clauseStart));
  }
  return {
    step: {
      type, table: target?.name ?? '', tableKind: target?.kind ?? 'table', columns, reads, callee, sql: clip(text.trim(), 2500), functions,
      where, joins, aliases: aliasRecord(code),
    },
    locals,
  };
}

function scanCondition(code: string, text: string, from: number): { text: string; full: string; end: number } {
  let depth = 0;
  const limit = Math.min(code.length, from + 700);
  let j = from;
  for (; j < limit; j++) {
    const c = code[j];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth <= 0 && /[A-Za-z]/.test(c) && /[\s)]/.test(code[j - 1] ?? ' ')
      && /^(?:BEGIN|INSERT|UPDATE|DELETE|TRUNCATE|EXEC|EXECUTE|SELECT|SET|RAISERROR|PRINT|RETURN|WITH|DROP|DECLARE|IF|WHILE|GOTO|COMMIT|ROLLBACK|CREATE|ALTER)\b/i.test(code.slice(j, j + 10))) break;
  }
  return { text: clip(squash(text.slice(from, j)), 170), full: squash(text.slice(from, j)), end: j };
}

const EVENT = /\b(?:BEGIN\s+TRY|BEGIN\s+CATCH|END\s+TRY|END\s+CATCH|BEGIN\s+TRAN(?:SACTION)?|BEGIN|END|CASE|IF|ELSE|WHILE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE\s+TABLE|EXEC(?:UTE)?|SELECT|WITH|DECLARE|DROP\s+(?:TABLE|INDEX)|CREATE\s+(?:TABLE|INDEX|UNIQUE|CLUSTERED|NONCLUSTERED)|ALTER|PRINT|RAISERROR|RETURN|COMMIT|ROLLBACK|SET\s+(?:NOCOUNT|ANSI_NULLS|QUOTED_IDENTIFIER|XACT_ABORT|@\w+)|GO)\b/gi;

/** A guard as display text (d, clipped) and as SQL boolean text (f, unclipped). */
interface Guard { d: string; f: string }
interface RawStep { type: SqlStepType; start: number; end: number; guard: string; guards: string[]; inCatch: boolean }

function splitStatements(code: string, text: string): RawStep[] {
  const steps: RawStep[] = [];
  const stack: { guard: Guard | null; kind: 'block' | 'try' | 'catch' }[] = [];
  let open: Omit<RawStep, 'end'> | null = null;
  let caseDepth = 0;
  let pending: Guard | null = null;
  let elsePending = false;
  let lastGuard: Guard | null = null;
  let cte: number | null = null;
  let skipUntil = 0;
  const close = (at: number) => { if (open) { steps.push({ ...open, end: at }); open = null; } };
  const consumePending = () => { if (pending) { lastGuard = pending; pending = null; } };

  for (const m of code.matchAll(EVENT)) {
    const pos = m.index ?? 0;
    if (pos < skipUntil) continue;
    const tok = m[0].toUpperCase().replace(/\s+/g, ' ');
    const before = code.slice(Math.max(0, pos - 10), pos);
    const isDml = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE TABLE', 'EXEC', 'EXECUTE', 'SELECT'].includes(tok);
    if (tok === 'CASE') { caseDepth++; continue; }
    if (tok === 'END' && caseDepth > 0) { caseDepth--; continue; }
    if (tok === 'ELSE' && caseDepth > 0) continue;
    if (tok === 'BEGIN TRAN' || tok === 'BEGIN TRANSACTION') continue;
    if (tok === 'GO') {
      const ls = code.lastIndexOf('\n', pos - 1) + 1;
      const le = code.indexOf('\n', pos);
      if (!/^\s*GO\s*$/i.test(code.slice(ls, le < 0 ? code.length : le))) continue;
    }
    if (!isDml && tok !== 'WITH') cte = null;

    if (tok === 'END') { close(pos); const b = stack.pop(); lastGuard = b?.guard ?? lastGuard; continue; }
    if (tok === 'END TRY' || tok === 'END CATCH') { close(pos); stack.pop(); continue; }
    if (tok === 'BEGIN TRY') { close(pos); stack.push({ guard: null, kind: 'try' }); continue; }
    if (tok === 'BEGIN CATCH') { close(pos); stack.push({ guard: null, kind: 'catch' }); continue; }
    if (tok === 'BEGIN') { close(pos); stack.push({ guard: pending, kind: 'block' }); pending = null; continue; }
    if (tok === 'ELSE') {
      close(pos);
      elsePending = true;
      const lg: Guard | null = lastGuard;
      pending = lg ? { d: `ELSE (of: ${lg.d})`, f: `NOT (${lg.f})` } : { d: 'ELSE', f: '' };
      continue;
    }
    if (tok === 'IF' || tok === 'WHILE') {
      if (/(?:TABLE|INDEX)\s*$/i.test(before)) continue;
      close(pos);
      const c = scanCondition(code, text, pos + tok.length);
      const own = tok === 'WHILE' ? `__WHILE__ (${c.full})` : `(${c.full})`;
      const prior: Guard | null = elsePending ? pending : null;
      pending = {
        d: `${elsePending ? 'ELSE ' : ''}${tok} ${c.text}`,
        f: prior?.f ? `${prior.f} AND ${own}` : own,
      };
      elsePending = false;
      skipUntil = c.end;
      continue;
    }
    if (tok === 'WITH') {
      if (/^WITH\s+\w+\s*(?:\([^)]*\))?\s*AS\s*\(/i.test(code.slice(pos, pos + 240))) { close(pos); cte = pos; }
      continue;
    }
    if (tok === 'SELECT') {
      const sel = /^SELECT\b([\s\S]{0,4000}?)\bINTO\s+[#[\]\w.]+/i.exec(code.slice(pos, pos + 4200));
      if (!sel || /\b(?:FROM|INSERT|UPDATE|DELETE|EXEC|EXECUTE|SELECT|IF|BEGIN|WHERE|SET)\b/i.test(sel[1])) continue;
    }
    if (isDml) {
      if (/THEN\s*$/i.test(before) || ((tok === 'UPDATE' || tok === 'DELETE') && /(?:FOR|ON|AFTER)\s*$/i.test(before))) continue;
      if (tok === 'UPDATE' && /^UPDATE\s+STATISTICS/i.test(code.slice(pos, pos + 25))) continue;
      if (tok === 'INSERT' && !/^INSERT\s+(?:INTO\s+)?[#[\w]/i.test(code.slice(pos, pos + 40))) continue;
      close(pos);
      // MERGE is also a join hint (INNER MERGE JOIN, OPTION (MERGE JOIN)); only a MERGE [INTO] target starts a statement.
      if (tok === 'MERGE' && (/^MERGE\s+JOIN\b/i.test(code.slice(pos, pos + 20)) || /(?:INNER|LEFT|RIGHT|FULL|OUTER|,|\()\s*$/i.test(before)
        || !/^MERGE\s+(?:TOP\s*\([^)]*\)\s*)?(?:INTO\s+)?[#[\w]/i.test(code.slice(pos, pos + 60)))) continue;
      close(pos);
      const type: SqlStepType = tok === 'TRUNCATE TABLE' ? 'TRUNCATE' : tok === 'SELECT' ? 'SELECT_INTO' : tok === 'EXECUTE' ? 'EXEC' : (tok as SqlStepType);
      const parts = stack.map((b) => b.guard).filter((g): g is Guard => !!g);
      if (pending) { parts.push(pending); consumePending(); }
      open = {
        type, start: cte ?? pos, guard: parts.map((g) => g.d).join(' AND '), guards: parts.map((g) => g.f).filter(Boolean),
        inCatch: stack.some((b) => b.kind === 'catch'),
      };
      cte = null;
      // A MERGE embeds WHEN ... THEN UPDATE/INSERT; it must end with ';', so skip its inner keywords.
      if (type === 'MERGE') { const semi = code.indexOf(';', pos); skipUntil = semi < 0 ? code.length : semi; }
      continue;
    }
    // any other statement keyword ends the current statement and consumes a single-statement IF
    close(pos);
    consumePending();
  }
  close(code.length);
  return steps;
}

function lineIndex(sql: string): number[] {
  const nl: number[] = [];
  for (let i = 0; i < sql.length; i++) if (sql[i] === '\n') nl.push(i);
  return nl;
}
function lineOf(nl: number[], off: number): number {
  let lo = 0;
  let hi = nl.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < off) lo = mid + 1; else hi = mid; }
  return lo + 1;
}

function noteAbove(lines: string[], lineStart: number): string {
  const got: string[] = [];
  let blanks = 0;
  for (let i = lineStart - 2; i >= 0 && got.length < 4; i--) {
    const t = lines[i].trim();
    if (!t) { if (++blanks > 1) break; continue; }
    if (/^(--|\/\*|\*)/.test(t) || /\*\/$/.test(t)) {
      const c = t.replace(/^(--+|\/\*+|\*+)\s*/, '').replace(/\*+\/\s*$/, '').trim();
      if (c && !/^-+$/.test(c)) got.unshift(c);
      continue;
    }
    break;
  }
  return clip(got.join(' '), 240);
}

const DATE_RE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{8}\b|\b20\d{2}-\d{2}-\d{2}\b/;
const CHANGE_RE = /(add|chang|implement|as per|discuss|email|modif|fix|remov|requirement|\bsir\b|\bmam\b|\bby\b)/i;
const SKIP_RE = /Script Date|CREATE DATE|MODIFY DATE|AUTHOR|AUTHER/i;

function changeLog(lines: string[]): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  lines.forEach((line, i) => {
    let part = '';
    if (inBlock) { part = line; if (line.includes('*/')) inBlock = false; }
    else {
      const bi = line.indexOf('/*');
      const li = line.indexOf('--');
      if (li >= 0 && (bi < 0 || li < bi)) part = line.slice(li + 2);
      else if (bi >= 0) { part = line.slice(bi + 2); if (!line.includes('*/', bi + 2)) inBlock = true; }
    }
    const t = part.replace(/[-*/]{2,}/g, ' ').trim();
    if (!t || SKIP_RE.test(t) || !DATE_RE.test(t) || !CHANGE_RE.test(t)) return;
    if (out.length && out[out.length - 1].text === clip(squash(t), 240)) return;
    if (out.length < 80) out.push({ line: i + 1, text: clip(squash(t), 240) });
  });
  return out;
}

function parseHeader(head: string) {
  const tidy = (s: string) => s.replace(/\s*\*+\/\s*$/, '').trim();
  const one = (re: RegExp) => tidy(re.exec(head)?.[1] ?? '');
  const descriptions = Array.from(head.matchAll(/DESCRIPTION\s*:\s*(.+)/gi), (m) => tidy(m[1])).filter(Boolean);
  const testCases: { id: string; text: string }[] = [];
  const hm = /RefCustomerID\s+TestCase/i.exec(head);
  if (hm) {
    for (const line of head.slice(hm.index + hm[0].length).split(/\r?\n/)) {
      if (/={3,}/.test(line)) break;
      const t = /^\s*(\d{1,4})\s+(\S.*?)\s*$/.exec(line);
      if (t) testCases.push({ id: t[1], text: t[2] });
    }
  }
  return {
    author: one(/AUTH(?:O|E)R\s*:\s*(.+)/i), created: one(/CREATE DATE\s*:\s*(\S+)/i), modified: one(/MODIFY DATE\s*:\s*(\S+)/i),
    descriptions, testCases,
  };
}

function parseParams(code: string): ProcParam[] {
  const m = /CREATE\s+PROC(?:EDURE)?\s+(?:\[?\w+\]?\.)?\[?\w+\]?([\s\S]*?)\bAS\b/i.exec(code);
  if (!m) return [];
  return Array.from(m[1].matchAll(/@(\w+)\s+([A-Za-z]+(?:\s*\([^)]*\))?)(?:\s*=\s*([^\s,]+))?/g), (p) => ({ name: `@${p[1]}`, type: p[2].replace(/\s+/g, ''), defaultValue: p[3] ?? '' }));
}

export interface ProcFileInfo { name: string; folder: string; file: string }

export function analyzeProcSql(info: ProcFileInfo, sql: string): ProcSource {
  const { code, text } = maskSql(sql);
  const lines = sql.split(/\r?\n/);
  const nl = lineIndex(sql);
  const locals = new Set<string>();
  for (const m of code.matchAll(/CREATE\s+TABLE\s+(#+[\w]+)/gi)) { const n = normName(m[1]); if (n) locals.add(n.name); }
  for (const m of code.matchAll(/(?:\bWITH|,)\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*AS\s*\(/gi)) locals.add(m[1].toUpperCase());

  const steps: SqlStep[] = [];
  for (const raw of splitStatements(code, text)) {
    const seg = analyzeSegment(raw.type, code.slice(raw.start, raw.end), text.slice(raw.start, raw.end));
    if (!seg) continue;
    seg.locals.forEach((l) => locals.add(l));
    const lineStart = lineOf(nl, raw.start);
    const lastChar = raw.start + Math.max(0, code.slice(raw.start, raw.end).trimEnd().length - 1);
    const index = steps.length + 1;
    steps.push({
      ...seg.step, id: `${info.name}:${index}`, index, guard: raw.guard, guards: raw.guards, note: noteAbove(lines, lineStart), lineStart,
      lineEnd: lineOf(nl, lastChar), housekeeping: raw.inCatch || HOUSEKEEPING.has(seg.step.table),
    });
  }

  const written = new Map<string, Set<string>>();
  const read = new Set<string>();
  const calls = new Set<string>();
  for (const s of steps) {
    if (s.housekeeping) continue;
    if (s.type === 'EXEC') { if (s.callee) calls.add(s.callee); continue; }
    if (s.table && !locals.has(s.table) && s.tableKind !== 'local-temp') {
      const set = written.get(s.table) ?? new Set<string>();
      s.columns.forEach((c) => set.add(c.name));
      written.set(s.table, set);
    }
    s.reads.forEach((r) => { if (!locals.has(r) && !HOUSEKEEPING.has(r)) read.add(r); });
  }

  const thresholds = Array.from(new Set([
    ...Array.from(text.matchAll(/BUSINESSRULE\s*=\s*'([^']+)'/gi), (m) => `PRO.REFPERIOD: ${m[1].toUpperCase()}`),
    ...Array.from(text.matchAll(/ParameterName\s*=\s*'([^']+)'/gi), (m) => `solutionglobalparameter: ${m[1]}`),
  ]));

  const fm = /^(\d+)_S(\d+)_/.exec(info.file);
  const createIdx = sql.search(/CREATE\s+PROC/i);
  return {
    id: info.name, name: info.name, stage: fm ? `S${fm[2]}` : '', order: fm ? Number(fm[1]) : 999, file: info.file, folder: info.folder,
    ...parseHeader(sql.slice(0, createIdx < 0 ? 3000 : createIdx)),
    params: parseParams(text), steps,
    tablesRead: Array.from(read).sort(),
    tablesWritten: Array.from(written, ([table, cols]) => ({ table, columns: Array.from(cols).sort() })).sort((a, b) => a.table.localeCompare(b.table)),
    calls: Array.from(calls).sort(), thresholds, changeLog: changeLog(lines), lineCount: lines.length,
  };
}
