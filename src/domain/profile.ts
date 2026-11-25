import Papa from 'papaparse';
import type { ColumnProfileStats, GlossaryTerm, ProfileColumnMeta, ProfileMetadata, ValueSet } from '@/types/profile';
import { memo } from './memo';

/*
 * Parsing and lookup for the OPTIONAL profile/metadata input (docs/PROFILE_INPUT.md). Strict: anything that does not match
 * the documented shape is reported and skipped, never guessed. Pure functions, no I/O.
 */

export interface ProfileParseResult { profile: ProfileMetadata | null; errors: string[]; warnings: string[] }

const MAX_VALUES = 200;
const MAX_TEXT = 500;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const up = (s: string) => s.trim().toUpperCase();
const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strList = (v: unknown, max = MAX_VALUES): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim().slice(0, 100)).filter(Boolean).slice(0, max);
  return out.length ? out : undefined;
};

/** FNV-1a over the canonical JSON: a stable id for caches. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function stats(raw: unknown, where: string, errors: string[]): ColumnProfileStats | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { errors.push(`${where}: "profile" must be an object.`); return undefined; }
  const out: ColumnProfileStats = {};
  const num = (k: 'rowCount' | 'distinctCount' | 'nullRate') => {
    const v = raw[k];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (k !== 'nullRate' && !Number.isInteger(v)) || (k === 'nullRate' && v > 1)) {
      errors.push(`${where}: "${k}" must be ${k === 'nullRate' ? 'a number between 0 and 1 (a fraction, not a percentage)' : 'a non-negative integer'}.`);
      return;
    }
    out[k] = v;
  };
  num('rowCount'); num('distinctCount'); num('nullRate');
  for (const k of ['min', 'max'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 100);
    else if (v !== undefined) errors.push(`${where}: "${k}" must be a number or a string.`);
  }
  const top = strList(raw.topValues, 50);
  if (top) out.topValues = top;
  const pat = strList(raw.patterns, 20);
  if (pat) out.patterns = pat;
  return Object.keys(out).length ? out : undefined;
}

function finish(label: string | undefined, generatedAt: string | undefined, share: boolean, columns: ProfileColumnMeta[], glossary: GlossaryTerm[], valueSets: ValueSet[], errors: string[], warnings: string[]): ProfileParseResult {
  if (columns.length === 0 && glossary.length === 0 && valueSets.length === 0) {
    return { profile: null, errors: errors.length ? errors : ['The file contains no usable columns, glossary terms or value sets.'], warnings };
  }
  const body = { label, generatedAt, shareSampleValuesWithAi: share, columns, glossary, valueSets };
  const known = new Set(valueSets.map((v) => up(v.name)));
  for (const c of columns) if (c.valueSet && !known.has(up(c.valueSet))) warnings.push(`${c.table}.${c.column}: value set "${c.valueSet}" is not defined in "valueSets".`);
  const terms = new Set(glossary.map((g) => up(g.term)));
  for (const c of columns) if (c.glossaryTerm && !terms.has(up(c.glossaryTerm))) warnings.push(`${c.table}.${c.column}: glossary term "${c.glossaryTerm}" is not defined in "glossary".`);
  return { profile: { version: 1, id: `profile:${hash(JSON.stringify(body))}`, ...body }, errors, warnings };
}

export function parseProfileJson(text: string): ProfileParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { profile: null, errors: ['Not valid JSON.'], warnings }; }
  if (!isObj(raw)) return { profile: null, errors: ['The top level must be a JSON object.'], warnings };
  if (raw.version !== 1) errors.push('"version" must be 1.');
  const columns: ProfileColumnMeta[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw.columns) ? raw.columns : []).forEach((c: unknown, i) => {
    const where = `columns[${i}]`;
    if (!isObj(c)) { errors.push(`${where}: must be an object.`); return; }
    const table = str(c.table, 200); const column = str(c.column, 200);
    if (!table || !column) { errors.push(`${where}: "table" and "column" are required.`); return; }
    const key = `${up(table)}::${up(column)}`;
    if (seen.has(key)) { warnings.push(`${where}: ${table}.${column} appears more than once; the later entry is ignored.`); return; }
    seen.add(key);
    const meta: ProfileColumnMeta = { table, column };
    const d = str(c.description); if (d) meta.description = d;
    const g = str(c.glossaryTerm, 200); if (g) meta.glossaryTerm = g;
    const v = str(c.valueSet, 200); if (v) meta.valueSet = v;
    const s = stats(c.profile, `${where} (${table}.${column})`, errors); if (s) meta.profile = s;
    columns.push(meta);
  });
  const glossary: GlossaryTerm[] = [];
  (Array.isArray(raw.glossary) ? raw.glossary : []).forEach((g: unknown, i) => {
    if (!isObj(g) || !str(g.term, 200)) { errors.push(`glossary[${i}]: "term" is required.`); return; }
    glossary.push({ term: str(g.term, 200) as string, definition: str(g.definition), synonyms: strList(g.synonyms, 30) });
  });
  const valueSets: ValueSet[] = [];
  (Array.isArray(raw.valueSets) ? raw.valueSets : []).forEach((v: unknown, i) => {
    const values = isObj(v) ? strList(v.values) : undefined;
    if (!isObj(v) || !str(v.name, 200) || !values) { errors.push(`valueSets[${i}]: "name" and a non-empty "values" array are required.`); return; }
    valueSets.push({ name: str(v.name, 200) as string, values });
  });
  if (errors.some((e) => e.startsWith('"version"'))) return { profile: null, errors, warnings };
  return finish(str(raw.label, 120), str(raw.generatedAt, 60), raw.shareSampleValuesWithAi === true, columns, glossary, valueSets, errors, warnings);
}

const CSV_COLUMNS = ['table', 'column', 'description', 'glossary_term', 'glossary_definition', 'value_set', 'value_set_values', 'row_count', 'distinct_count', 'null_rate', 'min', 'max', 'top_values', 'patterns'];
export const PROFILE_CSV_HEADER = CSV_COLUMNS.join(',');

/** CSV form: one row per column; `|` separates list values. Unknown headers are reported, not ignored silently. */
export function parseProfileCsv(text: string, shareSampleValuesWithAi = false): ProfileParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const headers = parsed.meta.fields ?? [];
  if (!headers.includes('table') || !headers.includes('column')) return { profile: null, errors: ['The CSV needs "table" and "column" header columns.'], warnings };
  for (const h of headers) if (!CSV_COLUMNS.includes(h)) warnings.push(`Unknown CSV column "${h}" is ignored.`);
  const list = (s: string | undefined) => (s ? s.split('|').map((x) => x.trim()).filter(Boolean) : []);
  const columns: ProfileColumnMeta[] = [];
  const glossary = new Map<string, GlossaryTerm>();
  const valueSets = new Map<string, ValueSet>();
  const seen = new Set<string>();
  parsed.data.forEach((r, i) => {
    const where = `row ${i + 2}`;
    const table = r.table?.trim(); const column = r.column?.trim();
    if (!table || !column) { errors.push(`${where}: "table" and "column" are required.`); return; }
    const key = `${up(table)}::${up(column)}`;
    if (seen.has(key)) { warnings.push(`${where}: ${table}.${column} appears more than once; ignored.`); return; }
    seen.add(key);
    const raw: Record<string, unknown> = {};
    const n = (k: string) => (r[k]?.trim() ? Number(r[k]) : undefined);
    const numOrStr = (k: string) => { const t = r[k]?.trim(); if (!t) return undefined; return Number.isFinite(Number(t)) ? Number(t) : t; };
    Object.assign(raw, { rowCount: n('row_count'), distinctCount: n('distinct_count'), nullRate: n('null_rate'), min: numOrStr('min'), max: numOrStr('max'), topValues: list(r.top_values), patterns: list(r.patterns) });
    for (const k of Object.keys(raw)) if (raw[k] === undefined || (Array.isArray(raw[k]) && (raw[k] as unknown[]).length === 0)) delete raw[k];
    const meta: ProfileColumnMeta = { table, column };
    if (r.description?.trim()) meta.description = r.description.trim().slice(0, MAX_TEXT);
    if (r.glossary_term?.trim()) {
      meta.glossaryTerm = r.glossary_term.trim();
      if (!glossary.has(up(meta.glossaryTerm))) glossary.set(up(meta.glossaryTerm), { term: meta.glossaryTerm, definition: r.glossary_definition?.trim() || undefined });
    }
    if (r.value_set?.trim()) {
      meta.valueSet = r.value_set.trim();
      const vals = list(r.value_set_values);
      if (vals.length && !valueSets.has(up(meta.valueSet))) valueSets.set(up(meta.valueSet), { name: meta.valueSet, values: vals.slice(0, MAX_VALUES) });
    }
    const s = stats(Object.keys(raw).length ? raw : undefined, `${where} (${table}.${column})`, errors);
    if (s) meta.profile = s;
    columns.push(meta);
  });
  return finish(undefined, undefined, shareSampleValuesWithAi, columns, [...glossary.values()], [...valueSets.values()], errors, warnings);
}

