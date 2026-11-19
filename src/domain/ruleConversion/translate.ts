import type { ColumnResolution, ConversionIssue, ParamResolution } from '@/types';
import { mapExpr, sqlText, type Expr } from './sqlExpr';

/*
 * CrisMac T-SQL expression tree -> TRAQ Derived Attribute expression text.
 *
 * Every construct emitted here appears in a live rule of the workbook's FPM_DA_RULES sheet ("EXPRESSION AS SAVED IN
 * THE APP"): "TABLE"."COLUMN" references, link chains "TABLE"."FK_X"."COLUMN", IF(c)THEN(a)ELSE(b), AND(...),
 * OR(...), (x)IN[...], ==, !=, >, >=, COALESCE, ISEMPTY, ISNOTEMPTY, TRIM, TODATE and DATEDIFF(later,earlier,"d").
 * Anything else is either rewritten into those forms (BETWEEN, NOT IN, IIF, NULLIF, NOT over comparisons) or kept and
 * flagged, so a reviewer always sees what was not backed by evidence.
 */

export interface ColumnRef { text: string; resolution: ColumnResolution | null; issue?: ConversionIssue }

export interface TranslateContext {
  /** TRAQ table the rule writes. */
  entity: string;
  /** Map a CrisMac column reference (identifier chain) to TRAQ text. */
  column: (parts: string[]) => ColumnRef;
  param: (name: string) => ParamResolution;
}

export interface Translation { text: string; issues: ConversionIssue[] }

