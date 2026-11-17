import type {
  ApiResult, BusinessRule, CatalogEntry, FlowRequest, LineageFlow, ChatAnswer, ChatRequest, DdExport, ProcSource, ProcTrace, DashboardSummary, DocExpression, LineageGraph, LineageOptions, Layer, MappingIssueSummary,
  MappingRow, ProcObject, Relationship, ReviewDecision, ScopeInfo, SqlAnalysis, Suggestion, SystemKind, TableComparison, TableDetail,
  TableSummary, TargetSummary, TraceNode, UnfedColumn, ValidationReport, ValidationRequest, WorkbookModel,
} from '@/types';

export interface DataModelService {
  getScope(): Promise<ApiResult<ScopeInfo>>;
  listTables(q?: { system?: SystemKind; layer?: Layer; search?: string }): Promise<ApiResult<TableSummary[]>>;
  getTable(name: string): Promise<ApiResult<TableDetail>>;
  compare(source: string, target: string): Promise<ApiResult<TableComparison>>;
  getRelationships(table: string): Promise<ApiResult<Relationship[]>>;
  /** The full structured metadata extracted from the workbook (tables, columns, mappings, rules). */
  exportMetadata(): Promise<ApiResult<WorkbookModel>>;
}

export interface LineageService {
  getGraph(opts: LineageOptions): Promise<ApiResult<LineageGraph>>;
  /** Every table that has lineage, with upstream/downstream counts, for the table picker. */
  getCatalog(opts: LineageOptions): Promise<ApiResult<CatalogEntry[]>>;
  /** Column-level flow for the selected tables: upstream/downstream tables, column mappings, documented procedures. */
  getFlow(req: FlowRequest): Promise<ApiResult<LineageFlow>>;
  getEdgeMappings(source: string, target: string): Promise<ApiResult<MappingRow[]>>;
  traceColumn(table: string, column: string, direction: 'upstream' | 'downstream'): Promise<ApiResult<TraceNode>>;
  listColumns(table: string): Promise<ApiResult<string[]>>;
}

export interface ProcedureService {
  listObjects(): Promise<ApiResult<ProcObject[]>>;
  listExpressions(): Promise<ApiResult<DocExpression[]>>;
  explain(id: string): Promise<ApiResult<{ summary: string[] }>>;
  analyzeSql(sql: string): Promise<ApiResult<SqlAnalysis>>;
  /** Parsed sample procedure SQL (outside the workbook), in execution order. */
  listSources(): Promise<ApiResult<ProcSource[]>>;
  /** Links from each source procedure to TRAQ columns and FPM_DA_RULES rows. */
  listTraces(): Promise<ApiResult<ProcTrace[]>>;
  getDdExport(procedure: string): Promise<ApiResult<DdExport>>;
}

export interface MappingService {
  listTargets(): Promise<ApiResult<TargetSummary[]>>;
  getDocumented(table: string): Promise<ApiResult<MappingRow[]>>;
  getSuggestions(table: string): Promise<ApiResult<Suggestion[]>>;
  getUnfed(table: string): Promise<ApiResult<UnfedColumn[]>>;
  getIssues(table: string): Promise<ApiResult<MappingIssueSummary>>;
  listAllTables(): Promise<ApiResult<{ name: string; columns: { name: string; dataType: string }[] }[]>>;
  submitReview(id: string, decision: ReviewDecision, comment: string): Promise<ApiResult<{ id: string; decision: ReviewDecision }>>;
}

export interface RuleService {
  listRules(): Promise<ApiResult<BusinessRule[]>>;
  validate(req: ValidationRequest): Promise<ApiResult<ValidationReport>>;
  submitReview(id: string, decision: ReviewDecision, comment: string): Promise<ApiResult<{ id: string; decision: ReviewDecision }>>;
}

export interface DashboardService {
  getSummary(): Promise<ApiResult<DashboardSummary>>;
}

export interface ChatService {
  /** Answer a question using only retrieved project knowledge; returns a grounded answer or an explicit not-found. */
  ask(req: ChatRequest): Promise<ApiResult<ChatAnswer>>;
  getSuggestedQuestions(route?: string): Promise<ApiResult<string[]>>;
}

export interface Services {
  chat: ChatService;
  dataModel: DataModelService;
  lineage: LineageService;
  procedures: ProcedureService;
  mapping: MappingService;
  rules: RuleService;
  dashboard: DashboardService;
}