/** Pick the parser from the file name / content. */
export function parseProfileFile(fileName: string, text: string, shareSampleValuesWithAi = false): ProfileParseResult {
  const t = text.trimStart();
  if (/\.json$/i.test(fileName) || t.startsWith('{')) return parseProfileJson(text);
  return parseProfileCsv(text, shareSampleValuesWithAi);
}

// ---- lookup ----
export interface ResolvedColumnMeta {
  table: string; column: string;
  description?: string;
  glossaryTerm?: string;
  /** Lower-case term and synonyms. */
  glossaryNames: string[];
  valueSetName?: string;
  /** Lower-case values from the value set and the profile's top values. */
  values: string[];
  stats?: ColumnProfileStats;
}

export const profileKey = (table: string, column: string) => `${up(table)}::${up(column)}`;

export function profileIndex(profile: ProfileMetadata): Map<string, ResolvedColumnMeta> {
  return memo(profile, 'profile:index', () => {
    const terms = new Map(profile.glossary.map((g) => [up(g.term), g]));
    const sets = new Map(profile.valueSets.map((v) => [up(v.name), v]));
    const out = new Map<string, ResolvedColumnMeta>();
    for (const c of profile.columns) {
      const term = c.glossaryTerm ? terms.get(up(c.glossaryTerm)) : undefined;
      const set = c.valueSet ? sets.get(up(c.valueSet)) : undefined;
      out.set(profileKey(c.table, c.column), {
        table: c.table, column: c.column, description: c.description, glossaryTerm: c.glossaryTerm,
        glossaryNames: c.glossaryTerm ? [c.glossaryTerm, ...(term?.synonyms ?? [])].map((x) => x.toLowerCase()) : [],
        valueSetName: c.valueSet,
        values: [...(set?.values ?? []), ...(c.profile?.topValues ?? [])].map((x) => x.toLowerCase()),
        stats: c.profile,
      });
    }
    return out;
  });
}

