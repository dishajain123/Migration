import type {
  ApiResult, BusinessRule, DashboardSummary, DocExpression, LineageGraph, LineageOptions, Layer, MappingIssueSummary,
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
  getEdgeMappings(source: string, target: string): Promise<ApiResult<MappingRow[]>>;
  traceColumn(table: string, column: string, direction: 'upstream' | 'downstream'): Promise<ApiResult<TraceNode>>;
  listColumns(table: string): Promise<ApiResult<string[]>>;
}

export interface ProcedureService {
  listObjects(): Promise<ApiResult<ProcObject[]>>;
  listExpressions(): Promise<ApiResult<DocExpression[]>>;
  explain(id: string): Promise<ApiResult<{ summary: string[] }>>;
  analyzeSql(sql: string): Promise<ApiResult<SqlAnalysis>>;
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

export interface Services {
  dataModel: DataModelService;
  lineage: LineageService;
  procedures: ProcedureService;
  mapping: MappingService;
  rules: RuleService;
  dashboard: DashboardService;
}
