import type {
  FlowColumnEdge, LineageFlow, ProcObject, ProcSource, Relationship, Suggestion, TableAnalysis, TableDetail, UnfedColumn, ValidationReport,
} from '@/types';
import type { AiInsight, ChatMessage } from '@/types/ai';

// Pure prompt builders and response parsers for the AI feature of each agent. They only restate workbook-derived
// context; the rules below forbid the model from adding anything else. No provider or model names appear here.

export interface PromptSpec { messages: ChatMessage[]; maxTokens: number }

const GROUNDING = [
  'You assist a CrisMAC to TRAQ data-migration team.',
  'Use ONLY the facts in the CONTEXT block. Never invent tables, columns, mappings, SQL, business rules or numbers.',
  'If the context does not contain something needed, say "Not provided in workbook" instead of guessing.',
  'Quote object and column names exactly as written in the context.',
  'Respond with a single JSON object and nothing else.',
].join(' ');

const INSIGHT_SCHEMA = 'JSON schema: {"summary": string (2-4 sentences), "sections": [{"title": string, "points": [string]}]} with 2-5 sections and at most 6 short points each.';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[truncated: ${s.length - n} more characters]` : s);
const more = (shown: number, total: number) => (total > shown ? `\n[${total - shown} more not shown]` : '');

function spec(task: string, schema: string, context: string, maxTokens = 4096): PromptSpec {
  return {
    maxTokens,
    messages: [
      { role: 'system', content: `${GROUNDING}\n${schema}` },
      { role: 'user', content: `TASK: ${task}\n\nCONTEXT:\n${context}` },
    ],
  };
}

// ---- Agent 1: Data Model ----
export function tableBriefPrompt(d: TableDetail, rels: Relationship[]): PromptSpec {
  const cols = d.columns.slice(0, 80).map((c) => {
    const feeds = c.feeds.slice(0, 3).map((f) => `${f.sourceTable}.${f.sourceColumn || '(none)'} [${f.mapType || 'no map type'}]`).join('; ');
    return `- ${c.name} ${c.dataType}${c.nullable === null ? '' : c.nullable ? ' NULL' : ' NOT NULL'}${c.traqOnly ? ' (TRAQ-only)' : ''}${feeds ? ` <- ${feeds}` : c.isFed ? '' : ' (no feeding mapping)'}`;
  });
  const context = [
    `Table: ${d.table.name} (${d.table.system}, layer ${d.table.layer})`,
    `Banner: ${d.banner || 'Not provided in workbook'}`,
    `Primary key: ${d.primaryKey.join(', ') || 'Not provided in workbook'}`,
    `Columns listed ${d.table.listedColumns}, fed by a mapping ${d.table.fedColumns}`,
    `Notes: ${d.notes.join(' | ') || 'none'}`,
    `Columns:\n${cols.join('\n')}${more(80, d.columns.length)}`,
    `Relationships (LOOKUP/JOIN rows):\n${rels.slice(0, 20).map((r) => `- ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn} [${r.kind}]`).join('\n') || 'none documented'}${more(20, rels.length)}`,
  ].join('\n');
  return spec('Brief an analyst on this table: its apparent role in the migration, key columns, how it is fed, and documentation gaps. Suggested section titles: "Role", "Key columns", "Feeding", "Gaps".', INSIGHT_SCHEMA, context);
}

// ---- Agent 2: Lineage ----
const edgeLine = (e: FlowColumnEdge) =>
  `- ${e.sourceTable}.${e.sourceColumn || '(constant/derived)'} -> ${e.targetTable}.${e.targetColumn} [${e.mapType || 'blank'}; ${e.kind}]${e.transformation ? ` remark: ${clip(e.transformation, 160)}` : ''} (${e.sheet} row ${e.rowNo})`;

export function flowExplainPrompt(f: LineageFlow): PromptSpec {
  const context = [
    `Selected tables: ${f.request.tables.join(', ')}`,
    `Tables in view:\n${f.tables.map((t) => `- ${t.name} (${t.system}, ${t.layer}, ${t.role})`).join('\n')}`,
    `Column mappings (${f.columnEdges.length}; direct ${f.stats.direct}, transformed ${f.stats.transformed}, unspecified ${f.stats.unspecified}):\n${f.columnEdges.slice(0, 60).map(edgeLine).join('\n')}${more(60, f.columnEdges.length)}`,
    `Procedures/views mentioned with table pairs (name match only, not a documented link):\n${f.tableEdges.flatMap((e) => e.procedures.map((p) => `- ${p.name} near ${e.source} -> ${e.target}`)).slice(0, 20).join('\n') || 'none'}`,
  ].join('\n');
  return spec('Explain in plain language how data flows through these tables: which sources feed which targets, where values are transformed (use the remark text), and what is unspecified. Suggested titles: "Flow", "Transformations", "Open questions".', INSIGHT_SCHEMA, context);
}

// ---- Agent 3: Procedures ----
export function procedureExplainPrompt(o: ProcObject, src?: ProcSource): PromptSpec {
  const refs = o.references.slice(0, 8).map((r) => `- ${r.sheet} row ${r.rowNo}: ${clip(r.snippet, 300)}`).join('\n');
  const parts = [
    `Object: ${o.name} (${o.kind})`,
    `Operation keywords near it: ${o.operations.join(', ') || 'none'}`,
    `Tables mentioned alongside: ${o.mentionedTables.slice(0, 15).join(', ') || 'none'}`,
    `Workbook references:\n${refs || 'none'}`,
  ];
  if (src) {
    const sql = src.steps.filter((s) => !s.housekeeping).map((s) => `-- lines ${s.lineStart}-${s.lineEnd}${s.guard ? ` guard: ${s.guard}` : ''}\n${s.sql}`).join('\n\n');
    parts.push(
      `SQL file: ${src.file} (${src.lineCount} lines)`,
      `Header descriptions: ${src.descriptions.join(' | ') || 'none'}`,
      `Parameters: ${src.params.map((p) => `${p.name} ${p.type}`).join(', ') || 'none'}`,
      `Reads: ${src.tablesRead.join(', ') || 'none'}; writes: ${src.tablesWritten.map((w) => w.table).join(', ') || 'none'}; calls: ${src.calls.join(', ') || 'none'}`,
      `SQL statements (verbatim, comments removed):\n${clip(sql, 9000)}`,
    );
  } else parts.push('SQL body: Not provided in workbook or sample files. Do not describe any logic beyond the references above.');
  return spec('Explain what this procedure/object does, step by step, based only on the SQL or references given. Do not rewrite or translate the SQL. Suggested titles: "Purpose", "Steps", "Tables touched", "Unclear or missing".', INSIGHT_SCHEMA, parts.join('\n'));
}

// ---- Agent 4: Mapping (the model may only choose among supplied candidates) ----
export interface MappingContext { table: string; unfed: UnfedColumn[]; suggestions: Suggestion[]; analysis?: TableAnalysis }

const MAPPING_SCHEMA = 'JSON schema: {"picks": [{"targetColumn": string, "candidateId": string (copied exactly from the context), "confidence": integer 0-100, "reason": string}], "unresolved": [{"targetColumn": string, "reason": string}]}. Choose candidateId ONLY from the listed candidates. If none is plausible, put the column in "unresolved".';

export function mappingPrompt(c: MappingContext): { prompt: PromptSpec; candidateIds: Set<string> } {
  const byCol = new Map<string, Suggestion[]>();
  for (const s of c.suggestions) byCol.set(s.targetColumn, [...(byCol.get(s.targetColumn) ?? []), s]);
  const cols = c.unfed.filter((u) => byCol.has(u.targetColumn)).slice(0, 25);
  const ids = new Set<string>();
  const block = cols.map((u) => {
    const cands = (byCol.get(u.targetColumn) ?? []).slice(0, 4).map((s) => { ids.add(s.id); return `   * candidateId=${s.id}: ${s.sourceTable}.${s.sourceColumn} (${s.sourceType}); heuristic reasons: ${s.reasons.join(', ') || 'none'}; issues: ${s.issues.join(', ') || 'none'}`; });
    return `- ${u.targetColumn} ${u.targetType} (unfed: ${u.reason})\n${cands.join('\n')}`;
  }).join('\n');
  // Engine context the model may weigh (never a licence to pick outside the offered candidates).
  const a = c.analysis;
  const ctxLines = a ? [
    `Source tables feeding this target (lineage): ${a.context.sourceTables.join(', ') || 'none documented'}; candidate pool ${a.context.poolSize} column(s).`,
    `Evidence available: ${a.context.remarkRows} workbook remark row(s), ${a.context.daRules} FPM_DA_RULES row(s), procedure SQL ${a.context.procedureSqlLoaded ? `loaded (writers: ${a.context.procedureWriters.join(', ') || 'none for this table'})` : 'not loaded'}; column descriptions: ${a.context.columnDescriptions}.`,
  ] : [];
  const offered = new Set(cols.map((u) => u.targetColumn));
  const notRankable = (a?.columns ?? []).filter((x) => !offered.has(x.targetColumn) && x.status !== 'resolved').slice(0, 25)
    .map((x) => `- ${x.targetColumn}: ${x.status}${x.best?.rejection ? ` (best rejected: ${x.best.table}.${x.best.column} - ${x.best.rejection})` : ''}`);
  const context = [
    `Target table: ${c.table}`, ...ctxLines,
    `Unfed columns with candidate source columns:\n${block || 'none'}`,
    notRankable.length ? `Columns with NO acceptable candidate (report them in "unresolved"; do not invent one):\n${notRankable.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    prompt: spec('For each target column pick the most semantically plausible candidate, judging by names, data types and the heuristic reasons. Your confidence is an estimate, not a measurement.', MAPPING_SCHEMA, context),
    candidateIds: ids,
  };
}