export const profileFor = (profile: ProfileMetadata | undefined, table: string, column: string): ResolvedColumnMeta | undefined =>
  profile ? profileIndex(profile).get(profileKey(table, column)) : undefined;

/** One-line summary for prompts and embeddings. Sample values appear only with the explicit consent flag. */
export function describeProfile(profile: ProfileMetadata, table: string, column: string): string {
  const m = profileFor(profile, table, column);
  if (!m) return '';
  const parts: string[] = [];
  if (m.description) parts.push(`description: ${m.description}`);
  if (m.glossaryTerm) parts.push(`glossary: ${m.glossaryTerm}`);
  if (m.valueSetName) parts.push(`value set: ${m.valueSetName}`);
  const s = m.stats;
  if (s) {
    if (s.distinctCount !== undefined) parts.push(`distinct ${s.distinctCount}`);
    if (s.nullRate !== undefined) parts.push(`null rate ${(s.nullRate * 100).toFixed(1)}%`);
    if (s.min !== undefined || s.max !== undefined) parts.push(`range ${s.min ?? '?'}..${s.max ?? '?'}`);
    if (profile.shareSampleValuesWithAi) {
      if (s.topValues?.length) parts.push(`top values: ${s.topValues.slice(0, 8).join(', ')}`);
      if (s.patterns?.length) parts.push(`patterns: ${s.patterns.slice(0, 4).join(', ')}`);
    }
  }
  return parts.join('; ');
}
