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
