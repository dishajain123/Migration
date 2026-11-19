// Shared models. Mirror these with Pydantic models in the future FastAPI backend.

export type Origin = 'workbook' | 'derived' | 'mock';
export type SystemKind = 'CrisMac' | 'TRAQ';
export type Layer = 'CRISMAC' | 'RECEPTION' | 'STAGING' | 'MART' | 'APP' | 'DI';

// ---------- API envelope ----------
export interface ApiMeta {
  simulated: boolean;
  requestId: string;
  latencyMs: number;
  provider?: string;
  model?: string;
  note?: string;
}
export interface ApiError { code: string; message: string }
export interface ApiResult<T> { data: T | null; meta: ApiMeta; error?: ApiError }

import type { ChatSource } from './ai';

// ---------- Workbook model (parsed from CSV) ----------
export interface ColumnDef {
  id: string;
  table: string;
  name: string;
  dataType: string;
  nullable: boolean | null; // null = unknown
  ordinal: number;
  traqOnly: boolean; // column listed as having no CrisMac source
  sheet: string;
  rowNo: number;
}

export interface TableDef {
  name: string;
  system: SystemKind;
  layer: Layer;
  sheet?: string;
  declaredColumns?: number;
  declaredMapped?: number;
  rowsInDb?: number;
  structureFrom?: string;
  banner?: string;
  columns: ColumnDef[];
}

export interface MappingRow {
  id: string;
  sourceSystem: string;
  sourceTable: string;
  sourceColumn: string;
  sourceColumns: string[];
  sourceType: string;
  targetTable: string;
  targetColumn: string;
  targetType: string;
  mapType: string;
  remark: string;
  sheet: string;
  rowNo: number;
}

export interface UnmappedColumn {
  id: string;
  sheet: string;
  sourceSystem: string;
  sourceTable: string;
  column: string;
  dataType: string;
  traqTable: string;
  traqColumn: string;
  decision: string;
  note: string;
  rowNo: number;
}

export interface DaRule {
  run: string;
  column: string;
  kind: string;
  dataType: string;
  ruleType: string;
  inForceFrom: string;
  crismac: string;
  reads: string;
  logic: string;
  expression: string;
  version: string;
  rowNo: number;
}

export interface DecisionRow {
  row: string;
  name: string;
  result: string;
  npaId: string;
  crismac: string;
  meaning: string;
  conditions: string;
  rowNo: number;
}

export interface SheetInfo {
  name: string;
  rowCount: number;
  banner: string;
  kind: 'A' | 'B' | 'C' | 'index' | 'rules' | 'other';
  inScope: boolean;
}

export interface WorkbookModel {
  tables: TableDef[];
  mappings: MappingRow[];
  unmapped: UnmappedColumn[];
  daRules: DaRule[];
  decisionRows: DecisionRow[];
  sheets: SheetInfo[];
  outOfScope: string[];
  loadedAt: string;
}

// ---------- Agent 1: data model ----------
export interface TableSummary {
  name: string;
  system: SystemKind;
  layer: Layer;
  sheet?: string;
  declaredColumns?: number;
  listedColumns: number;
  fedColumns: number;
  rowsInDb?: number;
  structureFrom?: string;
}
export interface ColumnDetail {
  name: string;
  dataType: string;
  nullable: boolean | null;
  traqOnly: boolean;
  feeds: { sourceTable: string; sourceColumn: string; mapType: string; sheet: string; rowNo: number }[];
  usedBy: { targetTable: string; targetColumn: string }[];
  isFed: boolean;
}
export interface TableDetail {
  table: TableSummary;
  banner: string;
  primaryKey: string[];
  columns: ColumnDetail[];
  notes: string[];
}
export type CompatLevel = 'compatible' | 'warn' | 'incompatible' | 'unknown';
export interface ComparePair {
  sourceColumn: string;
  sourceType: string;
  targetColumn: string;
  targetType: string;
  mapType: string;
  compat: CompatLevel;
  note: string;
}
export interface TableComparison {
  source: TableSummary;
  target: TableSummary;
  pairs: ComparePair[];
  unusedSourceColumns: string[];
  unfedTargetColumns: string[];
}
export interface Relationship {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind: string; // LOOKUP | JOIN
  remark: string;
  sheet: string;
  rowNo: number;
}
export interface ScopeInfo {
  inScopeSheets: SheetInfo[];
  outOfScope: string[];
  counts: { traqTables: number; sourceTables: number; columns: number; mappings: number };
  gaps: string[];
}

