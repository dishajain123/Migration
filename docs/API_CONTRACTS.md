# Future API Contracts (draft - nothing is implemented server-side)

Base: `${VITE_API_BASE_URL}/api/v1`. The frontend already calls these paths when `VITE_USE_MOCKS=false` (`src/services/http.ts`, paths in `src/config.ts`).
Every response uses the envelope:

```json
{ "data": <T>, "meta": { "simulated": false, "requestId": "...", "latencyMs": 12, "provider": null, "model": null, "note": null }, "error": null }
```
On failure `data` is null and `error` is `{ "code": "...", "message": "..." }`. `meta.simulated=true` makes the UI show a Simulated badge. Request/response bodies mirror `src/types/index.ts` (Pydantic equivalents).

| Agent | Method + path | Request | Response `data` |
|---|---|---|---|
| Data model | `GET /datamodel/scope` | - | `ScopeInfo` |
| | `GET /datamodel/tables?system=&layer=&search=` | query | `TableSummary[]` |
| | `GET /datamodel/tables/{name}` | - | `TableDetail` |
| | `GET /datamodel/tables/{name}/relationships` | - | `Relationship[]` |
| | `GET /datamodel/export` | - | `WorkbookModel` (full structured metadata) |
| | `GET /datamodel/compare?source=&target=` | query | `TableComparison` |
| Lineage | `GET /lineage/graph?includeNotUsed=&internalOnly=` | query | `LineageGraph` |
| | `GET /lineage/catalog?includeNotUsed=&internalOnly=` | query | `CatalogEntry[]` (table picker) |
| | `POST /lineage/flow` | `FlowRequest` | `LineageFlow` (column-level flow for the selected tables) |
| | `GET /lineage/edge?source=&target=` | query | `MappingRow[]` |
| | `GET /lineage/trace?table=&column=&direction=` | query | `TraceNode` |
| | `GET /datamodel/tables/{name}/columns` | - | `string[]` |
| Procedures | `GET /procedures` | - | `ProcObject[]` |
| | `GET /procedures/expressions` | - | `DocExpression[]` |
| | `GET /procedures/{id}/explain` | - | `{ summary: string[] }` |
| | `POST /procedures/analyze` | `{ sql }` | `SqlAnalysis` |
| | `GET /procedures/sources` | - | `ProcSource[]` (parsed procedure SQL, execution order) |
| | `GET /procedures/sources/traces` | - | `ProcTrace[]` (links to TRAQ columns and FPM_DA_RULES) |
| | `GET /procedures/sources/{name}/dd-export` | - | `DdExport` |
| Mapping | `GET /mappings/targets` | - | `TargetSummary[]` |
| | `GET /mappings?target=` | query | `MappingRow[]` |
| | `POST /mappings/suggest` | `{ targetTable }` | `Suggestion[]` |
| | `GET /mappings/unfed?target=` | query | `UnfedColumn[]` |
| | `GET /mappings/issues?target=` | query | `MappingIssueSummary` |
| | `POST /mappings/review` | `{ id, decision, comment }` | `{ id, decision }` |
| Rules | `GET /rules` | - | `BusinessRule[]` |
| | `POST /rules/validate` | `ValidationRequest` | `ValidationReport` |
| | `POST /rules/review` | `{ id, decision, comment }` | `{ id, decision }` |
| Rule conversion | `POST /rule-conversion/analyze` | `{ files: UploadedSql[] }` | `SqlFileAnalysis[]` |
| | `GET /rule-conversion/samples` | - | `SqlFileAnalysis[]` (the 14 sample procedures) |
| | `GET /rule-conversion/templates` | - | `RuleTemplate[]` |
| | `POST /rule-conversion/convert` | `ConversionRequest` (procedures, Agent 4 reviewed mappings, settings) | `ConversionResult` |

Rule conversion notes: reviewer decisions and field edits (`RuleEdit`) stay client-side today (`stores/conversionStore`); a backend would add `POST /rule-conversion/review`. File generation (CSV/XLSX) is done in the browser from `traqRuleDoc`; a backend may return the same bytes. An LLM-assisted extractor can replace `convertProcedures` behind `/convert` provided it returns the same `ConvertedRule` shape, keeps `issues` for every assumption and marks model output `simulated: true` with provider/model in `ApiMeta`.
| Dashboard | `GET /dashboard/summary` | - | `DashboardSummary` |
| Chat | `POST /chat/ask` | `ChatRequest` (`question`, `history[]`, `route?`) | `ChatAnswer` (`kind`, `text`, `sources[]`, `followUps[]`) |
| | `GET /chat/suggestions?route=` | query | `string[]` |

For `/chat/ask` a real backend would run retrieval (embeddings plus a vector database), build the prompt and call an LLM restricted to the retrieved context, returning `kind: 'not-found'` with no sources when nothing relevant is found. Provider and model names appear only in `meta`. Streaming is an open item.

Known mismatch to resolve when the backend is built: `MappingService.listAllTables` currently maps to `GET /datamodel/tables?withColumns=true`, which needs a column-bearing variant of `TableSummary`.

Open: authentication, streaming for LLM-backed endpoints, pagination for large lists, review persistence (currently browser-only).
