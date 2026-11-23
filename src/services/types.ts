import type {
  ApiResult, BusinessRule, CatalogEntry, ConversionRequest, ConversionResult, FlowRequest, LineageFlow, RuleTemplate, SqlFileAnalysis, UploadedSql, ChatAnswer, ChatRequest, DdExport, DdMigrationResult, ProcSource, ProcTrace, DashboardSummary, DocExpression, LineageGraph, LineageOptions, Layer, MappingIssueSummary,
  MappingRow, ProcObject, Relationship, ReviewDecision, ScopeInfo, SqlAnalysis, Suggestion, SystemKind, TableComparison, TableDetail,
  TableSummary, TableAnalysis, TargetSummary, TraceNode, UnfedColumn, ValidationReport, ValidationRequest, WorkbookModel, ReviewedMapping,
} from '@/types';
import type { AiInsight, ChatStreamEvent, ModelChoice, ProviderId } from '@/types/ai';

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
  /** Per-column status (resolved / suggested / below-threshold / no-match / insufficient-context / declared-unmapped) with the candidate trace. Reviewer decisions resolve columns. */
  getAnalysis(table: string, reviewed?: ReviewedMapping[]): Promise<ApiResult<TableAnalysis>>;
  getIssues(table: string): Promise<ApiResult<MappingIssueSummary>>;
  listAllTables(): Promise<ApiResult<{ name: string; columns: { name: string; dataType: string }[] }[]>>;
  submitReview(id: string, decision: ReviewDecision, comment: string): Promise<ApiResult<{ id: string; decision: ReviewDecision }>>;
}

export interface RuleService {
  listRules(): Promise<ApiResult<BusinessRule[]>>;
  validate(req: ValidationRequest): Promise<ApiResult<ValidationReport>>;
  submitReview(id: string, decision: ReviewDecision, comment: string): Promise<ApiResult<{ id: string; decision: ReviewDecision }>>;
}

/** Agent 5 rule migration: CrisMac SQL in, TRAQ rule rows out. Mock today; FastAPI (and later an LLM-assisted extractor) behind the same contract. */
export interface RuleConversionService {
  /** Parse uploaded SQL files (Agent 3 parser): procedures, statements, joins, conditions, warnings. */
  analyzeFiles(files: UploadedSql[]): Promise<ApiResult<SqlFileAnalysis[]>>;
  /** The 14 sample procedures shipped beside the workbook, analysed the same way. */
  loadSamples(): Promise<ApiResult<SqlFileAnalysis[]>>;
  /** TRAQ rule layouts found in the project (dd_export, FPM_DA_RULES). */
  listTemplates(): Promise<ApiResult<RuleTemplate[]>>;
  /** Extract rules, resolve CrisMac columns through Agent 4 mappings, translate to TRAQ syntax. */
  convert(req: ConversionRequest): Promise<ApiResult<ConversionResult>>;
  /** Corrected rules from the project's dd_export.csv files, with CrisMac names replaced by confirmed TRAQ columns; unmapped rules stay separate. */
  migrateDd(req: { reviewed: ReviewedMapping[] }): Promise<ApiResult<DdMigrationResult>>;
}

export interface DashboardService {
  getSummary(): Promise<ApiResult<DashboardSummary>>;
}

export interface ChatService {
  /** Answer a question using only retrieved project knowledge; returns a grounded answer or an explicit not-found. */
  ask(req: ChatRequest): Promise<ApiResult<ChatAnswer>>;
  getSuggestedQuestions(route?: string): Promise<ApiResult<string[]>>;
}

/**
 * AI features for Agents 1-5, run through the AI gateway with the user's active provider/model. Always real HTTP to
 * the gateway (keys live server-side); the workbook context it sends comes from the other services.
 * Failures carry gateway codes: NOT_CONFIGURED, INVALID_KEY, RATE_LIMITED, INCOMPATIBLE, BAD_OUTPUT, ...
 */
export interface AgentAiService {
  /** Every method takes an optional one-off provider/model, used when the user retries after a rate limit. */
  briefTable(name: string, o?: ModelChoice): Promise<ApiResult<AiInsight>>;
  explainFlow(req: FlowRequest, o?: ModelChoice): Promise<ApiResult<AiInsight>>;
  explainProcedure(objectId: string, o?: ModelChoice): Promise<ApiResult<AiInsight>>;
  explainSourceProcedure(name: string, o?: ModelChoice): Promise<ApiResult<AiInsight>>;
  rankMappings(table: string, o?: ModelChoice): Promise<ApiResult<AiInsight>>;
  reviewValidation(reviewed: ReviewedMapping[], o?: ModelChoice): Promise<ApiResult<AiInsight>>;
}

/** The AI chatbot (RAG + streaming, via the AI gateway). Replaces the template-based ChatService in the UI. */
export interface AssistantService {
  askStream(
    req: ChatRequest, onEvent: (e: ChatStreamEvent) => void, opts?: { override?: ModelChoice; signal?: AbortSignal },
  ): Promise<ApiResult<{ kind: 'grounded' | 'not-found' | 'smalltalk'; provider?: ProviderId; model?: string }>>;
  getSuggestedQuestions(route?: string): Promise<ApiResult<string[]>>;
}

export interface Services {
  ai: AgentAiService;
  assistant: AssistantService;
  chat: ChatService;
  dataModel: DataModelService;
  lineage: LineageService;
  procedures: ProcedureService;
  mapping: MappingService;
  rules: RuleService;
  ruleConversion: RuleConversionService;
  dashboard: DashboardService;
}
