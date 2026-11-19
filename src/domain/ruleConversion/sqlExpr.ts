/*
 * Parser for T-SQL scalar and boolean expressions (the right-hand side of SET, SELECT items, WHERE/ON/IF conditions).
 * It is a small recursive-descent parser, not an AI and not a full T-SQL grammar. Constructs it cannot represent
 * (sub-queries, EXISTS, window functions) become `unsupported` nodes so the caller can flag them instead of guessing.
 */

export type Expr =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  | { k: 'null' }
  | { k: 'bool'; v: boolean }
  /** parts = identifier chain, upper-case, brackets removed: [COLUMN] / [ALIAS, COLUMN] / [SCHEMA, TABLE, COLUMN]. */
  | { k: 'col'; parts: string[] }
  | { k: 'var'; name: string }
  | { k: 'fn'; name: string; args: Expr[]; typeArg?: string }
  | { k: 'case'; operand: Expr | null; whens: { when: Expr; then: Expr }[]; else: Expr | null }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'and'; items: Expr[] }
  | { k: 'or'; items: Expr[] }
  | { k: 'not'; e: Expr }
  | { k: 'neg'; e: Expr }
  | { k: 'isnull'; e: Expr; not: boolean }
  | { k: 'in'; e: Expr; list: Expr[]; not: boolean }
  | { k: 'between'; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: 'like'; e: Expr; pattern: Expr; not: boolean }
  | { k: 'unsupported'; text: string; reason: string };

type Tok =
  | { t: 'num'; v: string; at: number }
  | { t: 'str'; v: string; at: number }
  | { t: 'var'; v: string; at: number }
  | { t: 'id'; v: string; raw: string; at: number }
  | { t: 'op'; v: string; at: number }
  | { t: 'eof'; at: number };

export class SqlExprError extends Error {}