// ---- Agent 5: Rules & validation ----
export function validationReviewPrompt(r: ValidationReport): PromptSpec {
  const issues = r.results.filter((x) => x.severity !== 'pass').slice(0, 40)
    .map((x) => `- [${x.severity}] ${x.checkId} ${x.check} on ${x.table}: ${x.message} (flagged ${x.flagged}/${x.checked}; e.g. ${x.items.slice(0, 4).join(', ') || 'n/a'})`).join('\n');
  const context = `Totals: pass ${r.totals.pass}, warn ${r.totals.warn}, fail ${r.totals.fail}\nBasis: ${r.basis}\nNon-passing results:\n${issues || 'none'}`;
  return spec('Review these deterministic metadata validation results: group the problems by theme, say which matter most for migration readiness and why, and suggest what a human should check next. Do not claim any data was profiled. Suggested titles: "Main themes", "Highest priority", "Suggested next checks".', INSIGHT_SCHEMA, context);
}

// ---- parsing ----
/** Extract the first top-level JSON object from model text (tolerates code fences and leading prose). */
export function extractJson(text: string): unknown | null {
  const t = text.replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export function parseInsight(text: string): AiInsight | null {
  const o = extractJson(text) as { summary?: unknown; sections?: unknown } | null;
  if (!o || typeof o.summary !== 'string') return null;
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((s: { title?: unknown; points?: unknown }) => ({ title: typeof s?.title === 'string' ? s.title : '', points: strs(s?.points) }))
    .filter((s) => s.title && s.points.length > 0);
  return { summary: o.summary.trim(), sections };
}

/** Convert mapping picks to an insight, dropping any pick whose candidate the model was not offered. */
export function parseMappingInsight(text: string, suggestions: Suggestion[], offered: Set<string>): AiInsight | null {
  const o = extractJson(text) as { picks?: unknown; unresolved?: unknown } | null;
  if (!o || !Array.isArray(o.picks)) return null;
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const picks: string[] = []; let dropped = 0;
  for (const p of o.picks as { targetColumn?: unknown; candidateId?: unknown; confidence?: unknown; reason?: unknown }[]) {
    const s = typeof p?.candidateId === 'string' && offered.has(p.candidateId) ? byId.get(p.candidateId) : undefined;
    if (!s) { dropped++; continue; }
    const conf = typeof p.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(p.confidence))) : null;
    picks.push(`${s.targetColumn} <- ${s.sourceTable}.${s.sourceColumn}${conf === null ? '' : ` (AI-estimated ${conf}%)`}: ${typeof p.reason === 'string' ? p.reason : 'no reason given'}`);
  }
  const unresolved = (Array.isArray(o.unresolved) ? o.unresolved : []).map((u: { targetColumn?: unknown; reason?: unknown }) => `${String(u?.targetColumn ?? '?')}: ${String(u?.reason ?? 'no plausible candidate')}`);
  const sections = [];
  if (picks.length) sections.push({ title: 'Recommended mappings', points: picks });
  if (unresolved.length) sections.push({ title: 'No plausible candidate', points: unresolved });
  return {
    summary: `${picks.length} recommendation(s) among the heuristic candidates; ${unresolved.length} unresolved${dropped ? `; ${dropped} discarded because the model named a candidate that was not offered` : ''}. Recommendations are not applied until a human approves them.`,
    sections,
  };
}
