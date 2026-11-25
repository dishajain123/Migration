import type {
  CandidateTrace, ColumnAnalysis, MappingContextSummary, ColumnMappingStatus, ProcSource, ReviewedMapping, Suggestion, TableAnalysis,
  TableDef, UnfedColumn, WorkbookModel,
} from '@/types';
import { NONFEED } from './constants';
import { memo } from './memo';
import { colKey, coverageColumns, fedKeySet, mappingsByTarget, mappingsBySource } from './selectors';
import {
  dateKeyLookup, dateKeyPrecedents, dateKeyTransformation, describeRow, documentedPairs, nameTokens, projectDateKey, tokens,
  type CalendarLookup,
} from './mappingSemantics';
import { compat, parseType } from './typeUtils';
import { profileFor } from './profile';
import { embeddingBonus, embeddingSimilarity } from './schemaEmbedding';
import { profileSimilarity } from './mappingSemantics';
import type { EnrichmentOptions, SuggestionProvenance } from '@/types/profile';

/*
 * Context-aware candidate analysis for Agent 4. HEURISTIC, NOT AI - every score here is Simulated and nothing is
 * auto-approved. What changed versus the original name-token scorer (see docs/MAPPING_ROOT_CAUSE.md):
 *  - the candidate pool is built from the lineage (every column of every CrisMac table that already feeds the target),
 *    not only from the workbook's "no TRAQ target" lists;
 *  - names are compared after abbreviation expansion and aliases learned from the workbook's own documented mappings;
 *  - remarks, FPM_DA_RULES rows and sample-procedure SQL that name a source column for the target column count as
 *    evidence - but evidence never creates a match on its own (it needs a minimum name similarity first);
 *  - every column ends in one explicit status (see ColumnMappingStatus) with the full candidate trace, so "nothing to
 *    compare", "compared and rejected" and "workbook says not fed" are never conflated.
 * The acceptance threshold is unchanged (0.35); scores are not inflated.
 */

export const ACCEPT_MIN = 0.35;
/** A rejected candidate at or above this name similarity is reported as a near miss ("found but rejected"). */
export const NEAR_MISS_NAME = 0.2;
/** Context evidence only counts when the names are at least this similar, so it supports a match, never makes one. */
const EVIDENCE_NAME_FLOOR = 0.2;
const EVIDENCE_BONUS = 0.1;
const AMBIGUITY_GAP = 0.05;
const MIN_REF_LEN = 4;
const TOP_TRACE = 5;

/** Generic naming-convention abbreviations (not bank mappings). Learned workbook aliases take precedence over these. */
const ABBREVIATIONS: Record<string, string> = {
  acct: 'account', ac: 'account', cust: 'customer', amt: 'amount', dt: 'date', dte: 'date', no: 'number', num: 'number', nbr: 'number',
  cd: 'code', desc: 'description', descr: 'description', flg: 'flag', bal: 'balance', txn: 'transaction', trn: 'transaction',
  trans: 'transaction', br: 'branch', ccy: 'currency', cur: 'currency', prod: 'product', typ: 'type', stat: 'status', sts: 'status',
  rt: 'rate', pct: 'percent', ref: 'reference', nm: 'name', addr: 'address', mob: 'mobile', org: 'origination', orig: 'origination',
  mat: 'maturity', os: 'outstanding', outstd: 'outstanding', sec: 'security', coll: 'collateral', inst: 'installment',
};

