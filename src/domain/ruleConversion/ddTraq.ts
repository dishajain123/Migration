import type { ColumnResolution, ConversionSettings } from '@/types';
import { parseType } from '../typeUtils';
import { DEFAULT_PARAM_MAPPINGS, MIRROR, PERIOD_ID_COLUMN, PERIOD_ID_TEMPLATE, RUN_DATE_TEMPLATE, TIMEKEY_COLUMN_RE } from './timeKey';

/*
 * dd_export expressions are written in the CrisMac model: T-SQL argument order, the procedure's run parameters (@TIMEKEY,
 * @ProcessDate) and TimeKey columns. TRAQ reads the same derivation language, but its model differs in three ways this
 * module corrects, and nothing else:
 *   1. DATEDIFF: T-SQL (earlier, later, "DAY") vs TRAQ (later, earlier, "d"), the order of the live IS_PUI_NPA rule in FPM_DA_RULES.
 *      Left alone the DPD would come out negative.
 *   2. Run date: TRAQ has no parameters; the run date is the rule variable BUSINESS_DATE. @ProcessDate / @ProcessingDate ARE
 *      that date (each procedure DECLAREs them from SysDayMatrix), so they map to it.
 *   3. @TIMEKEY, only where the mapping confirms what it is compared with:
 *        - a TRAQ SCD2 date column (RECORD_START_DATE / RECORD_END_DATE) -> compared with BUSINESS_DATE;
 *        - a TRAQ column that kept CrisMac's EffectiveFrom/ToTimeKey -> compared with "<Entity>"."PERIOD_ID";
 *      anything else (a number such as 26267, an unmapped or other column) stays as written and the rule waits, with the
 *      reason. There is NO guessed TimeKey-to-date calendar: the workbook has no SysDayMatrix rows.
 * Names inside "Table"."Column" references are replaced by the caller (ddMigrate.ts) from confirmed mappings.
 */

export interface DdTraqInput {
  /** TRAQ table the rule writes; it hosts the BUSINESS_DATE variable and the PERIOD_ID column. */
  entity: string;
  /** Upper-case column names of that TRAQ table in the workbook (to confirm PERIOD_ID exists on it). */
  entityColumns?: Set<string>;
  /** CrisMac `TABLE.COLUMN` (upper-case) -> resolution, for the references in this expression. */
  resolved: Map<string, ColumnResolution>;
  settings?: Pick<ConversionSettings, 'paramValues' | 'paramMappings'>;
}
export interface DdTraqResult {
  text: string;
  notes: string[];
  /** Things that block the rule from being ready: parameters or comparisons that could not be converted. */
  unresolved: { name: string; reason: string }[];
}

/** Functions and constructs shown by live FPM_DA_RULES rules (same list as translate.ts). */
const EVIDENCED = new Set(['COALESCE', 'ISEMPTY', 'ISNOTEMPTY', 'TRIM', 'TODATE', 'DATEDIFF', 'UPPER', 'LOWER', 'LEN', 'ROUND', 'REPLACE', 'CONCAT']);
const CONSTRUCTS = new Set(['IF', 'THEN', 'ELSE', 'ELSEIF', 'AND', 'OR']);
const OPS = '==|!=|<>|>=|<=|=|>|<';
const REF = '"[^"]+"\\."[^"]+"';
const SCD2_DATE_COLUMNS = new Set(['RECORD_START_DATE', 'RECORD_END_DATE']);

/** Same-length copy with the inside of every "..." replaced by `_`, so searches and bracket matching ignore literals and names. */
export const maskQuoted = (s: string): string => s.replace(/"[^"]*"/g, (m) => `"${'_'.repeat(m.length - 2)}"`);

