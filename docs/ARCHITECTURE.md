# Architecture

```
public/data/CrisMac_to_TRAQ_Combined.csv --(fetch + Papa Parse, domain/parse.ts)--> WorkbookModel (cached)
types (shared) -> domain (pure logic) -> services (interface | mock | http) -> stores (Zustand) -> features/<agent> -> components
Only the MOCK services import the workbook; a real backend replaces them without touching features/ or domain/ consumers.
```
- Agents: dataModel, lineage, procedures, mapping, rules. Each has `XService` interface; `src/services/index.ts` picks mock vs http from env (`VITE_USE_MOCKS`, `VITE_API_BASE_URL`).
- Envelope `ApiResult<T>` carries `meta.simulated` so UI can badge simulated output.
- Shell: sidebar (Dashboard + 5 agents), theme toggle, global scope badge "Up to FCT_PRODUCT_MASTER".
- Dashboard metrics are selectors over generated data + stores; mock-derived ones carry a Simulated badge.
- Shell layout (Phase 7): the sidebar can be collapsed to icons with a toggle button or resized by dragging its right edge (`layoutStore`, `usePointerDrag`); on small screens it is a slide-over drawer. A floating chat button, mounted once in `Layout`, opens the guidance panel on every screen.
- Guidance chatbot (Phase 7): `ChatService.ask` runs `KnowledgeRetriever` -> `ContextBuilder` -> `ResponseGenerator` (`src/services/chat/pipeline.ts`). The mock stages use `domain/knowledge.ts` (chunks from the workbook model, project docs and platform guide), `domain/retrieval.ts` (BM25 plus exact table/column/procedure name matching) and `domain/answer.ts` (grounding check and template answers). Replacing the stages with embeddings, a vector database and an LLM does not change `ChatService`, the store or the UI.
- Future: FastAPI routers per agent (`/api/v1/<agent>/...`), Pydantic models mirroring `src/types`, LLM provider adapter behind the backend only.
