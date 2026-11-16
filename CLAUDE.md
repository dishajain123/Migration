# CLAUDE.md - AI-First CrisMAC -> TRAQ Migration Platform

Frontend demonstration now; production-grade AI migration platform later. Every decision must allow backend/DB/LLM integration WITHOUT a frontend rewrite.

## Source of truth and scope
- Workbook (`CrisMac_to_TRAQ_Combined.csv` / original xlsx) is the only source of truth. See `docs/DATA_DICTIONARY.md` (scope, structure, known gaps).
- Scope: tables up to and including FCT_PRODUCT_MASTER and their dependencies. Do NOT add FCT_NPA_*, FCT_PRODUCT_MASTER_AGG, FCT_SMA_EVALUATION or anything downstream.
- NEVER fabricate metadata, mappings, SQL or business rules. If the workbook lacks it, show "Not provided in workbook". There is no stored-procedure SQL in the workbook; for objects other than the 14 sample procedures Agent 3 shows only documented logic and object names. The sample procedures' SQL (`public/data/latest dd output/`, see the Phase 8 section) is a second, verbatim input: show it as written, derive structure by pattern matching, never rewrite or "translate" it.
- Any simulated/mocked value (confidence %, validation results, procedure explanations, readiness scores) must be labelled `Simulated` in the UI and flagged `source: 'mock'` in the data model. Workbook-derived data is `source: 'workbook'`.

## Stack
React + TypeScript + Vite, Tailwind, shadcn/ui, Lucide, React Flow, Recharts, Zustand. No AI SDKs, no backend, no DB in the frontend.

## Architecture rules
- Layers: `src/types` (shared models) -> `src/data` (generated workbook JSON + mock fixtures) -> `src/services` (interfaces + mock implementations + http implementations, one per agent) -> `src/stores` (Zustand) -> `src/features/<agent>` (UI) -> `src/components` (shared).
- UI components contain NO business logic; derive data in services/selectors.
- Each agent has an interface in `src/services/<agent>/<Agent>Service.ts`; the mock implementation is async (latency, error injection) and returns `ApiResult<T>` envelopes. Swapping to HTTP changes only `src/services/index.ts` via `VITE_API_BASE_URL` and `VITE_USE_MOCKS`.
- Frontend must not depend on any AI provider; model/provider names appear only in response metadata.
- Every async view handles loading, error, empty, success.
- Dark/light theme via CSS variables; responsive; accessible.

## Phases (track in docs/IMPLEMENTATION_PLAN.md)
0 Foundation, 1 Data Model, 2 Lineage, 3 Procedures, 4 Mapping, 5 Rules, 6 Integration, 7 Guidance chatbot and resizable sidebar, 8 Source procedure SQL and TRAQ traceability. Finish, build, test and document each phase before the next. One phase per cycle.

## Guidance chatbot and sidebar (Phase 7)
- The chatbot is a mock RAG pipeline, never an LLM. `ChatService` (`src/services/types.ts`) composes three swappable stages from `src/services/chat/pipeline.ts`: `KnowledgeRetriever` -> `ContextBuilder` -> `ResponseGenerator` (plus `SuggestionProvider`). Real RAG replaces the stages (embeddings + vector DB + LLM) or the whole service via `http.ts` (`/chat/ask`).
- Pure logic lives in `src/domain/knowledge.ts` (workbook model + `src/data/docs.ts` + `src/data/platformGuide.ts` -> chunks), `retrieval.ts` (BM25 + exact object-name match) and `answer.ts` (grounding decision + templates). Do not duplicate workbook logic: chunks are built from existing selectors (`lineage`, `procedures`, `rules`, `relationships`, `selectors`).
- Answers may only restate retrieved chunk text. If retrieval is weak the answer is `not-found` with no sources; never fill gaps. Every answer shows a `Simulated` badge and source references (sheet/row/doc heading, linking to the app route where one exists).
- When a screen, tab or button changes, update `src/data/platformGuide.ts`; when docs change, `src/data/docs.ts` already picks them up at build time. Add new knowledge by adding chunks in `knowledge.ts`, not by special-casing answers.
- UI: `src/components/chat/*` (reusable, no business logic), state in `src/stores/chatStore.ts` (session-scoped) and `layoutStore.ts` (sidebar and panel sizes, localStorage).
- Sidebar: collapse button + pointer-drag handle (`usePointerDrag`), widths in `SIDEBAR` constants, icon tooltips when collapsed, mobile keeps the drawer. Drag below `SIDEBAR.snapBelow` collapses.

## Source procedure SQL and TRAQ traceability (Phase 8)
- Inputs: 14 CrisMac procedure SQL files in `public/data/latest dd output/<proc>/` listed in `manifest.json`, plus an optional `dd_export.csv` per folder (the `.xlsx` files cannot be read; export to CSV). Loader: `src/services/procSource.ts` (mock services only; handles UTF-16 and the dev server's HTML fallback).
- Pure logic: `src/domain/sqlParse.ts` (statements, columns, expressions, guards, header, change comments) and `src/domain/procTrace.ts` (links to TRAQ columns and FPM_DA_RULES, Agent 5 rules, check C8). UI: `src/features/procedures/SourceProcedures.tsx`.
- "Migration" here means traceability, not code generation: each written column is linked to a TRAQ column only by name match or an FPM_DA_RULES row; unlinked procedures are shown as "no documented TRAQ link" (their outputs may be NPA/SMA tables, out of scope). Never generate TRAQ SQL or invent mappings; label links as derived.
- Procedure-derived rules flow to Agent 5 (kind `derivation`, origin `derived`, provenance SQL file and line) and to the chatbot index. Keep `KNOWN_GAPS` and `platformGuide.ts` in step when this changes.

## Coding standards
Strict TS, no `any`, small components, named exports, no dead buttons (every control works or is removed), run `npm run build` before declaring a phase done. Keep docs current; link rather than duplicate.

## Skills
`.claude/skills/*/SKILL.md`: frontend-development, data-model-understanding, data-lineage-visualization, sql-procedure-analysis, migration-mapping, business-rule-validation, api-integration-readiness, guidance-chatbot.

## Workbook input
The app reads `public/data/CrisMac_to_TRAQ_Combined.csv` at runtime (Papa Parse, `src/domain/parse.ts`). No Excel parsing and no extraction script. Sheet shapes A/B/C are documented in DATA_DICTIONARY.md.

## Environment note
All code was written where shell execution was blocked (group policy). It has NOT been compiled or run. Use `npm run typecheck` / `npm run build` (no lint script is configured). See docs/IMPLEMENTATION_PLAN.md first-run checklist.
