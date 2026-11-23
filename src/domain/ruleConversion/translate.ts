import type { ColumnResolution, ConversionIssue, ParamResolution } from '@/types';
import { mapExpr, sqlText, type Expr } from './sqlExpr';

/*
 * CrisMac T-SQL expression tree -> TRAQ Derived Attribute expression text.
 *
 * Every construct emitted here appears in a live rule of the workbook's FPM_DA_RULES sheet ("EXPRESSION AS SAVED IN
 * THE APP"): "TABLE"."COLUMN" references, link chains "TABLE"."FK_X"."COLUMN", IF(c)THEN(a)ELSE(b), AND(...),
 * OR(...), (x)IN[...], ==, !=, >, >=, COALESCE, ISEMPTY, ISNOTEMPTY, TRIM, TODATE and DATEDIFF(later,earlier,"d").
 * Anything else is either rewritten into those forms (IIF, NULLIF, NOT over comparisons) or into a function/operator
 * documented in the TRAQ Derived Attributes rule-engine reference (NOTIN[...], BETWEEN[...], CONTAINS/BEGINSWITH/
 * ENDSWITH/REGEX for LIKE, SUBSTR, UPPER, LOWER, LEN, ROUND, REPLACE, CONCAT, ADDDAY, DATEPART), or kept and flagged,
 * so a reviewer always sees what was not backed by evidence.
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
// Same name and argument order in both languages (TRAQ Derived Attributes rule reference, Functions palette).
const EVIDENCED_FUNCTIONS = new Set(['COALESCE', 'ISEMPTY', 'ISNOTEMPTY', 'TRIM', 'TODATE', 'DATEDIFF', 'UPPER', 'LOWER', 'LEN', 'ROUND', 'REPLACE', 'CONCAT']);
const AGGREGATES = new Set(['SUM', 'COUNT', 'AVG', 'MAX', 'MIN', 'STRING_AGG']);
const SCD2_BOUNDARY_RE = /EFFECTIVE_?(?:FROM|TO)TIMEKEY|RECORD_(?:START|END)_DATE/i;

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

  /** A bare column, variable or literal - the only argument shapes the workbook evidences for ISEMPTY/ISNOTEMPTY/DATEDIFF. */
  const isSimpleArg = (x: Expr): boolean => x.k === 'col' || x.k === 'var' || x.k === 'num' || x.k === 'str' || x.k === 'null';

  /** Does this expression read a date/datetime-typed TRAQ column (not a day-part token like DAY)? */
  const isDateColumn = (x: Expr): boolean => {
    if (x.k !== 'col') return false;
    if (x.parts.length === 1 && DAY_PARTS.has(x.parts[0])) return false;
    const r = ctx.column(x.parts);
    return /DATE|TIMEKEY|TIMESTAMP/i.test(r.resolution?.chosen?.dataType ?? '');
  };

  /** Does this expression read an SCD2 effective/record-date boundary column? CrisMac closes the prior row the day
   * before the new one starts (inclusive end); TRAQ's RECORD_START_DATE/RECORD_END_DATE closes on the business date
   * itself and reads start <= d < end (exclusive end) - a documented semantic shift, not something this conversion
   * adjusts automatically. */
  const isScd2Boundary = (x: Expr): boolean => {
    if (x.k !== 'col') return false;
    const last = x.parts[x.parts.length - 1] ?? '';
    const chosenCol = ctx.column(x.parts).resolution?.chosen?.column ?? '';
    return SCD2_BOUNDARY_RE.test(last) || SCD2_BOUNDARY_RE.test(chosenCol);
  };

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
        if (!isSimpleArg(a[1]) || !isSimpleArg(a[2])) {
          flag({ severity: 'warning', code: 'ARG_NOT_SIMPLE', message: "DATEDIFF's date arguments are computed expressions, not bare columns or variables; TRAQ's documented form takes only a column or var reference here - a computed value may need a Temporary variable first." });
        }
        const part = a[0].k === 'col' ? a[0].parts.join('.') : sqlText(a[0]);
        if (!DAY_PARTS.has(part)) {
          flag({ severity: 'error', code: 'DATEDIFF_PART', message: `DATEDIFF(${part}, ...) has no documented TRAQ form; the workbook only shows day differences ("d").` });
          return `DATEDIFF(${emit(a[2], 0)},${emit(a[1], 0)},"${part.toLowerCase()}")`;
        }
        flag({ severity: 'info', code: 'DATEDIFF_ORDER', message: 'T-SQL DATEDIFF(DAY, earlier, later) was written as DATEDIFF(later, earlier, "d"), the argument order of the live IS_PUI_NPA rule in FPM_DA_RULES. The dd_export drafts use the opposite order; confirm once in TRAQ.' });
        return `DATEDIFF(${emit(a[2], 0)},${emit(a[1], 0)},"d")`;
      }
      case 'SUBSTRING':
        if (a.length !== 3) break;
        return `SUBSTR(${args()})`;
      case 'DATEADD': {
        if (a.length !== 3) break;
        const part = a[0].k === 'col' ? a[0].parts.join('.') : sqlText(a[0]);
        if (DAY_PARTS.has(part) && a[1].k === 'num') return `ADDDAY(${emit(a[2], 0)},"${a[1].v}")`;
        flag({ severity: 'warning', code: 'ADDDAY_UNVERIFIED', message: `DATEADD(${part}, ...) kept as written; TRAQ's documented ADDDAY(date,"n") only covers a whole-day offset given as a literal number, so this form needs manual review.` });
        return `DATEADD(${part},${emit(a[1], 0)},${emit(a[2], 0)})`;
      }
      case 'DATEPART': {
        if (a.length !== 2) break;
        const part = a[0].k === 'col' ? a[0].parts.join('.') : sqlText(a[0]);
        flag({ severity: 'warning', code: 'DATEPART_UNVERIFIED', message: `DATEPART reordered to TRAQ's DATEPART(date,part) form; TRAQ's part-name vocabulary for this function is not documented in the workbook or the app's catalog, so "${part}" is passed through unverified - confirm in TRAQ before approving.` });
        return `DATEPART(${emit(a[1], 0)},"${part.toLowerCase()}")`;
      }
      case 'FLOOR':
      case 'CEILING':
      case 'CEIL': {
        const traqName = x.name === 'CEILING' ? 'CEIL' : x.name;
        flag({ severity: 'warning', code: 'FUNCTION_ARITY', message: `TRAQ's ${traqName}(...) takes two arguments (value, and a second operand whose meaning is not documented); the one-argument T-SQL form was kept as written - confirm the correct TRAQ form by hand.` });
        return `${traqName}(${args()})`;
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
        if (p === 1) {
          if (isDateColumn(x.l) && isDateColumn(x.r)) {
            flag({ severity: 'warning', code: 'DATE_COMPARISON', message: 'Both sides are date-typed TRAQ columns compared directly. The TRAQ Derived Attribute rule engine accepts this at save time but can fail when the rule actually runs; dates must be compared through DATEDIFF(...), typically guarded by ISEMPTY(...)/COALESCE(...). Rewrite by hand before approving.' });
          }
          if (isScd2Boundary(x.l) || isScd2Boundary(x.r)) {
            flag({ severity: 'info', code: 'SCD2_BOUNDARY', message: "This comparison touches an SCD2 effective/record-date boundary. CrisMac's EffectiveToTimeKey convention closes a row the day before the new one starts (inclusive end); TRAQ's RECORD_START_DATE/RECORD_END_DATE convention closes on the business date itself, read as start <= d < end (exclusive end). Confirm the boundary direction by hand - this is a documented semantic difference, not something this conversion adjusts automatically." });
          }
          return `${emit(x.l, 2)}${CMP_OUT[x.op]}${emit(x.r, 2)}`;
        }
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
      case 'isnull': {
        if (!isSimpleArg(x.e)) {
          flag({ severity: 'warning', code: 'ARG_NOT_SIMPLE', message: `${x.not ? 'ISNOTEMPTY' : 'ISEMPTY'}'s argument is a computed expression, not a bare column or variable; TRAQ's documented form takes only a column or var reference here - a computed value may need a Temporary variable first.` });
        }
        return `${x.not ? 'ISNOTEMPTY' : 'ISEMPTY'}(${emit(x.e, 0)})`;
      }
      case 'in': {
        const target = emit(x.e, 0);
        const list = x.list.map((y) => emit(y, 0));
        if (x.not) return `(${target})NOTIN[${list.join(',')}]`;
        return `(${target})IN[${list.join(',')}]`;
      }
      case 'between': {
        const dateInvolved = isDateColumn(x.e);
        if (dateInvolved) {
          flag({ severity: 'warning', code: 'DATE_COMPARISON', message: 'BETWEEN on a date-typed TRAQ column was expanded to AND(...) range comparisons rather than the native BETWEEN[...] operator, since nothing in the workbook or the rule-engine reference confirms native BETWEEN is exempt from the direct-date-comparison failure documented elsewhere. Confirm by hand, or rewrite using DATEDIFF(...) guards.' });
        }
        const v = emit(x.e, 2);
        if (x.not) return `OR(${v}<${emit(x.lo, 2)},${v}>${emit(x.hi, 2)})`;
        if (!dateInvolved) return `(${v})BETWEEN[${emit(x.lo, 2)},${emit(x.hi, 2)}]`;
        return `AND(${v}>=${emit(x.lo, 2)},${v}<=${emit(x.hi, 2)})`;
      }
      case 'like': {
        if (x.pattern.k !== 'str') {
          flag({ severity: 'error', code: 'LIKE_DYNAMIC', message: 'LIKE pattern is not a literal; TRAQ has no documented way to express a computed pattern. Rewrite by hand.' });
          return `[[UNSUPPORTED ${sqlText(x)}]]`;
        }
        const pat = x.pattern.v;
        const target = emit(x.e, 0);
        const leading = pat.startsWith('%');
        const trailing = pat.endsWith('%') && pat.length > 1;
        const bare = pat.replace(/^%/, '').replace(/%$/, '');
        const innerWildcard = /[%_]/.test(bare);
        let out: string;
        if (!innerWildcard && leading && trailing) out = `CONTAINS(${target},${str(bare)})`;
        else if (!innerWildcard && trailing && !leading) out = `BEGINSWITH(${target},${str(bare)})`;
        else if (!innerWildcard && leading && !trailing) out = `ENDSWITH(${target},${str(bare)})`;
        else {
          flag({ severity: 'warning', code: 'LIKE_REGEX', message: `LIKE ${sqlText(x.pattern)} has internal or mixed wildcards; written as REGEX(...), TRAQ's documented pattern-match function. The wildcard-to-regex escaping is not evidenced in the workbook - confirm the pattern syntax in TRAQ before approving.` });
          out = `REGEX(${target},${str(pat)})`;
        }
        if (x.not) {
          flag({ severity: 'info', code: 'LIKE_NEGATED', message: 'NOT LIKE written as NOT(...); only CONTAINS/DOESNOTCONTAINS is a documented native negation pair, so this wraps the positive form rather than guessing a DOESNOTCONTAINS/NOTBEGINSWITH/NOTENDSWITH equivalent.' });
          return `NOT(${out})`;
        }
        return out;
      }
      case 'unsupported':
        flag({ severity: 'error', code: 'UNSUPPORTED', message: `${x.reason} cannot be expressed in a single-row TRAQ rule: ${x.text.slice(0, 120)}` });
        return `[[UNSUPPORTED ${x.reason}]]`;
    }
  }

  return { text: emit(e, 0), issues };
}