function closeOf(mask: string, open: number): number {
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === '(') depth++;
    else if (mask[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTop(mask: string, text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

const normOp = (op: string) => (op === '=' ? '==' : op === '<>' ? '!=' : op);
const evalCmp = (a: number, op: string, b: number): boolean => {
  switch (normOp(op)) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    default: return a >= b;
  }
};

/** DATEDIFF(earlier, later, "DAY") -> DATEDIFF(later, earlier, "d"). Inner calls first. */
function swapDateDiff(expr: string, notes: string[]): string {
  let s = expr;
  const starts = Array.from(maskQuoted(s).matchAll(/\bDATEDIFF\s*\(/gi), (m) => m.index as number).reverse();
  let swapped = 0;
  let kept = 0;
  for (const at of starts) {
    const mask = maskQuoted(s);
    const open = mask.indexOf('(', at);
    const close = closeOf(mask, open);
    if (close < 0) { kept++; continue; }
    const args = splitTop(mask.slice(open + 1, close), s.slice(open + 1, close));
    const unit = (args[2] ?? '').trim().replace(/^"|"$/g, '');
    if (args.length === 3 && /^DAY$/i.test(unit)) {
      s = `${s.slice(0, open + 1)}${args[1].trim()}, ${args[0].trim()}, "d"${s.slice(close)}`;
      swapped++;
    } else if (!(args.length === 3 && unit === 'd')) kept++;
  }
  if (swapped) notes.push(`DATEDIFF argument order: ${swapped} call(s) written as DATEDIFF(later, earlier, "d"), the order of the live IS_PUI_NPA rule in FPM_DA_RULES. The dd_export drafts use T-SQL order (earlier, later, "DAY"), which TRAQ would read as a negative day count. Confirm once in TRAQ.`);
  if (kept) notes.push(`${kept} DATEDIFF call(s) with a unit other than "DAY" or an unexpected argument count were kept as written; TRAQ's workbook evidence only covers day differences.`);
  return s;
}

/** Replace pieces of `s` located by matches on its mask (same offsets). */
function replaceAt(s: string, edits: { index: number; length: number; text: string }[]): string {
  let out = '';
  let pos = 0;
  for (const e of edits.sort((a, b) => a.index - b.index)) {
    out += s.slice(pos, e.index) + e.text;
    pos = e.index + e.length;
  }
  return out + s.slice(pos);
}

export function traqifyExpression(expression: string, input: DdTraqInput): DdTraqResult {
  const notes: string[] = [];
  const unresolved: DdTraqResult['unresolved'] = [];
  const entity = input.entity || 'TABLE';
  const values = Object.fromEntries(Object.entries(input.settings?.paramValues ?? {}).map(([k, v]) => [k.toUpperCase(), v.trim()]));
  const mappings = { ...DEFAULT_PARAM_MAPPINGS, ...Object.fromEntries(Object.entries(input.settings?.paramMappings ?? {}).map(([k, v]) => [k.toUpperCase(), v])) };
  const bd = RUN_DATE_TEMPLATE.replace(/\{ENTITY\}/g, entity);
  const periodRef = PERIOD_ID_TEMPLATE.replace(/\{ENTITY\}/g, entity);
  const hasPeriodId = !!input.entityColumns?.has(PERIOD_ID_COLUMN);
  const knownKey = /^-?\d+$/.test(values['@TIMEKEY'] ?? '') ? Number(values['@TIMEKEY']) : null;

  // 1. DATEDIFF order and unit.
  let s = swapDateDiff(expression, notes);

  // 2. @TIMEKEY against a number. A known value (set by the user) evaluates the branch; otherwise it is NOT converted: nothing in the
  //    workbook says which date TimeKey 26267 is, so no calendar is guessed.
  {
    const mask = maskQuoted(s);
    const edits: { index: number; length: number; text: string }[] = [];
    const seen = new Set<string>();
    const lit = new RegExp(`@TIMEKEY\\s*(${OPS})\\s*(\\d+)(?![\\w.])`, 'gi');
    const rev = new RegExp(`(?<![\\w.@])(\\d+)\\s*(${OPS})\\s*@TIMEKEY\\b`, 'gi');
    const handle = (key: number, op: string, shown: string, index: number, length: number) => {
      if (knownKey !== null) edits.push({ index, length, text: evalCmp(knownKey, op, key) ? '1==1' : '1==0' });
      else seen.add(shown);
    };
    for (const m of mask.matchAll(lit)) handle(Number(m[2]), m[1], `@TIMEKEY ${normOp(m[1])} ${m[2]}`, m.index as number, m[0].length);
    for (const m of mask.matchAll(rev)) handle(Number(m[1]), MIRROR[m[2]] ?? m[2], `${m[1]} ${normOp(m[2])} @TIMEKEY`, m.index as number, m[0].length);
    if (edits.length) s = replaceAt(s, edits);
    if (seen.size) {
      unresolved.push({
        name: '@TIMEKEY',
        reason: `${Array.from(seen).slice(0, 3).join(', ')}${seen.size > 3 ? ', ...' : ''} compares the run's calendar key with a CrisMac TimeKey number. TRAQ has no TimeKey and the workbook has no SysDayMatrix rows to say which date that number is, so it is left as written rather than guessing a calendar. Give @TIMEKEY a known value in the conversion settings to evaluate the branches, or rewrite the cut-off against BUSINESS_DATE by hand.`,
      });
    }
  }

  // 3. "T"."C" <op> @TIMEKEY (and reversed), where C is CrisMac's EffectiveFromTimeKey / EffectiveToTimeKey. Converted only when the mapping
  //    confirms a TRAQ SCD2 date column or a TRAQ column that kept the TimeKey format.
  {
    const mask = maskQuoted(s);
    const edits: { index: number; length: number; text: string }[] = [];
    const colFirst = new RegExp(`(${REF})\\s*(${OPS})\\s*@TIMEKEY\\b`, 'gi');
    const keyFirst = new RegExp(`@TIMEKEY\\s*(${OPS})\\s*(${REF})`, 'gi');
    const fail = (name: string, reason: string) => { if (!unresolved.some((u) => u.reason === reason)) unresolved.push({ name, reason }); };
    const build = (real: string, opColFirst: string, index: number, length: number, whole: string) => {
      const r = /"([^"]+)"\."([^"]+)"/.exec(real);
      if (!r) return;
      const crismac = `${r[1]}.${r[2]}`;
      const chosen = input.resolved.get(crismac.toUpperCase())?.chosen;
      if (!chosen) return; // an unmapped column is reported by the caller
      const chosenCol = chosen.column.toUpperCase();
      const key = normOp(opColFirst);
      if (!TIMEKEY_COLUMN_RE.test(r[2])) {
        fail('@TIMEKEY', `${crismac} is compared with @TIMEKEY, but it is not CrisMac's EffectiveFromTimeKey / EffectiveToTimeKey, so nothing in the mapping confirms what to compare it with in TRAQ. Rewrite it against the run date by hand.`);
        return;
      }
      if (SCD2_DATE_COLUMNS.has(chosenCol) && parseType(chosen.dataType).family === 'date') {
        let op = MIRROR[opColFirst] ?? opColFirst; // BUSINESS_DATE - column <op'> 0
        if (chosenCol === 'RECORD_END_DATE') {
          // CrisMac's EffectiveToTimeKey is the last day in force (inclusive); TRAQ's RECORD_END_DATE is the day the next row starts (exclusive).
          const adj: Record<string, string> = { '>=': '<', '<': '>=' };
          if (!adj[key]) {
            fail('@TIMEKEY', `${crismac} ${key} @TIMEKEY cannot be mapped to ${chosen.table}.RECORD_END_DATE without moving the boundary: CrisMac's end is inclusive, TRAQ's is exclusive (a row is in force for RECORD_START_DATE <= d < RECORD_END_DATE). Only >= and < convert cleanly; rewrite this one by hand.`);
            return;
          }
          op = adj[key];
          notes.push(`${crismac} ${key} @TIMEKEY became ${chosen.table}.RECORD_END_DATE ${key === '>=' ? '>' : '<='} BUSINESS_DATE: CrisMac's EffectiveToTimeKey is inclusive, TRAQ's RECORD_END_DATE is exclusive.`);
        } else {
          notes.push(`${crismac} ${key} @TIMEKEY became a comparison of ${chosen.table}.${chosen.column} with BUSINESS_DATE.`);
        }
        // Date against date is written as a DATEDIFF day count: the live rules do this because the bare comparison fails in the engine.
        edits.push({ index, length, text: `DATEDIFF(${bd}, "${chosen.table}"."${chosen.column}", "d") ${normOp(op)} 0` });
        return;
      }
      if (TIMEKEY_COLUMN_RE.test(chosen.column)) {
        if (!hasPeriodId) {
          fail('@TIMEKEY', `${crismac} maps to ${chosen.table}.${chosen.column}, which keeps CrisMac's TimeKey format, but ${entity} has no ${PERIOD_ID_COLUMN} column in the workbook to compare it with. Map it to a RECORD_START_DATE / RECORD_END_DATE column, or rewrite by hand.`);
          return;
        }
        edits.push({ index, length, text: whole.replace(/@TIMEKEY/i, periodRef) });
        notes.push(`@TIMEKEY compared with ${chosen.table}.${chosen.column} was written as ${periodRef}. PERIOD_ID is the run's period (FPM_DA_RULES row 6: BUSINESS_DATE = TODATE(PERIOD_ID)); confirm ${chosen.column} holds the same kind of value as PERIOD_ID, since CrisMac's TimeKey is a calendar key.`);
        return;
      }
      fail('@TIMEKEY', `${crismac} is compared with @TIMEKEY, but its TRAQ column ${chosen.table}.${chosen.column} is neither RECORD_START_DATE / RECORD_END_DATE nor a column that kept the TimeKey format. Rewrite the comparison against the run date by hand.`);
    };
    for (const m of mask.matchAll(colFirst)) {
      const index = m.index as number;
      build(s.slice(index, index + m[1].length), m[2], index, m[0].length, s.slice(index, index + m[0].length));
    }
    for (const m of mask.matchAll(keyFirst)) {
      const index = m.index as number;
      build(s.slice(index + m[0].length - m[2].length, index + m[0].length), MIRROR[m[1]] ?? m[1], index, m[0].length, s.slice(index, index + m[0].length));
    }
    if (edits.length) s = replaceAt(s, edits);
  }

  // 4. Remaining parameters / variables.
  {
    const mask = maskQuoted(s);
    const edits: { index: number; length: number; text: string }[] = [];
    const reported = new Set<string>();
    for (const m of mask.matchAll(/@@?\w+/g)) {
      const name = m[0].toUpperCase();
      const index = m.index as number;
      const v = values[name];
      if (v) {
        edits.push({ index, length: m[0].length, text: /^-?\d+(\.\d+)?$/.test(v) ? v : `"${v}"` });
        if (!reported.has(name)) { reported.add(name); notes.push(`${name} replaced by the value ${v} set in the conversion settings.`); }
        continue;
      }
      const mapped = mappings[name]?.trim();
      if (mapped) {
        const shown = mapped.replace(/\{ENTITY\}/g, entity);
        edits.push({ index, length: m[0].length, text: shown });
        if (!reported.has(name)) {
          reported.add(name);
          notes.push(DEFAULT_PARAM_MAPPINGS[name] === mapped
            ? `${name} written as ${shown}: the procedure sets it from SysDayMatrix at TimeKey = @TIMEKEY, which is the run date BUSINESS_DATE (FPM_DA_RULES row 6, defined on FCT_PRODUCT_MASTER).`
            : `${name} written as ${shown} (mapping set in the conversion settings).`);
        }
        continue;
      }
      // A TimeKey comparison already reported in steps 2-3 is not reported a second time here.
      if (!reported.has(name) && !(name === '@TIMEKEY' && unresolved.some((u) => u.name === '@TIMEKEY'))) {
        reported.add(name);
        unresolved.push({
          name,
          reason: name === '@TIMEKEY'
            ? '@TIMEKEY is a calendar key. It is only converted when compared with CrisMac\'s EffectiveFromTimeKey / EffectiveToTimeKey and the mapping confirms the TRAQ column; here it is used differently, so write it against the run date (BUSINESS_DATE) by hand, or set a value in the conversion settings.'
            : `${name} is a procedure parameter or variable with no TRAQ equivalent. Set a value, or a TRAQ expression, for it in the conversion settings.`,
        });
      }
    }
    if (edits.length) s = replaceAt(s, edits);
  }

  // 5. Constructs and functions no live TRAQ rule shows: said, not hidden.
  const mask = maskQuoted(s);
  const odd = new Set<string>();
  for (const m of mask.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const n = m[1].toUpperCase();
    if (!CONSTRUCTS.has(n) && !EVIDENCED.has(n)) odd.add(n);
  }
  if (odd.size) notes.push(`${Array.from(odd).sort().join(', ')}(...) is not used by any live rule in FPM_DA_RULES; kept as written - confirm TRAQ's rule engine accepts it.`);
  if (/\bELSEIF\s*\(/i.test(mask)) notes.push('ELSEIF(...) is kept as written; the live FPM_DA_RULES rules nest an IF inside ELSE(...) instead - confirm TRAQ accepts ELSEIF.');

  return { text: s, notes: Array.from(new Set(notes)), unresolved };
}
