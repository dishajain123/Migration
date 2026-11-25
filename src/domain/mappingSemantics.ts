import type { MappingRow, WorkbookModel } from '@/types';
import { memo } from './memo';
import { isFeeding, tableByName } from './selectors';
import type { ResolvedColumnMeta } from './profile';
import { parseType } from './typeUtils';

/*
 * Semantic helpers for Agent 4, derived ONLY from the workbook (nothing about any specific column pair is hard-coded):
 *  1. A vocabulary of the words the workbook's own column names are made of, used to split run-together names such as
 *     TIMEKEY (all caps, no separator) the same way "TimeKey" is split. Without it TIMEKEY was one opaque token.
 *  2. Calendar lookups: a table that has an integer key column and a column named "Date" (SysDayMatrix: TimeKey, Date)
 *     proves that columns named like that key are surrogate date keys that resolve to a real date through the lookup.
 *  3. Documented precedents: workbook mapping rows that already map a source column to a target column, or a date-key
 *     column to a DATE column, which are reused as evidence for new candidates.
 */

const MIN_VOCAB = 2;
const MIN_PART = 3;

export function tokens(name: string): Set<string> {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return new Set(spaced.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
}

/** Words the workbook's own column names are built from (only names that split into 2+ pieces contribute). */
export function vocabulary(model: WorkbookModel): Map<string, number> {
  return memo(model, 'sem:vocab', () => {
    const v = new Map<string, number>();
    for (const t of model.tables) {
      for (const c of t.columns) {
        const pieces = [...tokens(c.name)];
        if (pieces.length < 2) continue;
        for (const p of pieces) if (p.length >= MIN_PART && p.length <= 10 && !/^\d+$/.test(p)) v.set(p, (v.get(p) ?? 0) + 1);
      }
    }
    return v;
  });
}

/** Split a run-together token into vocabulary words (fewest parts, full coverage); otherwise return it unchanged. */
export function segmentToken(model: WorkbookModel, tok: string): string[] {
  const vocab = vocabulary(model);
  if (tok.length < 2 * MIN_PART || (vocab.get(tok) ?? 0) >= MIN_VOCAB) return [tok];
  const best: (string[] | null)[] = new Array(tok.length + 1).fill(null);
  best[0] = [];
  for (let i = MIN_PART; i <= tok.length; i++) {
    for (let j = 0; j <= i - MIN_PART; j++) {
      const prev = best[j];
      if (!prev) continue;
      const w = tok.slice(j, i);
      if ((vocab.get(w) ?? 0) < MIN_VOCAB) continue;
      if (!best[i] || prev.length + 1 < (best[i] as string[]).length) best[i] = [...prev, w];
    }
  }
  const out = best[tok.length];
  return out && out.length >= 2 ? out : [tok];
}

/** Lower-case name tokens with run-together words segmented using the workbook vocabulary. */
export function nameTokens(model: WorkbookModel, name: string): string[] {
  return [...tokens(name)].flatMap((t) => segmentToken(model, t));
}

export interface CalendarLookup { table: string; keyColumn: string; keyTokens: string[]; dateColumn: string }

/** Tables that pair an integer key column with a column named "Date" (e.g. SysDayMatrix: TimeKey int, Date datetime). */
export function calendarLookups(model: WorkbookModel): CalendarLookup[] {
  return memo(model, 'sem:calendars', () => {
    const out: CalendarLookup[] = [];
    for (const t of model.tables) {
      if (t.system === 'TRAQ') continue;
      const dateCol = t.columns.find((c) => parseType(c.dataType).family === 'date' && nameTokens(model, c.name).join('_') === 'date');
      if (!dateCol) continue;
      const keys = t.columns
        .filter((c) => parseType(c.dataType).family === 'number')
        .map((c) => ({ c, tk: nameTokens(model, c.name) }))
        .filter((x) => x.tk.includes('key') && !x.tk.includes('date'))
        .sort((a, b) => a.tk.length - b.tk.length);
      if (keys.length) out.push({ table: t.name, keyColumn: keys[0].c.name, keyTokens: keys[0].tk, dateColumn: dateCol.name });
    }
    return out;
  });
}

/**
 * The calendar lookup a column resolves through, if its name contains the lookup's key words (TimeKey, EffectiveFromTimeKey,
 * TIMEKEY) and its type is numeric. `allowUnknownType` is for callers that have no source type (rule conversion fallback).
 */
export function dateKeyLookup(model: WorkbookModel, name: string, dataType: string, allowUnknownType = false): CalendarLookup | undefined {
  const fam = parseType(dataType).family;
  if (fam !== 'number' && !(allowUnknownType && fam === 'unknown')) return undefined;
  const tk = new Set(nameTokens(model, name));
  return calendarLookups(model).find((c) => c.keyTokens.every((k) => tk.has(k)));
}

/** Replace the lookup's key words with "date": a date key is a stand-in for the date it resolves to. */
export function projectDateKey(model: WorkbookModel, name: string, lookup: CalendarLookup): string[] {
  const drop = new Set(lookup.keyTokens);
  return [...nameTokens(model, name).filter((t) => !drop.has(t)), 'date'];
}

export function dateKeyTransformation(lookup: CalendarLookup, srcTable: string, srcColumn: string): string {
  return `Resolve the calendar date through the workbook's lookup: ${lookup.table}.${lookup.dateColumn} where ${lookup.table}.${lookup.keyColumn} = ${srcTable ? `${srcTable}.` : ''}${srcColumn}. TRAQ stores a DATE, not the integer key. Confirm the lookup table is available in TRAQ.`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Documented feeding rows keyed `source>target` (names normalised), to reuse existing mappings as evidence. */
export function documentedPairs(model: WorkbookModel): Map<string, MappingRow> {
  return memo(model, 'sem:pairs', () => {
    const out = new Map<string, MappingRow>();
    for (const m of model.mappings) {
      if (!isFeeding(m)) continue;
      for (const sc of m.sourceColumns) {
        const k = `${norm(sc)}>${norm(m.targetColumn)}`;
        if (!out.has(k)) out.set(k, m);
      }
    }
    return out;
  });
}

/** Documented rows where a date-key column feeds a DATE column - the workbook's own precedent for key-to-date conversion. */
export function dateKeyPrecedents(model: WorkbookModel): MappingRow[] {
  return memo(model, 'sem:dateKeyPrecedents', () => {
    const tmap = tableByName(model);
    return model.mappings.filter((m) => {
      if (!isFeeding(m) || m.sourceColumns.length === 0) return false;
      const tType = m.targetType || tmap.get(m.targetTable)?.columns.find((c) => c.name === m.targetColumn)?.dataType || '';
      return parseType(tType).family === 'date' && m.sourceColumns.some((sc) => dateKeyLookup(model, sc, m.sourceType || 'int', true));
    });
  });
}

export const describeRow = (m: MappingRow): string => `${m.sheet} row ${m.rowNo}: ${m.sourceColumns.join(', ')} -> ${m.targetColumn} (${m.mapType || 'no map type'})`;

// ---- Optional profile / metadata signals (never used unless the user supplied a profile; see docs/PROFILE_INPUT.md) ----

export interface ProfileSimilarity { score: number; signals: string[] }

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'its', 'has', 'not', 'any', 'all', 'per', 'of', 'to', 'in', 'is', 'a', 'an', 'or', 'by', 'on']);
const wordSet = (s: string | undefined): Set<string> => new Set((s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const W_DESCRIPTION = 0.8;
const W_GLOSSARY = 0.9;
const W_VALUES = 0.9;
const W_STATS = 0.4;
const MIN_VALUES = 3;

/**
 * How alike two columns look from the OPTIONAL profile input: description wording, shared glossary term / synonym, value-set
 * overlap and coarse statistics. Each signal is 0..1 and they are combined as a noisy-OR, so independent evidence
 * accumulates but one weak signal cannot reach 1. Returns score 0 (no signals) when either column has no profile entry.
 */
export function profileSimilarity(target: ResolvedColumnMeta | undefined, source: ResolvedColumnMeta | undefined): ProfileSimilarity {
  if (!target || !source) return { score: 0, signals: [] };
  const signals: string[] = [];
  const parts: number[] = [];

  const d = jaccardSets(wordSet(target.description), wordSet(source.description));
  if (d >= 0.2) { parts.push(W_DESCRIPTION * Math.min(1, d * 1.5)); signals.push(`Descriptions share wording (${(d * 100).toFixed(0)}% overlap)`); }

  const shared = target.glossaryNames.filter((n) => source.glossaryNames.includes(n));
  if (shared.length) { parts.push(W_GLOSSARY); signals.push(`Same glossary term or synonym: "${shared[0]}"`); }

  if (target.valueSetName && source.valueSetName && target.valueSetName.toLowerCase() === source.valueSetName.toLowerCase()) {
    parts.push(W_VALUES); signals.push(`Both use value set "${target.valueSetName}"`);
  } else if (target.values.length >= MIN_VALUES && source.values.length >= MIN_VALUES) {
    const j = jaccardSets(new Set(target.values), new Set(source.values));
    if (j >= 0.3) { parts.push(W_VALUES * Math.min(1, j * 1.2)); signals.push(`Code values overlap (${(j * 100).toFixed(0)}% of the combined set)`); }
  }

  const ts = target.stats;
  const ss = source.stats;
  if (ts && ss) {
    let s = 0;
    const notes: string[] = [];
    if (typeof ts.min === 'number' && typeof ts.max === 'number' && typeof ss.min === 'number' && typeof ss.max === 'number') {
      const lo = Math.max(ts.min, ss.min); const hi = Math.min(ts.max, ss.max);
      const span = Math.max(ts.max, ss.max) - Math.min(ts.min, ss.min);
      const overlap = span > 0 ? Math.max(0, hi - lo) / span : lo === hi ? 1 : 0;
      if (overlap >= 0.5) { s += 0.5 * overlap; notes.push(`numeric ranges overlap ${(overlap * 100).toFixed(0)}%`); }
    }
    if (ts.distinctCount && ss.distinctCount) {
      const r = Math.min(ts.distinctCount, ss.distinctCount) / Math.max(ts.distinctCount, ss.distinctCount);
      if (r >= 0.8) { s += 0.5 * r; notes.push(`similar distinct counts (${ts.distinctCount} vs ${ss.distinctCount})`); }
    }
    if (ts.patterns?.length && ss.patterns?.length && ts.patterns.some((p) => ss.patterns?.includes(p))) { s += 0.4; notes.push('same value pattern'); }
    if (s > 0) { parts.push(W_STATS * Math.min(1, s)); signals.push(`Statistics agree: ${notes.join(', ')}`); }
  }

  const score = 1 - parts.reduce((acc, p) => acc * (1 - p), 1);
  return { score: parts.length ? score : 0, signals };
}