const KEYWORDS = new Set(['CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'AS', 'SELECT', 'OVER']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || ((c === 'N' || c === 'n') && src[i + 1] === "'")) {
      const at = i;
      i += c === "'" ? 1 : 2;
      let v = '';
      for (;;) {
        if (i >= n) throw new SqlExprError('Unterminated string literal');
        if (src[i] === "'") { if (src[i + 1] === "'") { v += "'"; i += 2; continue; } i++; break; }
        v += src[i++];
      }
      out.push({ t: 'str', v, at });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: 'num', v: m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (c === '@') {
      const m = /^@@?\w+/.exec(src.slice(i));
      if (!m) throw new SqlExprError(`Unexpected '@' at ${i}`);
      out.push({ t: 'var', v: m[0].toUpperCase(), at: i });
      i += m[0].length;
      continue;
    }
    if (c === '[') {
      const e = src.indexOf(']', i);
      if (e < 0) throw new SqlExprError('Unterminated [identifier]');
      const raw = src.slice(i + 1, e);
      out.push({ t: 'id', v: raw.toUpperCase(), raw, at: i });
      i = e + 1;
      continue;
    }
    if (/[A-Za-z_#]/.test(c)) {
      const m = /^[A-Za-z_#][\w#$]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: 'id', v: m[0].toUpperCase(), raw: m[0], at: i });
      i += m[0].length;
      continue;
    }
    if (c === '.' && src.slice(i, i + 3) === '...') throw new SqlExprError('Expression was truncated ("...")');
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '!<', '!>'].includes(two)) { out.push({ t: 'op', v: two, at: i }); i += 2; continue; }
    if ('=<>+-*/%(),.'.includes(c)) { out.push({ t: 'op', v: c, at: i }); i++; continue; }
    throw new SqlExprError(`Unexpected character '${c}'`);
  }
  out.push({ t: 'eof', at: n });
  return out;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[], private src: string) {}

  private peek(o = 0): Tok { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  private next(): Tok { return this.toks[this.p++]; }
  private isKw(v: string, o = 0): boolean { const t = this.peek(o); return t.t === 'id' && t.v === v; }
  private isOp(v: string, o = 0): boolean { const t = this.peek(o); return t.t === 'op' && t.v === v; }
  private expectKw(v: string) { if (!this.isKw(v)) throw new SqlExprError(`Expected ${v} near "${this.near()}"`); this.p++; }
  private expectOp(v: string) { if (!this.isOp(v)) throw new SqlExprError(`Expected '${v}' near "${this.near()}"`); this.p++; }
  private near(): string { return this.src.slice(this.peek().at, this.peek().at + 30); }

  parseAll(): Expr {
    const e = this.or();
    if (this.peek().t !== 'eof') throw new SqlExprError(`Unexpected "${this.near()}"`);
    return e;
  }

  /** Skip a balanced (...) group starting at the current '(' and return its source text. */
  private skipGroup(): string {
    const start = this.peek().at;
    let depth = 0;
    do {
      const t = this.next();
      if (t.t === 'eof') throw new SqlExprError('Unbalanced parentheses');
      if (t.t === 'op' && t.v === '(') depth++;
      if (t.t === 'op' && t.v === ')') depth--;
    } while (depth > 0);
    return this.src.slice(start, this.toks[this.p - 1].at + 1);
  }

  private or(): Expr {
    const items = [this.and()];
    while (this.isKw('OR')) { this.p++; items.push(this.and()); }
    return items.length === 1 ? items[0] : { k: 'or', items };
  }

  private and(): Expr {
    const items = [this.not()];
    while (this.isKw('AND')) { this.p++; items.push(this.not()); }
    return items.length === 1 ? items[0] : { k: 'and', items };
  }

  private not(): Expr {
    if (this.isKw('NOT')) { this.p++; return { k: 'not', e: this.not() }; }
    return this.predicate();
  }

  private predicate(): Expr {
    if (this.isKw('EXISTS')) {
      const start = this.peek().at;
      this.p++;
      const body = this.isOp('(') ? this.skipGroup() : '';
      return { k: 'unsupported', text: `EXISTS ${body}`.slice(0, 200) || this.src.slice(start, start + 40), reason: 'EXISTS sub-query' };
    }
    const l = this.additive();
    const t = this.peek();
    if (t.t === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>=', '!<', '!>'].includes(t.v)) {
      this.p++;
      const op = t.v === '!<' ? '>=' : t.v === '!>' ? '<=' : t.v;
      return { k: 'bin', op, l, r: this.additive() };
    }
    if (this.isKw('IS')) {
      this.p++;
      const neg = this.isKw('NOT');
      if (neg) this.p++;
      this.expectKw('NULL');
      return { k: 'isnull', e: l, not: neg };
    }
    const neg = this.isKw('NOT') && (this.isKw('IN', 1) || this.isKw('BETWEEN', 1) || this.isKw('LIKE', 1));
    if (neg) this.p++;
    if (this.isKw('IN')) {
      this.p++;
      if (this.isOp('(') && this.isKw('SELECT', 1)) return { k: 'unsupported', text: `IN ${this.skipGroup()}`.slice(0, 200), reason: 'IN (sub-query)' };
      this.expectOp('(');
      const list: Expr[] = [];
      if (!this.isOp(')')) { list.push(this.or()); while (this.isOp(',')) { this.p++; list.push(this.or()); } }
      this.expectOp(')');
      return { k: 'in', e: l, list, not: neg };
    }
    if (this.isKw('BETWEEN')) {
      this.p++;
      const lo = this.additive();
      this.expectKw('AND');
      return { k: 'between', e: l, lo, hi: this.additive(), not: neg };
    }
    if (this.isKw('LIKE')) {
      this.p++;
      return { k: 'like', e: l, pattern: this.additive(), not: neg };
    }
    return l;
  }

  private additive(): Expr {
    let l = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) { const op = (this.next() as { v: string }).v; l = { k: 'bin', op, l, r: this.multiplicative() }; }
    return l;
  }

  private multiplicative(): Expr {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) { const op = (this.next() as { v: string }).v; l = { k: 'bin', op, l, r: this.unary() }; }
    return l;
  }

  private unary(): Expr {
    if (this.isOp('-')) { this.p++; return { k: 'neg', e: this.unary() }; }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.t === 'num') { this.p++; return { k: 'num', v: t.v }; }
    if (t.t === 'str') { this.p++; return { k: 'str', v: t.v }; }
    if (t.t === 'var') { this.p++; return { k: 'var', name: t.v }; }
    if (t.t === 'op' && t.v === '(') {
      if (this.isKw('SELECT', 1)) return { k: 'unsupported', text: this.skipGroup().slice(0, 200), reason: 'scalar sub-query' };
      this.p++;
      const e = this.or();
      this.expectOp(')');
      return e;
    }
    if (t.t === 'id') {
      if (t.v === 'NULL') { this.p++; return { k: 'null' }; }
      if (t.v === 'CASE') return this.caseExpr();
      if (KEYWORDS.has(t.v)) throw new SqlExprError(`Unexpected keyword ${t.v} near "${this.near()}"`);
      const parts = [t.v];
      this.p++;
      while (this.isOp('.') && this.peek(1).t === 'id') { this.p++; parts.push((this.next() as { v: string }).v); }
      if (this.isOp('(')) return this.call(parts[parts.length - 1]);
      return { k: 'col', parts: parts.map((x) => x.replace(/^#+/, '')) };
    }
    throw new SqlExprError(`Unexpected "${this.near()}"`);
  }

  private call(name: string): Expr {
    this.expectOp('(');
    const args: Expr[] = [];
    let typeArg: string | undefined;
    if (name === 'CAST') {
      args.push(this.or());
      this.expectKw('AS');
      typeArg = this.typeName();
    } else if (name === 'CONVERT' || name === 'TRY_CONVERT') {
      typeArg = this.typeName();
      this.expectOp(',');
      args.push(this.or());
      while (this.isOp(',')) { this.p++; args.push(this.or()); }
    } else if (!this.isOp(')')) {
      if (this.isKw('DISTINCT')) this.p++;
      if (this.isOp('*')) { this.p++; args.push({ k: 'col', parts: ['*'] }); }
      else args.push(this.or());
      while (this.isOp(',')) { this.p++; args.push(this.or()); }
    }
    this.expectOp(')');
    if (this.isKw('OVER')) {
      this.p++;
      const w = this.isOp('(') ? this.skipGroup() : '';
      return { k: 'unsupported', text: `${name}(...) OVER ${w}`.slice(0, 200), reason: 'window function' };
    }
    return { k: 'fn', name, args, typeArg };
  }

  private typeName(): string {
    const t = this.next();
    if (t.t !== 'id') throw new SqlExprError('Expected a data type');
    let s = t.v;
    if (this.isOp('(')) s += this.skipGroup().replace(/\s+/g, '');
    return s;
  }

  private caseExpr(): Expr {
    this.expectKw('CASE');
    const operand = this.isKw('WHEN') ? null : this.or();
    const whens: { when: Expr; then: Expr }[] = [];
    while (this.isKw('WHEN')) {
      this.p++;
      const when = this.or();
      this.expectKw('THEN');
      whens.push({ when, then: this.or() });
    }
    if (whens.length === 0) throw new SqlExprError('CASE without WHEN');
    let els: Expr | null = null;
    if (this.isKw('ELSE')) { this.p++; els = this.or(); }
    this.expectKw('END');
    return { k: 'case', operand, whens, else: els };
  }
}

/** Parse one expression or condition. Throws SqlExprError with a readable message on syntax it does not handle. */
export function parseSqlExpr(src: string): Expr {
  const text = src.trim();
  if (!text) throw new SqlExprError('Empty expression');
  return new Parser(tokenize(text), text).parseAll();
}

/** Every node, depth first (for collecting columns, variables and unsupported constructs). */
export function walkExpr(e: Expr, visit: (n: Expr) => void): void {
  visit(e);
  switch (e.k) {
    case 'fn': e.args.forEach((a) => walkExpr(a, visit)); break;
    case 'case':
      if (e.operand) walkExpr(e.operand, visit);
      e.whens.forEach((w) => { walkExpr(w.when, visit); walkExpr(w.then, visit); });
      if (e.else) walkExpr(e.else, visit);
      break;
    case 'bin': walkExpr(e.l, visit); walkExpr(e.r, visit); break;
    case 'and': case 'or': e.items.forEach((x) => walkExpr(x, visit)); break;
    case 'not': case 'neg': walkExpr(e.e, visit); break;
    case 'isnull': walkExpr(e.e, visit); break;
    case 'in': walkExpr(e.e, visit); e.list.forEach((x) => walkExpr(x, visit)); break;
    case 'between': walkExpr(e.e, visit); walkExpr(e.lo, visit); walkExpr(e.hi, visit); break;
    case 'like': walkExpr(e.e, visit); walkExpr(e.pattern, visit); break;
    default: break;
  }
}

/** Rebuild a tree bottom-up; `fn` may return a replacement for any node. */
export function mapExpr(e: Expr, fn: (n: Expr) => Expr): Expr {
  const m = (x: Expr) => mapExpr(x, fn);
  let out: Expr;
  switch (e.k) {
    case 'fn': out = { ...e, args: e.args.map(m) }; break;
    case 'case': out = { ...e, operand: e.operand ? m(e.operand) : null, whens: e.whens.map((w) => ({ when: m(w.when), then: m(w.then) })), else: e.else ? m(e.else) : null }; break;
    case 'bin': out = { ...e, l: m(e.l), r: m(e.r) }; break;
    case 'and': out = { k: 'and', items: e.items.map(m) }; break;
    case 'or': out = { k: 'or', items: e.items.map(m) }; break;
    case 'not': out = { k: 'not', e: m(e.e) }; break;
    case 'neg': out = { k: 'neg', e: m(e.e) }; break;
    case 'isnull': out = { ...e, e: m(e.e) }; break;
    case 'in': out = { ...e, e: m(e.e), list: e.list.map(m) }; break;
    case 'between': out = { ...e, e: m(e.e), lo: m(e.lo), hi: m(e.hi) }; break;
    case 'like': out = { ...e, e: m(e.e), pattern: m(e.pattern) }; break;
    default: out = e;
  }
  return fn(out);
}

/** SQL-style text of a tree, for showing the composed CrisMac logic. */
export function sqlText(e: Expr): string {
  const p = (x: Expr) => (x.k === 'bin' || x.k === 'and' || x.k === 'or' ? `(${sqlText(x)})` : sqlText(x));
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return `'${e.v.replace(/'/g, "''")}'`;
    case 'null': return 'NULL';
    case 'bool': return e.v ? '1=1' : '1=0';
    case 'col': return e.parts.join('.');
    case 'var': return e.name;
    case 'fn': return `${e.name}(${e.name === 'CAST' ? `${e.args.map(sqlText).join(', ')} AS ${e.typeArg ?? ''}` : [e.typeArg, ...e.args.map(sqlText)].filter(Boolean).join(', ')})`;
    case 'case': return `CASE${e.operand ? ` ${sqlText(e.operand)}` : ''} ${e.whens.map((w) => `WHEN ${sqlText(w.when)} THEN ${sqlText(w.then)}`).join(' ')}${e.else ? ` ELSE ${sqlText(e.else)}` : ''} END`;
    case 'bin': return `${p(e.l)} ${e.op} ${p(e.r)}`;
    case 'and': return e.items.map(p).join(' AND ');
    case 'or': return e.items.map(p).join(' OR ');
    case 'not': return `NOT ${p(e.e)}`;
    case 'neg': return `-${p(e.e)}`;
    case 'isnull': return `${p(e.e)} IS ${e.not ? 'NOT ' : ''}NULL`;
    case 'in': return `${p(e.e)} ${e.not ? 'NOT ' : ''}IN (${e.list.map(sqlText).join(', ')})`;
    case 'between': return `${p(e.e)} ${e.not ? 'NOT ' : ''}BETWEEN ${sqlText(e.lo)} AND ${sqlText(e.hi)}`;
    case 'like': return `${p(e.e)} ${e.not ? 'NOT ' : ''}LIKE ${sqlText(e.pattern)}`;
    case 'unsupported': return e.text;
  }
}