// ---------- Agent 2: lineage ----------
export interface LineageNode {
  id: string;
  label: string;
  system: SystemKind;
  layer: Layer;
  rank: number;
  row: number;
  columnCount: number;
}
export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  mapTypes: Record<string, number>;
  notUsedOnly: boolean;
}
export interface LineageGraph { nodes: LineageNode[]; edges: LineageEdge[] }
export interface LineageOptions { includeNotUsed: boolean; internalOnly: boolean }
export interface TraceNode {
  table: string;
  column: string;
  mapType?: string;
  remark?: string;
  sheet?: string;
  rowNo?: number;
  children: TraceNode[];
}

// ---------- Agent 2: column-level flow (Phase 9) ----------
/** What the user picked: tables to trace and how far. depth 0 = unlimited. */
export interface FlowRequest extends LineageOptions {
  tables: string[];
  upstream: boolean;
  downstream: boolean;
  depth: number;
}
export interface CatalogEntry {
  name: string;
  system: SystemKind;
  layer: Layer;
  columnCount: number;
  /** Tables that feed it, directly or indirectly. */
  upstreamCount: number;
  downstreamCount: number;
  /** Tables that feed it directly. */
  directSources: number;
}
export type FlowRole = 'selected' | 'upstream' | 'downstream';
/** direct = MAP TYPE DIRECT/RENAME; transformed = any other feeding MAP TYPE; unspecified = blank MAP TYPE. */
export type FlowKind = 'direct' | 'transformed' | 'unspecified';
export interface FlowTable {
  name: string;
  system: SystemKind;
  layer: Layer;
  role: FlowRole;
  /** Layer index in the left-to-right layout (0 = furthest upstream). */
  rank: number;
  columnCount: number;
  /** Columns that take part in a visible column mapping, in table order. */
  columns: string[];
}
export interface FlowColumnEdge {
  id: string;
  sourceTable: string;
  /** Empty when the mapping row names no source column (constant or derived). */
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  mapType: string;
  kind: FlowKind;
  /** Remark text from the workbook, verbatim. Empty when none. */
  transformation: string;
  sheet: string;
  rowNo: number;
}
export interface FlowTableEdge extends LineageEdge {
  /** Procedures/views/DI mappings the workbook mentions together with both tables (a name match, not a documented link). */
  procedures: { name: string; kind: ProcKind }[];
}
export interface LineageFlow {
  request: FlowRequest;
  tables: FlowTable[];
  tableEdges: FlowTableEdge[];
  columnEdges: FlowColumnEdge[];
  /** Requested tables that have no lineage edge under the current options. */
  untraceable: string[];
  stats: { upstream: number; downstream: number; direct: number; transformed: number; unspecified: number };
}

// ---------- Agent 3: procedures ----------
export type ProcKind = 'view' | 'traq-procedure' | 'di-mapping' | 'di-workflow' | 'crismac-procedure' | 'crismac-object';
export interface ProcReference { sheet: string; rowNo: number; snippet: string }
export interface ProcObject {
  id: string;
  name: string;
  kind: ProcKind;
  references: ProcReference[];
  sheets: string[];
  operations: string[];
  mentionedTables: string[];
  related: string[];
  sqlProvided: false;
}
export interface DocExpression {
  id: string;
  targetTable: string;
  targetColumn: string;
  expression: string;
  sheet: string;
  rowNo: number;
}
export interface SqlAnalysis {
  statements: { type: string; table: string }[];
  sourceTables: { name: string; knownInWorkbook: boolean }[];
  functions: string[];
  clauses: string[];
  warnings: string[];
}

