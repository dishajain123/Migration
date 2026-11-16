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
| | `GET /lineage/edge?source=&target=` | query | `MappingRow[]` |
| | `GET /lineage/trace?table=&column=&direction=` | query | `TraceNode` |
| | `GET /datamodel/tables/{name}/columns` | - | `string[]` |
| Procedures | `GET /procedures` | - | `ProcObject[]` |
| | `GET /procedures/expressions` | - | `DocExpression[]` |
| | `GET /procedures/{id}/explain` | - | `{ summary: string[] }` |
| | `POST /procedures/analyze` | `{ sql }` | `SqlAnalysis` |
| Mapping | `GET /mappings/targets` | - | `TargetSummary[]` |
| | `GET /mappings?target=` | query | `MappingRow[]` |
| | `POST /mappings/suggest` | `{ targetTable }` | `Suggestion[]` |
| | `GET /mappings/unfed?target=` | query | `UnfedColumn[]` |
| | `GET /mappings/issues?target=` | query | `MappingIssueSummary` |
| | `POST /mappings/review` | `{ id, decision, comment }` | `{ id, decision }` |
| Rules | `GET /rules` | - | `BusinessRule[]` |
| | `POST /rules/validate` | `ValidationRequest` | `ValidationReport` |
| | `POST /rules/review` | `{ id, decision, comment }` | `{ id, decision }` |
| Dashboard | `GET /dashboard/summary` | - | `DashboardSummary` |

Known mismatch to resolve when the backend is built: `MappingService.listAllTables` currently maps to `GET /datamodel/tables?withColumns=true`, which needs a column-bearing variant of `TableSummary`.

Open: authentication, streaming for LLM-backed endpoints, pagination for large lists, review persistence (currently browser-only).
