import { config } from '@/config';
import type { ApiResult } from '@/types';
import type { Services } from './types';

// Real-backend implementations (FastAPI). Only the transport lives here; the UI never knows which one is active.

async function request<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, body?: unknown): Promise<ApiResult<T>> {
  const qs = params
    ? '?' + Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const started = performance.now();
  try {
    const res = await fetch(`${config.apiBaseUrl}${path}${qs}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as ApiResult<T>;
    if (!res.ok && !json.error) return { data: null, meta: { simulated: false, requestId: '', latencyMs: Math.round(performance.now() - started) }, error: { code: String(res.status), message: res.statusText } };
    return json;
  } catch (e) {
    return { data: null, meta: { simulated: false, requestId: '', latencyMs: Math.round(performance.now() - started) }, error: { code: 'NETWORK', message: e instanceof Error ? e.message : String(e) } };
  }
}

const ep = config.endpoints;
const get = <T>(p: string, q?: Record<string, unknown>) => request<T>('GET', p, q);
const post = <T>(p: string, b: unknown) => request<T>('POST', p, undefined, b);

export function createHttpServices(): Omit<Services, 'ai' | 'assistant' | 'decisions' | 'jobs'> {
  return {
    chat: {
      ask: (req) => post(ep.chatAsk, req),
      getSuggestedQuestions: (route) => get(ep.chatSuggestions, { route }),
    },
    dataModel: {
      getScope: () => get(ep.scope),
      listTables: (q) => get(ep.tables, q),
      getTable: (name) => get(`${ep.tables}/${encodeURIComponent(name)}`),
      compare: (source, target) => get(ep.compare, { source, target }),
      exportMetadata: () => get(ep.export),
      getRelationships: (table) => get(`${ep.tables}/${encodeURIComponent(table)}/relationships`),
    },
    lineage: {
      getGraph: (o) => get(ep.lineage, { ...o }),
      getCatalog: (o) => get(ep.lineageCatalog, { ...o }),
      getFlow: (req) => post(ep.lineageFlow, req),
      getEdgeMappings: (source, target) => get(ep.lineageEdge, { source, target }),
      traceColumn: (table, column, direction) => get(ep.lineageTrace, { table, column, direction }),
      listColumns: (table) => get(`${ep.tables}/${encodeURIComponent(table)}/columns`),
    },
    procedures: {
      listObjects: () => get(ep.procedures),
      listExpressions: () => get(ep.expressions),
      explain: (id) => get(`${ep.procedures}/${encodeURIComponent(id)}/explain`),
      analyzeSql: (sql) => post(ep.analyzeSql, { sql }),
      listSources: () => get(ep.procSources),
      listTraces: () => get(`${ep.procSources}/traces`),
      getDdExport: (name) => get(`${ep.procSources}/${encodeURIComponent(name)}/dd-export`),
    },
    mapping: {
      listTargets: () => get(ep.mappingTargets),
      getDocumented: (table) => get(ep.mappingDocumented, { target: table }),
      getSuggestions: (table, opts) => post(ep.mappingSuggest, { targetTable: table, enrichment: opts }),
      getUnfed: (table) => get(ep.mappingUnfed, { target: table }),
      getAnalysis: (table, reviewed, opts) => post(ep.mappingAnalysis, { targetTable: table, reviewed: reviewed ?? [], enrichment: opts }),
      getIssues: (table) => get(`${ep.mappingDocumented}/issues`, { target: table }),
      listAllTables: () => get(`${ep.tables}?withColumns=true`),
      submitReview: (id, decision, comment) => post(ep.mappingReview, { id, decision, comment }),
    },
    rules: {
      listRules: () => get(ep.rules),
      validate: (req) => post(ep.rulesValidate, req),
      submitReview: (id, decision, comment) => post(ep.rulesReview, { id, decision, comment }),
    },
    ruleConversion: {
      analyzeFiles: (files) => post(ep.conversionAnalyze, { files }),
      loadSamples: () => get(ep.conversionSamples),
      listTemplates: () => get(ep.conversionTemplates),
      convert: (req) => post(ep.conversionConvert, req),
      migrateDd: (req) => post(ep.conversionMigrateDd, req),
    },
    dashboard: { getSummary: () => get(ep.dashboard) },
  };
}