// ---------- Agent 3: source procedure SQL (sample files outside the workbook) ----------
export type SqlStepType = 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'SELECT_INTO' | 'EXEC' | 'MERGE';
export interface SqlColumnWrite {
  name: string;
  /** Display copy, whitespace-collapsed and clipped. */
  expression: string;
  /** Unclipped expression (comments removed), used for rule conversion. */
  expressionFull?: string;
}
export interface SqlJoin {
  /** INNER, LEFT, RIGHT, FULL, CROSS, or USING for a MERGE source. */
  kind: string;
  /** Logical table name, or "(subquery)". */
  table: string;
  alias: string;
  /** ON condition, verbatim (comments removed). */
  on: string;
}
export interface SqlStep {
  id: string;
  index: number;
  type: SqlStepType;
  /** Logical target table (schema and # prefixes removed, upper-case). Empty for EXEC. */
  table: string;
  tableKind: 'table' | 'working' | 'local-temp';
  columns: SqlColumnWrite[];
  reads: string[];
  callee: string;
  /** Enclosing IF/ELSE/WHILE conditions, verbatim and whitespace-collapsed. */
  guard: string;
  /**
   * The same enclosing conditions as SQL boolean text, one per level, unclipped: `(c)` for IF c, `NOT ((c))` for its
   * ELSE, `NOT ((a)) AND (b)` for ELSE IF b, `__WHILE__ (c)` for loops.
   */
  guards?: string[];
  /** Top-level WHERE condition, verbatim. */
  where?: string;
  joins?: SqlJoin[];
  /** Alias (upper-case) to logical table name, for resolving `A.Column`. */
  aliases?: Record<string, string>;
  /** Comment lines directly above the statement. */
  note: string;
  lineStart: number;
  lineEnd: number;
  /** Statement text with comments removed (strings kept). */
  sql: string;
  /** Status/monitoring bookkeeping, or inside a CATCH block. */
  housekeeping: boolean;
  functions: string[];
}
export interface ProcParam { name: string; type: string; defaultValue: string }
export interface ProcSource {
  id: string;
  name: string;
  /** Execution stage from the file name, e.g. S04. */
  stage: string;
  order: number;
  file: string;
  folder: string;
  author: string;
  created: string;
  modified: string;
  descriptions: string[];
  params: ProcParam[];
  testCases: { id: string; text: string }[];
  steps: SqlStep[];
  tablesRead: string[];
  tablesWritten: { table: string; columns: string[] }[];
  calls: string[];
  thresholds: string[];
  /** Dated change comments found in the source, verbatim. */
  changeLog: { line: number; text: string }[];
  lineCount: number;
}
export interface TraqColumnLink {
  procTable: string;
  procColumn: string;
  traqTable: string;
  traqColumn: string;
  stepIds: string[];
}
export interface ProcTrace {
  proc: string;
  writtenColumns: number;
  links: TraqColumnLink[];
  daRules: DaRule[];
  readTables: { name: string; inWorkbook: boolean }[];
  /** 'traceable' = at least one written column or DA rule ties to a TRAQ column. */
  status: 'traceable' | 'untraced';
  note: string;
}
export interface DdExport { available: boolean; file: string; header: string[]; rows: string[][]; note: string }

// ---------- Agent 4: mapping ----------
export type ReviewDecision = 'approved' | 'rejected';
export interface TargetSummary { table: string; layer: Layer; columns: number; fed: number; unfed: number; suggestions: number }
export interface Suggestion {
  id: string;
  targetTable: string;
  targetColumn: string;
  targetType: string;
  sourceTable: string;
  sourceColumn: string;
  sourceType: string;
  confidence: number; // 0-100, heuristic
  reasons: string[];
  issues: string[];
  compat: CompatLevel;
  ambiguous: boolean;
  origin: 'mock';
}
export interface UnfedColumn {
  targetTable: string;
  targetColumn: string;
  targetType: string;
  nullable: boolean | null;
  reason: string; // e.g. mapType from workbook or 'no mapping row'
  hasSuggestion: boolean;
  ambiguous: boolean;
}
export interface ManualMapping {
  id: string;
  targetTable: string;
  targetColumn: string;
  targetType: string;
  sourceTable: string;
  sourceColumn: string;
  sourceType: string;
  note: string;
  createdAt: string;
}
export interface ReviewedMapping {
  id: string;
  targetTable: string;
  targetColumn: string;
  targetType: string;
  sourceTable: string;
  sourceColumn: string;
  sourceType: string;
}
export interface MappingIssueSummary {
  collisions: MappingRow[];
  confirmationRequired: MappingRow[];
  typeWarnings: { mapping: MappingRow; compat: CompatLevel; note: string }[];
}

// ---------- Agent 5: rules ----------
export type RuleKind = 'mandatory' | 'default' | 'transform' | 'constraint' | 'derivation' | 'constant';
export interface BusinessRule {
  id: string;
  kind: RuleKind;
  table: string;
  column?: string;
  text: string;
  sheet: string;
  rowNo: number;
  origin: Origin;
}
export type Severity = 'pass' | 'warn' | 'fail';
export interface ValidationResult {
  id: string;
  checkId: string;
  check: string;
  severity: Severity;
  table: string;
  message: string;
  checked: number;
  flagged: number;
  items: string[];
}
export interface ValidationReport {
  results: ValidationResult[];
  totals: { pass: number; warn: number; fail: number };
  generatedAt: string;
  basis: string;
}
export interface ValidationRequest { reviewed: ReviewedMapping[] }

