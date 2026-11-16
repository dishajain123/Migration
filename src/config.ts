const env = import.meta.env;

export const config = {
  useMocks: (env.VITE_USE_MOCKS ?? 'true') !== 'false',
  apiBaseUrl: (env.VITE_API_BASE_URL ?? '/api/v1') as string,
  mockLatencyMs: Number(env.VITE_MOCK_LATENCY_MS ?? 250),
  mockErrorRate: Number(env.VITE_MOCK_ERROR_RATE ?? 0),
  workbookCsvUrl: `${env.BASE_URL}data/CrisMac_to_TRAQ_Combined.csv`,
  /** Sample procedure SQL, manifest.json and dd_export.csv files (served from public/). */
  procSourcesBase: `${env.BASE_URL}data/latest%20dd%20output/`,
  /** Future backend endpoints (see docs/API_CONTRACTS.md). */
  endpoints: {
    tables: '/datamodel/tables',
    compare: '/datamodel/compare',
    scope: '/datamodel/scope',
    export: '/datamodel/export',
    lineage: '/lineage/graph',
    lineageTrace: '/lineage/trace',
    lineageEdge: '/lineage/edge',
    procedures: '/procedures',
    expressions: '/procedures/expressions',
    procSources: '/procedures/sources',
    analyzeSql: '/procedures/analyze',
    mappingTargets: '/mappings/targets',
    mappingSuggest: '/mappings/suggest',
    mappingDocumented: '/mappings',
    mappingUnfed: '/mappings/unfed',
    mappingReview: '/mappings/review',
    rules: '/rules',
    rulesValidate: '/rules/validate',
    rulesReview: '/rules/review',
    dashboard: '/dashboard/summary',
    chatAsk: '/chat/ask',
    chatSuggestions: '/chat/suggestions',
  },
} as const;