export { tokens };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const stem = (t: string) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Source-side token -> target-side token, learned only from documented one-to-one DIRECT/RENAME rows seen at least twice. */
export function learnedAliases(model: WorkbookModel): Map<string, { to: string; support: number }> {
  return memo(model, 'engine:aliases', () => {
    const votes = new Map<string, number>();
    for (const m of model.mappings) {
      if (!m.targetTable || !m.targetColumn || m.sourceColumns.length !== 1) continue;
      if (!['DIRECT', 'RENAME', ''].includes(m.mapType.toUpperCase())) continue;
      const s = tokens(m.sourceColumns[0]);
      const t = tokens(m.targetColumn);
      const onlyS = [...s].filter((x) => !t.has(x));
      const onlyT = [...t].filter((x) => !s.has(x));
      const shared = [...s].filter((x) => t.has(x)).length;
      if (onlyS.length === 1 && onlyT.length === 1 && shared >= 1) {
        const k = `${onlyS[0]}>${onlyT[0]}`;
        votes.set(k, (votes.get(k) ?? 0) + 1);
      }
    }
    const out = new Map<string, { to: string; support: number }>();
    for (const [k, support] of votes) {
      if (support < 2) continue;
      const [from, to] = k.split('>');
      const prev = out.get(from);
      if (!prev || support > prev.support) out.set(from, { to, support });
    }
    return out;
  });
}

export function canonTokens(model: WorkbookModel, name: string): Set<string> {
  const alias = learnedAliases(model);
  return canonList(model, nameTokens(model, name), alias);
}

function canonList(model: WorkbookModel, toks: string[], alias = learnedAliases(model)): Set<string> {
  const out = new Set<string>();
  for (const t of toks) out.add(stem(alias.get(t)?.to ?? ABBREVIATIONS[t] ?? t));
  return out;
}

export function unfedColumns(model: WorkbookModel, t: TableDef): UnfedColumn[] {
  const fed = fedKeySet(model);
  const byTarget = mappingsByTarget(model);
  return coverageColumns(t)
    .filter((c) => !fed.has(colKey(t.name, c.name)))
    .map((c) => {
      const rows = byTarget.get(colKey(t.name, c.name)) ?? [];
      const reason = rows.length ? rows.map((r) => r.mapType || 'no map type').join(', ') : 'no mapping row in workbook';
      return {
        targetTable: t.name, targetColumn: c.name, targetType: c.dataType, nullable: c.nullable, reason,
        hasSuggestion: false, ambiguous: false,
      };
    });
}

// ---- candidate pool (lineage-aware) ----
interface PoolItem {
  table: string; column: string; type: string; pool: CandidateTrace['pool']; canon: Set<string>; norm: string;
  /** Set when the column is a surrogate date key that resolves to a date through a workbook calendar table. */
  dateKey?: CalendarLookup;
  /** Name tokens with the key words replaced by "date" (used only against DATE targets). */
  projected?: Set<string>;
}

/** The source columns the engine compares for a target table (exposed for the holdout evaluation's reachability check). */
export function candidatePool(model: WorkbookModel, t: TableDef): { table: string; column: string; type: string }[] {
  return poolFor(model, t).items.map((i) => ({ table: i.table, column: i.column, type: i.type }));
}

function poolFor(model: WorkbookModel, t: TableDef): { items: PoolItem[]; sourceTables: string[] } {
  const items: PoolItem[] = [];
  const seen = new Set<string>();
  const add = (table: string, column: string, type: string, pool: PoolItem['pool']) => {
    const k = colKey(table.toUpperCase(), column.toUpperCase());
    if (seen.has(k) || !column) return;
    seen.add(k);
    const dateKey = dateKeyLookup(model, column, type);
    items.push({
      table, column, type, pool, canon: canonTokens(model, column), norm: norm(column),
      dateKey, projected: dateKey ? canonList(model, projectDateKey(model, column, dateKey)) : undefined,
    });
  };
  const feeders = new Set<string>();
  const usedByThisTable = new Set<string>();
  for (const m of model.mappings) {
    if (m.targetTable !== t.name || !m.sourceTable) continue;
    feeders.add(m.sourceTable.toUpperCase());
    for (const sc of m.sourceColumns) usedByThisTable.add(colKey(m.sourceTable.toUpperCase(), sc.toUpperCase()));
  }
  // 1) CrisMac columns the workbook lists as having no TRAQ target - for this sheet OR for any table that feeds this target.
  for (const u of model.unmapped) {
    if (u.traqColumn || u.decision) continue;
    if (u.sheet === t.name || feeders.has(u.sourceTable.toUpperCase())) add(u.sourceTable, u.column, u.dataType, 'unmapped-list');
  }
  // 2) Every other known column of a CrisMac table that already feeds this target (lineage), not yet used by it.
  for (const st of model.tables) {
    if (st.system === 'TRAQ' || !feeders.has(st.name.toUpperCase())) continue;
    for (const c of st.columns) if (!usedByThisTable.has(colKey(st.name.toUpperCase(), c.name.toUpperCase()))) add(st.name, c.name, c.dataType, 'feeder-table');
  }
  // 3) MART targets: columns of the staging tables that feed it.
  if (t.layer === 'MART') {
    for (const st of model.tables) if (st.layer === 'STAGING' && feeders.has(st.name.toUpperCase())) for (const c of st.columns) add(st.name, c.name, c.dataType, 'staging-feeder');
  }
  return { items, sourceTables: Array.from(feeders).sort() };
}