// ---------- Agent 5: CrisMac SQL -> TRAQ rule migration (Phase 10) ----------
/** How a CrisMac column was matched to TRAQ. Tiers in priority order: Agent 4 manual, Agent 4 approved, workbook, name match. */
export type MappingBasis = 'agent4-manual' | 'agent4-approved' | 'workbook' | 'name-match';
export type MappingStatus = 'approved' | 'documented' | 'name-match' | 'ambiguous' | 'missing';
export interface MappingCandidate {
  table: string;
  column: string;
  dataType: string;
  basis: MappingBasis;
  mapType?: string;
  sheet?: string;
  rowNo?: number;
}
export interface ColumnResolution {
  /** Logical CrisMac table (schema and # removed, upper-case) and column (upper-case). */
  crismacTable: string;
  crismacColumn: string;
  status: MappingStatus;
  chosen: MappingCandidate | null;
  candidates: MappingCandidate[];
  note: string;
}
export interface ParamResolution {
  name: string;
  /** mapped = replaced by a configured TRAQ expression; folded = replaced by a configured value; unresolved = left as a placeholder. */
  status: 'mapped' | 'folded' | 'unresolved';
  value: string;
  note: string;
}
export type ConversionStatus = 'converted' | 'needs-review' | 'failed';
export interface ConversionIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string }
export interface SourceStatementRef {
  stepId: string;
  stepIndex: number;
  type: SqlStepType;
  lineStart: number;
  lineEnd: number;
  /** CrisMac expression assigned to the column, verbatim. */
  expression: string;
  where: string;
  guards: string[];
  joins: SqlJoin[];
}
/** Template-neutral TRAQ rule content. Templates decide column names and formats. */
export interface TraqRuleFields {
  entity: string;
  column: string;
  columnType: string;
  derivationOption: string;
  expression: string;
  explanation: string;
  /** ISO yyyy-mm-dd; formatted per template on export. */
  effectiveStartDate: string;
  status: string;
  dataType: string;
  /** TRAQ columns the expression reads. */
  reads: string[];
  /** Provenance in the workbook's style, e.g. "DPD_Calculation 62-82". */
  crismac: string;
}
export interface ConvertedRule {
  /** `${procedure}::${crismacTable}.${crismacColumn}` - stable across re-runs of the same file. */
  id: string;
  procedure: string;
  procedureFile: string;
  stage: string;
  crismacTable: string;
  crismacColumn: string;
  statements: SourceStatementRef[];
  /** The rule in CrisMac terms after composing the statements in order (SQL-style text). */
  crismacLogic: string;
  target: ColumnResolution;
  references: ColumnResolution[];
  params: ParamResolution[];
  traq: TraqRuleFields;
  status: ConversionStatus;
  issues: ConversionIssue[];
  /** Heuristic score, not a model output. */
  confidence: { value: number; source: 'mock'; basis: string[] };
  /** Other procedures that write columns this rule reads. */
  dependencies: string[];
  origin: 'derived';
}
export interface ProcDependency { from: string; to: string; via: string; kind: 'data' | 'call' }
export interface ConversionSettings {
  /** ISO date used as Effective Start Date / IN FORCE FROM unless a rule overrides it. Empty = not set (export blocked). */
  effectiveStartDate: string;
  /** Known run-time values, e.g. { '@TIMEKEY': '26400' }: comparisons against them are folded. */
  paramValues: Record<string, string>;
  /** CrisMac parameter -> TRAQ expression; `{ENTITY}` is replaced by the rule's TRAQ table. */
  paramMappings: Record<string, string>;
}
export interface ConversionRequest { procedures: ProcSource[]; reviewed: ReviewedMapping[]; settings: ConversionSettings }
export interface ConversionStats { total: number; converted: number; needsReview: number; failed: number; withTarget: number; procedures: number }
export interface ConversionResult {
  rules: ConvertedRule[];
  dependencies: ProcDependency[];
  stats: ConversionStats;
  generatedAt: string;
  basis: string;
}
export interface TemplateColumn {
  header: string;
  /** Which TraqRuleFields value fills it, or a template-only value. */
  field: keyof TraqRuleFields | 'run' | 'version';
  mandatory: boolean;
  allowed?: string[];
  hint: string;
}
export interface RuleTemplate {
  id: 'dd-export' | 'fpm-da-rules';
  name: string;
  /** Where the structure was read from. */
  provenance: string;
  provisional: boolean;
  dateFormat: 'dd-mm-yyyy' | 'dd-Mon-yyyy';
  columns: TemplateColumn[];
  mandatoryBasis: string;
}
export interface UploadedSql { fileName: string; size: number; content: string }
export interface SqlFileAnalysis {
  fileName: string;
  size: number;
  procedure: ProcSource | null;
  warnings: string[];
  error?: string;
  /** Original SQL text, for preview. */
  content?: string;
}
export type RuleDecision = 'approved' | 'rejected';
export interface RuleEdit {
  traq?: Partial<TraqRuleFields>;
  decision?: RuleDecision;
  comment?: string;
  editedAt: string;
}
export interface ExportCheck { ruleId: string; field: string; severity: 'error' | 'warning'; message: string }

