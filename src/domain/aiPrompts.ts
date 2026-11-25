import type {
  FlowColumnEdge, LineageFlow, ProcObject, ProcSource, Relationship, Suggestion, TableAnalysis, TableDetail, UnfedColumn, ValidationReport,
} from '@/types';
import type { AiInsight, ChatMessage } from '@/types/ai';
import type { ProfileMetadata } from '@/types/profile';
import { extractJson } from './jsonExtract';
import { formatProposalInsight, parseMappingProposals, type ProposalParseInput } from './mappingProposals';
import { describeProfile } from './profile';

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

export function spec(task: string, schema: string, context: string, maxTokens = 4096): PromptSpec {
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

// ---- Agent 4: Mapping. The model PROPOSES; the deterministic validator CHECKS (domain/mappingProposals.ts). ----
export interface SchemaTable { table: string; columns: { name: string; type: string }[] }
export interface MappingContext {
  table: string; unfed: UnfedColumn[]; suggestions: Suggestion[]; analysis?: TableAnalysis;
  /** The full candidate source schema (every column the engine compared, grouped by table). Lets the model find matches the heuristics missed. */
  schema?: SchemaTable[];
  /** Opt-in profile: descriptions and statistics are included; sample values only when the profile allows sharing them. */
  profile?: ProfileMetadata;
  /** Few-shot lines quoted verbatim from workbook remarks, FPM_DA_RULES, sample procedure SQL and earlier human approvals (domain/transformExamples.ts). */
  examples?: string[];
  /** Earlier human rejections for this table: pairings the model must not propose again. */
  decisionNotes?: string[];
}

/** Bounds the prompt: beyond this many schema columns the listing is cut and says so. */
export const MAX_SCHEMA_COLUMNS = 600;

const MAPPING_SCHEMA = [
  'JSON schema: {"picks": [{"targetColumn": string,',
  '"candidateId": string (a heuristic candidate id copied exactly from the context) OR "sources": [{"table": string, "column": string}] (names copied exactly from SOURCE SCHEMA),',
  '"transformation": string (optional), "confidence": integer 0-100, "reason": string}], "unresolved": [{"targetColumn": string, "reason": string}]}.',
  'Use EITHER candidateId OR sources in a pick, never both. Prefer a heuristic candidate when it is right; use sources when a better column exists in SOURCE SCHEMA',
  '(a different name, several columns that together feed one target, or one source column feeding several targets).',
  'Add "transformation" ONLY when the types or documented logic require a conversion: ONE T-SQL value expression over the proposed source columns (CAST/CONVERT, a CASE lookup or conditional, a concatenation);',
  'no statements, no subqueries, no comments, no columns outside the proposed sources. It is parsed and discarded if invalid. Omit it for a plain copy. EXAMPLES show how this bank writes such logic: imitate their style, never copy them for unrelated columns.',
  'NEVER write a table or column that is not in SOURCE SCHEMA: such picks are discarded automatically. If nothing is plausible, put the column in "unresolved".',
].join(' ');

export function mappingPrompt(c: MappingContext): { prompt: PromptSpec; candidateIds: Set<string> } {
  const byCol = new Map<string, Suggestion[]>();
  for (const s of c.suggestions) byCol.set(s.targetColumn, [...(byCol.get(s.targetColumn) ?? []), s]);
  const withCands = c.unfed.filter((u) => byCol.has(u.targetColumn)).slice(0, 25);
  const ids = new Set<string>();
  const meta = (table: string, column: string) => (c.profile ? describeProfile(c.profile, table, column) : '');
  const block = withCands.map((u) => {
    const cands = (byCol.get(u.targetColumn) ?? []).slice(0, 4).map((s) => { ids.add(s.id); return `   * candidateId=${s.id}: ${s.sourceTable}.${s.sourceColumn} (${s.sourceType}); heuristic reasons: ${s.reasons.join(', ') || 'none'}; issues: ${s.issues.join(', ') || 'none'}`; });
    const m = meta(c.table, u.targetColumn);
    return `- ${u.targetColumn} ${u.targetType} (unfed: ${u.reason})${m ? ` [${m}]` : ''}\n${cands.join('\n')}`;
  }).join('\n');
  // Engine context the model may weigh.
  const a = c.analysis;
  const ctxLines = a ? [
    `Source tables feeding this target (lineage): ${a.context.sourceTables.join(', ') || 'none documented'}; candidate pool ${a.context.poolSize} column(s).`,
    `Evidence available: ${a.context.remarkRows} workbook remark row(s), ${a.context.daRules} FPM_DA_RULES row(s), procedure SQL ${a.context.procedureSqlLoaded ? `loaded (writers: ${a.context.procedureWriters.join(', ') || 'none for this table'})` : 'not loaded'}; column descriptions: ${a.context.columnDescriptions}.`,
    ...(a.context.enrichment?.length ? [`Non-workbook inputs active (user-supplied, treat as unverified): ${a.context.enrichment.join('; ')}.`] : []),
  ] : [];
  const offered = new Set(withCands.map((u) => u.targetColumn));
  const open = c.unfed.filter((u) => !offered.has(u.targetColumn)).slice(0, 25).map((u) => {
    const x = a?.columns.find((y) => y.targetColumn === u.targetColumn);
    if (x?.status === 'resolved') return '';
    const m = meta(c.table, u.targetColumn);
    return `- ${u.targetColumn} ${u.targetType} (unfed: ${u.reason}; heuristic outcome: ${x?.status ?? 'none'}${x?.best?.rejection ? `, best rejected: ${x.best.table}.${x.best.column} - ${x.best.rejection}` : ''})${m ? ` [${m}]` : ''}`;
  }).filter(Boolean);
  let shown = 0;
  const schemaBlock = (c.schema ?? []).map((t) => {
    const room = Math.max(0, MAX_SCHEMA_COLUMNS - shown);
    const cols = t.columns.slice(0, room);
    shown += cols.length;
    if (cols.length === 0) return '';
    return `${t.table}\n${cols.map((col) => { const m = meta(t.table, col.name); return `  - ${col.name} ${col.type || '(type not provided)'}${m ? ` [${m}]` : ''}`; }).join('\n')}${cols.length < t.columns.length ? `\n  [${t.columns.length - cols.length} more columns not shown]` : ''}`;
  }).filter(Boolean).join('\n');
  const total = (c.schema ?? []).reduce((n, t) => n + t.columns.length, 0);
  const context = [
    `Target table: ${c.table}`, ...ctxLines,
    `Unfed columns with heuristic candidates:\n${block || 'none'}`,
    open.length ? `Unfed columns with NO heuristic candidate (propose from SOURCE SCHEMA, or report in "unresolved"):\n${open.join('\n')}` : '',
    schemaBlock ? `SOURCE SCHEMA (every source column the engine compared; the only columns you may use)${total > shown ? ` - showing ${shown} of ${total}` : ''}:\n${schemaBlock}` : 'SOURCE SCHEMA: Not provided; use candidateId only.',
    c.examples?.length ? `EXAMPLES (verbatim from the workbook, sample procedure SQL and earlier human approvals; evidence of this bank's style, not rules):\n${c.examples.map((e) => `- ${e}`).join('\n')}` : 'EXAMPLES: Not provided in workbook.',
    c.decisionNotes?.length ? `EARLIER HUMAN DECISIONS:\n${c.decisionNotes.map((e) => `- ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return {
    prompt: spec('For each unfed target column choose the most plausible source column(s), judging by names, data types, descriptions and the heuristic reasons. Your confidence is an estimate, not a measurement. Every proposal is validated against the schema and is only a draft until a human approves it.', MAPPING_SCHEMA, context),
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
export { extractJson };

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export function parseInsight(text: string): AiInsight | null {
  const o = extractJson(text) as { summary?: unknown; sections?: unknown } | null;
  if (!o || typeof o.summary !== 'string') return null;
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((s: { title?: unknown; points?: unknown }) => ({ title: typeof s?.title === 'string' ? s.title : '', points: strs(s?.points) }))
    .filter((s) => s.title && s.points.length > 0);
  return { summary: o.summary.trim(), sections };
}

export type MappingParseContext = Partial<Pick<ProposalParseInput, 'table' | 'model' | 'validateTransformation'>>;

/**
 * Convert mapping picks to an insight. Without `ctx.model` only heuristic candidates the model was actually offered survive
 * (the original behaviour). With it, picks naming other source columns are accepted too, but only after the deterministic
 * validator confirms the columns exist, the types are compatible, and conflicts are flagged.
 */
export function parseMappingInsight(text: string, suggestions: Suggestion[], offered: Set<string>, ctx?: MappingParseContext): AiInsight | null {
  const set = parseMappingProposals(text, { table: ctx?.table ?? suggestions[0]?.targetTable ?? '', suggestions, offered, model: ctx?.model, validateTransformation: ctx?.validateTransformation });
  return set ? formatProposalInsight(set, !!ctx?.model) : null;
}