// ---- evidence (remarks, FPM_DA_RULES, sample procedure SQL) ----
interface EvidenceText { label: string; text: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function references(text: string, column: string): boolean {
  if (column.length < MIN_REF_LEN || !text) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(column)}($|[^A-Za-z0-9_])`, 'i').test(text);
}

function evidenceFor(model: WorkbookModel, t: TableDef, procs: ProcSource[] | undefined) {
  const byCol = new Map<string, EvidenceText[]>();
  const push = (col: string, e: EvidenceText) => { const k = norm(col); byCol.set(k, [...(byCol.get(k) ?? []), e]); };
  const colSet = new Set(t.columns.map((c) => norm(c.name)));
  let remarkRows = 0;
  for (const m of model.mappings) {
    if (m.targetTable !== t.name || !m.targetColumn || !m.remark) continue;
    remarkRows++;
    push(m.targetColumn, { label: `${m.sheet} row ${m.rowNo} remark`, text: m.remark });
  }
  let daRules = 0;
  for (const d of model.daRules) {
    if (!colSet.has(norm(d.column))) continue;
    daRules++;
    push(d.column, { label: `FPM_DA_RULES row ${d.rowNo}`, text: `${d.crismac} ${d.reads} ${d.logic} ${d.expression}` });
  }
  const writers = new Set<string>();
  for (const p of procs ?? []) {
    for (const s of p.steps) {
      if (s.housekeeping || s.table.toUpperCase() !== t.name.toUpperCase()) continue;
      for (const c of s.columns) {
        if (!colSet.has(norm(c.name))) continue;
        writers.add(p.name);
        push(c.name, { label: `${p.file} line ${s.lineStart}`, text: c.expressionFull ?? c.expression });
      }
    }
  }
  return { byCol, remarkRows, daRules, writers: Array.from(writers).sort() };
}

// ---- analysis ----
/** Type-family score for a date key resolved through a lookup: convertible, but not the same type, so below a same-family match. */
const LOOKUP_TYPE_SCORE = 0.75;

/** Weight of the OPTIONAL profile signal (a score of 1 adds this much) and the minimum profile similarity that counts at all. */
export const PROFILE_WEIGHT = 0.35;
export const PROFILE_MIN = 0.3;

/** Per-candidate inputs from the opt-in profile / embedding index. Absent in workbook-only mode. */
interface Enrich { profileScore: number; profileSignals: string[]; embedCos?: number; embedUsesProfile: boolean }

function scoreCandidate(
  model: WorkbookModel, p: PoolItem, targetCanon: Set<string>, targetNorm: string, targetType: string, evidence: EvidenceText[], enrich?: Enrich,
): CandidateTrace {
  const tp = parseType(targetType);
  const sp = parseType(p.type);
  // Semantic path: a surrogate date key (proved by a workbook calendar table) compared to a DATE column as the date it stands for.
  const viaLookup = !!p.dateKey && !!p.projected && tp.family === 'date';
  const candCanon = viaLookup ? p.projected as Set<string> : p.canon;
  const typeScore = viaLookup ? LOOKUP_TYPE_SCORE : tp.family !== 'unknown' && sp.family !== 'unknown' ? (tp.family === sp.family ? 1 : 0) : 0.5;
  const nameScore = jaccard(targetCanon, candCanon);
  const exact = targetNorm === p.norm;
  const textHits = evidence.filter((e) => references(e.text, p.column)).map((e) => `${e.label} names ${p.column}`);
  const pair = documentedPairs(model).get(`${p.norm}>${targetNorm}`);
  const reuse = pair ? [`Documented elsewhere: ${describeRow(pair)}`] : [];
  const precedent = viaLookup ? dateKeyPrecedents(model).slice(0, 2).map((m) => `Workbook precedent for date key -> DATE: ${describeRow(m)}`) : [];
  // Only candidate-specific evidence (a remark/rule/procedure naming the column, or this exact pair documented elsewhere) adds score.
  // The general date-key precedent shows the conversion is documented practice but adds nothing, so it never outranks a documented pair.
  const supporting = nameScore >= EVIDENCE_NAME_FLOOR ? [...textHits, ...reuse] : [];
  const contextBonus = supporting.length ? EVIDENCE_BONUS : 0;
  // Opt-in signals. Both are 0 unless the user supplied a profile / embedding index, so workbook-only scores are unchanged.
  const profileBonus = enrich && enrich.profileScore >= PROFILE_MIN ? PROFILE_WEIGHT * enrich.profileScore : 0;
  // Like workbook evidence, an embedding supports a match but never makes one on its own: it needs name similarity,
  // workbook evidence or a profile signal as well (type score alone would otherwise let a vector clear the threshold).
  const embBonus = enrich && (nameScore >= EVIDENCE_NAME_FLOOR || profileBonus > 0 || contextBonus > 0) ? embeddingBonus(enrich.embedCos) : 0;
  const enrichHits = [
    ...(profileBonus > 0 && enrich ? enrich.profileSignals.map((s) => `Profile: ${s}`) : []),
    ...(embBonus > 0 && enrich?.embedCos !== undefined ? [`Embedding: semantic similarity ${(enrich.embedCos * 100).toFixed(0)}% (cosine)`] : []),
  ];
  const hits = [...supporting, ...enrichHits, ...precedent];
  const score = Math.min(0.99, 0.6 * nameScore + 0.25 * typeScore + 0.15 * (exact ? 1 : 0) + contextBonus + profileBonus + embBonus);
  const provenance: SuggestionProvenance = profileBonus > 0 || (embBonus > 0 && !!enrich?.embedUsesProfile) ? 'profile_enriched' : embBonus > 0 ? 'embedding_enriched' : 'workbook';
  const cmp = viaLookup
    ? { level: 'warn' as const, note: `Date key: needs a lookup through ${p.dateKey?.table} to become a DATE` }
    : compat(p.type, targetType);
  let rejection: string | undefined;
  if (cmp.level === 'incompatible') rejection = `Type check failed: ${cmp.note}`;
  else if (score < ACCEPT_MIN) rejection = `Score ${(score * 100).toFixed(0)}% is below the ${(ACCEPT_MIN * 100).toFixed(0)}% acceptance threshold (name similarity ${(nameScore * 100).toFixed(0)}%)`;
  return {
    table: p.table, column: p.column, type: p.type, pool: p.pool, nameScore, typeScore, exact, contextBonus, score,
    accepted: !rejection, rejection, evidence: hits,
    matchedTokens: [...targetCanon].filter((x) => candCanon.has(x)),
    provenance,
    ...(profileBonus > 0 && enrich ? { profileBonus, profileSignals: enrich.profileSignals } : {}),
    ...(enrich?.embedCos !== undefined ? { embeddingSimilarity: enrich.embedCos, embeddingBonus: embBonus } : {}),
    ...(viaLookup && p.dateKey ? {
      transformation: dateKeyTransformation(p.dateKey, p.table, p.column),
      semanticNote: `${p.column} is a date key (name matches ${p.dateKey.table}.${p.dateKey.keyColumn}, which pairs with ${p.dateKey.table}.${p.dateKey.dateColumn} in the workbook); compared as the date it stands for.`,
    } : {}),
  };
}

const sentence = (status: ColumnMappingStatus, u: UnfedColumn, poolSize: number, best: CandidateTrace | undefined, tables: string[]): string => {
  const b = best ? `${best.table}.${best.column}` : '';
  switch (status) {
    case 'declared-unmapped': return `The workbook marks this column as not fed (${u.reason}) and no acceptable source candidate was found among ${poolSize} column(s). Treated as genuinely unmapped until the bank decides otherwise.`;
    case 'insufficient-context': return tables.length === 0
      ? 'Not enough context: no CrisMac source table is documented as feeding this table, so there were no source columns to compare. Provide mappings or a source column list for this table.'
      : `Not enough context: the ${tables.length} source table(s) that feed this table list no columns beyond those already used (${tables.join(', ')}), so nothing could be compared.`;
    case 'no-match': return `Evaluated ${poolSize} source column(s); none resembles this column (best name similarity ${best ? (best.nameScore * 100).toFixed(0) : 0}%). Likely genuinely unmapped, or the source is not in the documented tables.`;
    case 'below-threshold': return `A plausible candidate was found but rejected: ${b} - ${best?.rejection ?? 'below threshold'}. Review it manually or add the missing context.`;
    case 'ambiguous': return `Two or more candidates are near-equal (best ${b}); a human must choose.`;
    case 'suggested': return `Candidate ${b} passed the name, type and context checks. Still needs human approval.`;
    default: return '';
  }
};

function emptyCounts(): Record<ColumnMappingStatus, number> {
  return { resolved: 0, suggested: 0, ambiguous: 0, 'below-threshold': 0, 'no-match': 0, 'insufficient-context': 0, 'declared-unmapped': 0 };
}

export function mappingTraceEnabled(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('mappingTrace') === '1'; } catch { return false; }
}

/** Opt-in console trace: set localStorage.mappingTrace = '1'. One group per target column, full decision path. */
function logTrace(table: string, a: ColumnAnalysis, ctx: MappingContextSummary): void {
  if (!mappingTraceEnabled()) return;
  console.groupCollapsed(`[mapping] ${table}.${a.targetColumn} ${a.targetType} -> ${a.status}`);
  console.debug('workbook status:', a.workbookStatus, '| pool size:', a.poolSize, '| source tables:', ctx.sourceTables.join(', ') || 'none');
  console.debug('retrieved context:', { daRules: ctx.daRules, remarkRows: ctx.remarkRows, procedureWriters: ctx.procedureWriters, aliases: ctx.learnedAliases.length });
  console.table(a.candidates.map((c) => ({
    candidate: `${c.table}.${c.column}`, pool: c.pool, name: +c.nameScore.toFixed(2), type: c.typeScore, exact: c.exact, context: c.contextBonus,
    score: +c.score.toFixed(2), accepted: c.accepted, rejection: c.rejection ?? '', evidence: c.evidence.join('; '),
  })));
  console.debug('decision:', a.explanation);
  console.groupEnd();
}

/**
 * `opts` carries the OPTIONAL profile and embedding index. Omit it (the default) for pure workbook-only mode: no code path
 * below reads either, and the result is identical to the engine before enrichment existed.
 */
export function analyseTable(model: WorkbookModel, tableName: string, procs?: ProcSource[], opts?: EnrichmentOptions): TableAnalysis | undefined {
  const t = model.tables.find((x) => x.name === tableName);
  if (!t) return undefined;
  const profile = opts?.profile;
  const embeddings = opts?.embeddings;
  return memo(model, `engine:analysis:${tableName}:${procs ? procs.length : 'x'}${profile ? `:${profile.id}` : ''}${embeddings ? `:${embeddings.id}` : ''}`, () => {
    const { items, sourceTables } = poolFor(model, t);
    const ev = evidenceFor(model, t, procs);
    const enrichment = [
      ...(profile ? [`profile "${profile.label ?? profile.id}" (${profile.columns.length} column entries)`] : []),
      ...(embeddings ? [`embeddings (${embeddings.model})`] : []),
    ];
    const ctx: MappingContextSummary = {
      sourceTables, poolSize: items.length, daRules: ev.daRules, remarkRows: ev.remarkRows, procedureWriters: ev.writers,
      procedureSqlLoaded: !!procs && procs.length > 0, threshold: ACCEPT_MIN,
      columnDescriptions: profile ? `Opt-in profile "${profile.label ?? profile.id}": ${profile.columns.filter((c) => c.description).length} description(s)` : 'Not provided in workbook',
      learnedAliases: Array.from(learnedAliases(model), ([from, v]) => ({ from, to: v.to, support: v.support })).sort((a, b) => b.support - a.support),
      ...(enrichment.length ? { enrichment } : {}),
    };
    const columns: ColumnAnalysis[] = unfedColumns(model, t).map((u) => {
      const tc = canonTokens(model, u.targetColumn);
      const tn = norm(u.targetColumn);
      const evidence = ev.byCol.get(tn) ?? [];
      const tMeta = profile ? profileFor(profile, t.name, u.targetColumn) : undefined;
      const enrichFor = (p: PoolItem): Enrich | undefined => {
        if (!profile && !embeddings) return undefined;
        const ps = profileSimilarity(tMeta, profile ? profileFor(profile, p.table, p.column) : undefined);
        const cos = embeddingSimilarity(embeddings, { table: t.name, column: u.targetColumn }, { table: p.table, column: p.column });
        return { profileScore: ps.score, profileSignals: ps.signals, embedCos: cos, embedUsesProfile: !!embeddings?.usesProfile };
      };
      const scored = items.map((p) => scoreCandidate(model, p, tc, tn, u.targetType, evidence, enrichFor(p))).sort((a, b) => b.score - a.score);
      const accepted = scored.filter((c) => c.accepted);
      const declared = u.reason.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).every((x) => NONFEED.has(x)) && u.reason !== 'no mapping row in workbook';
      let status: ColumnMappingStatus;
      let best: CandidateTrace | undefined = accepted[0];
      if (accepted.length > 0) status = accepted[1] && accepted[0].score - accepted[1].score < AMBIGUITY_GAP ? 'ambiguous' : 'suggested';
      else {
        // Nothing was accepted. Show the closest NAME near-miss (or the best-evidenced candidate) rather than whichever column
        // merely shares the target's data type, which can outrank it on score alone and would hide it as "no match".
        best = scored.find((c) => c.nameScore >= NEAR_MISS_NAME || c.evidence.length > 0) ?? scored[0];
        if (declared) status = 'declared-unmapped';
        else if (items.length === 0) status = 'insufficient-context';
        else if (best && (best.nameScore >= NEAR_MISS_NAME || best.evidence.length > 0)) status = 'below-threshold';
        else status = 'no-match';
      }
      const a: ColumnAnalysis = {
        targetTable: t.name, targetColumn: u.targetColumn, targetType: u.targetType, nullable: u.nullable, workbookStatus: u.reason,
        status, explanation: '', poolSize: items.length, best, candidates: scored.slice(0, TOP_TRACE),
      };
      a.explanation = sentence(status, u, items.length, best, sourceTables);
      if (declared && accepted.length > 0) a.explanation += ` Note: the workbook marks this column ${u.reason}; confirm before mapping.`;
      logTrace(t.name, a, ctx);
      return a;
    });
    const counts = emptyCounts();
    for (const c of columns) counts[c.status]++;
    return { table: t.name, context: ctx, columns, counts };
  });
}

/** Overlay reviewer decisions: an approved suggestion or manual mapping resolves the column (the original bug: it did not). */
export function applyReviewed(analysis: TableAnalysis, reviewed: ReviewedMapping[]): TableAnalysis {
  const by = new Map(reviewed.filter((r) => r.targetTable === analysis.table).map((r) => [r.targetColumn, r]));
  const counts = emptyCounts();
  const columns = analysis.columns.map((c) => {
    const r = by.get(c.targetColumn);
    const next: ColumnAnalysis = r
      ? { ...c, status: 'resolved', resolvedBy: `${r.id.startsWith('manual:') ? 'Manual mapping' : 'Approved suggestion'}: ${r.sourceTable}.${r.sourceColumn}`, explanation: `Resolved by a human reviewer: ${r.sourceTable}.${r.sourceColumn}.` }
      : c;
    counts[next.status]++;
    return next;
  });
  return { ...analysis, columns, counts };
}

export function suggestionsFromAnalysis(model: WorkbookModel, analysis: TableAnalysis): Suggestion[] {
  const bySource = mappingsBySource(model);
  const out: Suggestion[] = [];
  for (const c of analysis.columns) {
    if ((c.status !== 'suggested' && c.status !== 'ambiguous') || !c.best) continue;
    const b = c.best;
    const second = c.candidates.filter((x) => x.accepted)[1];
    const cmp = b.transformation ? { level: 'warn' as const, note: 'Needs a date-key lookup (see transformation)' } : compat(b.type, c.targetType);
    const reasons = [`Name similarity ${(b.nameScore * 100).toFixed(0)}%${b.matchedTokens.length ? ` (shared: ${b.matchedTokens.join(', ')})` : ''}`];
    if (b.exact) reasons.push('Names identical (ignoring case/underscores)');
    reasons.push(`Type check: ${cmp.note}`);
    if (b.semanticNote) reasons.push(`Semantic: ${b.semanticNote}`);
    for (const e of b.evidence) reasons.push(`Context: ${e}`);
    const issues: string[] = [];
    if (cmp.level === 'warn' || cmp.level === 'incompatible') issues.push(cmp.note);
    if (b.transformation) issues.push('Requires transformation: confirm the conversion before approving');
    if (c.status === 'ambiguous' && second) issues.push(`Ambiguous: near-equal candidates (next: ${second.table}.${second.column})`);
    const others = (bySource.get(colKey(b.table, b.column)) ?? []).filter((m) => m.targetTable === analysis.table && m.targetColumn && m.targetColumn !== c.targetColumn);
    if (others.length) issues.push(`Source column already feeds ${analysis.table}.${others[0].targetColumn} in the workbook`);
    const provenance: SuggestionProvenance = b.provenance ?? 'workbook';
    if (provenance !== 'workbook') issues.push(`Uses a non-workbook input (${provenance === 'profile_enriched' ? 'user-supplied profile metadata' : 'embedding similarity'}): confidence is not calibrated, verify before approving`);
    if (/not (fed|used|mapped|carried)|dropped/i.test(c.workbookStatus)) issues.push(`Workbook marks this target column "${c.workbookStatus}"; confirm before mapping`);
    out.push({
      id: `sug:${analysis.table}.${c.targetColumn}<-${b.table}.${b.column}`,
      targetTable: analysis.table, targetColumn: c.targetColumn, targetType: c.targetType,
      sourceTable: b.table, sourceColumn: b.column, sourceType: b.type,
      // Raw, uncalibrated engine score. `suggest.ts` replaces `confidence` with the holdout-calibrated figure (mappingEval.ts).
      confidence: Math.min(99, Math.round(b.score * 100)), rawScore: b.score, confidenceBasis: 'uncalibrated', provenance, transformation: b.transformation, reasons, issues, compat: cmp.level, ambiguous: c.status === 'ambiguous', origin: 'mock',
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