// ---------- Guidance chatbot (Phase 7) ----------
export type KnowledgeKind =
  | 'table' | 'column' | 'lineage' | 'mapping' | 'procedure' | 'rule' | 'relationship'
  | 'scope' | 'gap' | 'glossary' | 'documentation' | 'platform';
export interface SourceRef {
  kind: KnowledgeKind;
  /** Human-readable reference, e.g. "FCT_COLLATERAL.PERIOD_ID" or "docs/ARCHITECTURE.md > Layers". */
  label: string;
  sheet?: string;
  rowNo?: number;
  /** In-app route that shows this item, when one exists. */
  route?: string;
}
export interface KnowledgeChunk {
  id: string;
  kind: KnowledgeKind;
  title: string;
  /** Self-contained answer text. Lines starting with "- " are bullets; `code` and **bold** are supported. */
  text: string;
  /** Extra searchable words (not shown). */
  keywords: string[];
  /** Exact object names (UPPERCASE) this chunk is about: tables, columns, procedures. */
  entities: string[];
  sources: SourceRef[];
  origin: 'workbook' | 'derived' | 'documentation';
}
export interface DocInput { file: string; content: string }
export interface PlatformTopic { id: string; title: string; route?: string; text: string; keywords: string[] }
export interface RetrievedChunk { chunk: KnowledgeChunk; score: number; matchedOn: string[] }
export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface ChatRequest { question: string; history: ChatTurn[]; route?: string }
export type ChatIntent = 'smalltalk' | 'question';
export interface RetrievalResult { passages: RetrievedChunk[]; entities: string[]; intent: ChatIntent }
/** Everything a generator (template today, LLM later) is allowed to use. */
export interface ChatContext {
  question: string;
  history: ChatTurn[];
  route?: string;
  intent: ChatIntent;
  entities: string[];
  outOfScope: string[];
  passages: RetrievedChunk[];
  grounded: boolean;
}
export type AnswerKind = 'grounded' | 'not-found' | 'smalltalk';
export interface ChatAnswer {
  kind: AnswerKind;
  text: string;
  sources: SourceRef[];
  followUps: string[];
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  answer?: ChatAnswer;
  meta?: ApiMeta;
  isError?: boolean;
  /** AI answer details (set by the streaming assistant). */
  ai?: {
    sources: ChatSource[]; kind: AnswerKind; provider?: string; model?: string; retrieval?: 'hybrid' | 'keyword'; note?: string;
    /** Output-guardrail flag: a heuristic, never a silent rewrite of the answer. */
    warning?: 'unverified-claim' | 'fabricated-citation';
  };
  /** True while tokens are still arriving. */
  streaming?: boolean;
  /** Gateway error code for failed answers, e.g. RATE_LIMITED. */
  errorCode?: string;
}

// ---------- Dashboard ----------
export interface CoverageRow { table: string; layer: Layer; fed: number; total: number; pct: number }
export interface DashboardSummary {
  tables: { traq: number; source: number; total: number; byLayer: { name: string; value: number }[] };
  mappings: { total: number; feeding: number; nonFeeding: number; byMapType: { name: string; value: number }[] };
  coverage: { fed: number; total: number; pct: number; byTable: CoverageRow[] };
  suggestions: number;
  procedures: { total: number; byKind: { name: string; value: number }[] };
  rules: { total: number; byKind: { name: string; value: number }[] };
  validation: { pass: number; warn: number; fail: number };
  unmappedSource: number;
  unresolvedDecisions: number;
}