const PREC: Record<string, number> = { '*': 3, '/': 3, '%': 3, '+': 2, '-': 2, '=': 1, '<>': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1 };
const CMP_OUT: Record<string, string> = { '=': '==', '<>': '!=', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };
const CMP_NEG: Record<string, string> = { '=': '<>', '<>': '=', '!=': '=', '<': '>=', '>': '<=', '<=': '>', '>=': '<' };
const DAY_PARTS = new Set(['DAY', 'DD', 'D', 'DY', 'DAYOFYEAR']);
const EVIDENCED_FUNCTIONS = new Set(['COALESCE', 'ISEMPTY', 'ISNOTEMPTY', 'TRIM', 'TODATE', 'DATEDIFF']);
const AGGREGATES = new Set(['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'STRING_AGG']);

/** Replace parameters that have a known value and simplify the constant parts (e.g. `@TIMEKEY > 26372` with @TIMEKEY = 26400). */
export function foldConstants(e: Expr, values: Record<string, string>): Expr {
  const lit = (x: Expr): number | string | null => (x.k === 'num' ? Number(x.v) : x.k === 'str' ? x.v : null);
  return mapExpr(e, (n) => {
    if (n.k === 'var') {
      const v = values[n.name];
      if (v === undefined || v === '') return n;
      return /^-?\d+(\.\d+)?$/.test(v.trim()) ? { k: 'num', v: v.trim() } : { k: 'str', v };
    }
    if (n.k === 'bin' && PREC[n.op] === 1) {
      const a = lit(n.l);
      const b = lit(n.r);
      if (a === null || b === null || typeof a !== typeof b) return n;
      const r = n.op === '=' ? a === b : n.op === '<>' || n.op === '!=' ? a !== b : n.op === '<' ? a < b : n.op === '>' ? a > b : n.op === '<=' ? a <= b : a >= b;
      return { k: 'bool', v: r };
    }
    if (n.k === 'and') {
      if (n.items.some((x) => x.k === 'bool' && !x.v)) return { k: 'bool', v: false };
      const rest = n.items.filter((x) => !(x.k === 'bool' && x.v));
      return rest.length === 0 ? { k: 'bool', v: true } : rest.length === 1 ? rest[0] : { k: 'and', items: rest };
    }
    if (n.k === 'or') {
      if (n.items.some((x) => x.k === 'bool' && x.v)) return { k: 'bool', v: true };
      const rest = n.items.filter((x) => !(x.k === 'bool' && !x.v));
      return rest.length === 0 ? { k: 'bool', v: false } : rest.length === 1 ? rest[0] : { k: 'or', items: rest };
    }
    if (n.k === 'not' && n.e.k === 'bool') return { k: 'bool', v: !n.e.v };
    if (n.k === 'case' && !n.operand) {
      const whens = n.whens.filter((w) => !(w.when.k === 'bool' && !w.when.v));
      if (whens.length && whens[0].when.k === 'bool' && whens[0].when.v) return whens[0].then;
      if (whens.length === 0) return n.else ?? { k: 'null' };
      return { ...n, whens };
    }
    return n;
  });
}

export function translate(e: Expr, ctx: TranslateContext): Translation {
  const issues: ConversionIssue[] = [];
  const seen = new Set<string>();
  const flag = (i: ConversionIssue) => { const k = `${i.code}|${i.message}`; if (!seen.has(k)) { seen.add(k); issues.push(i); } };

  const str = (v: string) => {
    if (v.includes('"')) flag({ severity: 'warning', code: 'QUOTE_IN_LITERAL', message: `The text literal '${v}' contains a double quote; the workbook shows no escape rule for TRAQ literals.` });
    return `"${v}"`;
  };

  const cond = (x: Expr): string => emit(x, 0);

  /** NOT pushed inwards, because no workbook rule uses a NOT function. */
  const negate = (x: Expr): Expr | null => {
    switch (x.k) {
      case 'bin': return CMP_NEG[x.op] ? { ...x, op: CMP_NEG[x.op] } : null;
      case 'isnull': return { ...x, not: !x.not };
      case 'in': return { ...x, not: !x.not };
      case 'between': return { ...x, not: !x.not };
      case 'like': return { ...x, not: !x.not };
      case 'and': { const parts = x.items.map(negate); return parts.every(Boolean) ? { k: 'or', items: parts as Expr[] } : null; }
      case 'or': { const parts = x.items.map(negate); return parts.every(Boolean) ? { k: 'and', items: parts as Expr[] } : null; }
      case 'not': return x.e;
      case 'bool': return { k: 'bool', v: !x.v };
      default: return null;
    }
  };

  const ifChain = (whens: { when: Expr; then: Expr }[], els: Expr | null, test: (w: Expr) => string): string => {
    const [first, ...rest] = whens;
    const tail = rest.length ? ifChain(rest, els, test) : emit(els ?? { k: 'null' }, 0);
    return `IF(${test(first.when)})THEN(${emit(first.then, 0)})ELSE(${tail})`;
  };

  const fn = (x: Extract<Expr, { k: 'fn' }>): string => {
    const a = x.args;
    const args = () => a.map((y) => emit(y, 0)).join(',');
    switch (x.name) {
      case 'ISNULL':
      case 'COALESCE':
        return `COALESCE(${args()})`;
      case 'NULLIF':
        if (a.length !== 2) break;
        return `IF(${emit(a[0], 1)}==${emit(a[1], 1)})THEN(NULL)ELSE(${emit(a[0], 0)})`;
      case 'IIF':
        if (a.length !== 3) break;
        return `IF(${cond(a[0])})THEN(${emit(a[1], 0)})ELSE(${emit(a[2], 0)})`;
      case 'DATEDIFF': {
        if (a.length !== 3) break;
        const part = a[0].k === 'col' ? a[0].parts.join('.') : sqlText(a[0]);
        if (!DAY_PARTS.has(part)) {
          flag({ severity: 'error', code: 'DATEDIFF_PART', message: `DATEDIFF(${part}, ...) has no documented TRAQ form; the workbook only shows day differences ("d").` });
          return `DATEDIFF(${emit(a[2], 0)},${emit(a[1], 0)},"${part.toLowerCase()}")`;
        }
        flag({ severity: 'info', code: 'DATEDIFF_ORDER', message: 'T-SQL DATEDIFF(DAY, earlier, later) was written as DATEDIFF(later, earlier, "d"), the argument order of the live IS_PUI_NPA rule in FPM_DA_RULES. The dd_export drafts use the opposite order; confirm once in TRAQ.' });
        return `DATEDIFF(${emit(a[2], 0)},${emit(a[1], 0)},"d")`;
      }
      case 'LTRIM':
      case 'RTRIM': {
        if (a.length !== 1) break;
        const inner = a[0];
        if (inner.k === 'fn' && (inner.name === 'LTRIM' || inner.name === 'RTRIM') && inner.name !== x.name && inner.args.length === 1) return `TRIM(${emit(inner.args[0], 0)})`;
        flag({ severity: 'warning', code: 'ONE_SIDED_TRIM', message: `${x.name} trims one side only; TRAQ's TRIM (used in RESTRUCTURE_TYPE) trims both.` });
        return `TRIM(${emit(inner, 0)})`;
      }
      case 'CAST':
      case 'CONVERT':
      case 'TRY_CONVERT': {
        const t = (x.typeArg ?? '').toUpperCase();
        const value = x.name === 'CAST' ? a[0] : a[0];
        if (/^(DATE|DATETIME|DATETIME2|SMALLDATETIME)/.test(t)) {
          flag({ severity: 'warning', code: 'CAST_DATE', message: `${x.name} to ${t} written as TODATE(...), the conversion BUSINESS_DATE uses; confirm the input format.` });
          return `TODATE(${emit(value, 0)})`;
        }
        flag({ severity: 'warning', code: 'CAST_DROPPED', message: `${x.name}(... ${t}) was dropped: TRAQ types the result through the rule's Data Type. Check rounding or truncation the cast performed.` });
        return emit(value, 0);
      }
      default:
        break;
    }
    if (AGGREGATES.has(x.name)) {
      flag({ severity: 'error', code: 'AGGREGATE', message: `${x.name}(...) aggregates rows; a Derived Attribute computes one row at a time. Model it as a separate aggregate table or link.` });
    } else if (x.name === 'GETDATE' || x.name === 'SYSDATETIME' || x.name === 'CURRENT_TIMESTAMP') {
      flag({ severity: 'error', code: 'SYSTEM_DATE', message: `${x.name}() is the clock time; TRAQ rules count to the run date (var.BUSINESS_DATE). Choose explicitly.` });
    } else if (!EVIDENCED_FUNCTIONS.has(x.name)) {
      flag({ severity: 'warning', code: 'FUNCTION_UNVERIFIED', message: `${x.name}(...) is kept as written; no workbook rule shows a TRAQ equivalent.` });
    }
    return `${x.name}(${[x.typeArg ? `"${x.typeArg}"` : '', args()].filter(Boolean).join(',')})`;
  };

  function emit(x: Expr, parent: number): string {
    switch (x.k) {
      case 'num': return x.v;
      case 'str': return str(x.v);
      case 'null': return 'NULL';
      case 'bool':
        flag({ severity: 'info', code: 'CONSTANT_CONDITION', message: 'A condition became constant after parameter values were applied.' });
        return x.v ? '1==1' : '1==0';
      case 'col': {
        if (x.parts.length === 1 && DAY_PARTS.has(x.parts[0])) return x.parts[0];
        const r = ctx.column(x.parts);
        if (r.issue) flag(r.issue);
        return r.text;
      }
      case 'var': {
        const p = ctx.param(x.name);
        if (p.status === 'unresolved') {
          flag({ severity: 'error', code: 'PARAM_UNRESOLVED', message: `${x.name} is a procedure parameter/variable with no TRAQ equivalent configured. Set a value or a TRAQ expression for it in the conversion settings.` });
          return `[[PARAM ${x.name}]]`;
        }
        if (p.status === 'mapped') flag({ severity: 'warning', code: 'PARAM_MAPPED', message: `${x.name} written as ${p.value} (${p.note}).` });
        return p.value;
      }
      case 'fn': return fn(x);
      case 'case':
        if (x.operand) {
          const op = x.operand;
          return ifChain(x.whens, x.else, (w) => `${emit(op, 1)}==${emit(w, 1)}`);
        }
        return ifChain(x.whens, x.else, cond);
      case 'bin': {
        const p = PREC[x.op] ?? 2;
        if (p === 1) return `${emit(x.l, 2)}${CMP_OUT[x.op]}${emit(x.r, 2)}`;
        const s = `${emit(x.l, p)}${x.op}${emit(x.r, p + 1)}`;
        return p < parent ? `(${s})` : s;
      }
      case 'and': return `AND(${x.items.map(cond).join(',')})`;
      case 'or': return `OR(${x.items.map(cond).join(',')})`;
      case 'not': {
        const n = negate(x.e);
        if (n) return emit(n, parent);
        flag({ severity: 'warning', code: 'NOT_FUNCTION', message: 'NOT over a non-comparison was kept as NOT(...); no workbook rule uses NOT.' });
        return `NOT(${cond(x.e)})`;
      }
      case 'neg': return `-${emit(x.e, 4)}`;
      case 'isnull': return `${x.not ? 'ISNOTEMPTY' : 'ISEMPTY'}(${emit(x.e, 0)})`;
      case 'in': {
        const target = emit(x.e, 0);
        const list = x.list.map((y) => emit(y, 0));
        if (x.not) return `AND(${list.map((v) => `${target}!=${v}`).join(',')})`;
        return `(${target})IN[${list.join(',')}]`;
      }
      case 'between': {
        const v = emit(x.e, 2);
        return x.not ? `OR(${v}<${emit(x.lo, 2)},${v}>${emit(x.hi, 2)})` : `AND(${v}>=${emit(x.lo, 2)},${v}<=${emit(x.hi, 2)})`;
      }
      case 'like':
        flag({ severity: 'error', code: 'LIKE', message: `LIKE ${sqlText(x.pattern)} has no documented TRAQ formula equivalent (decision tables use CONTAINS). Rewrite by hand.` });
        return `[[UNSUPPORTED ${sqlText(x)}]]`;
      case 'unsupported':
        flag({ severity: 'error', code: 'UNSUPPORTED', message: `${x.reason} cannot be expressed in a single-row TRAQ rule: ${x.text.slice(0, 120)}` });
        return `[[UNSUPPORTED ${x.reason}]]`;
    }
  }

  return { text: emit(e, 0), issues };
}
