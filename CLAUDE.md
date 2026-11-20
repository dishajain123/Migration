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
0 Foundation, 1 Data Model, 2 Lineage, 3 Procedures, 4 Mapping, 5 Rules, 6 Integration, 7 Guidance chatbot and resizable sidebar, 8 Source procedure SQL and TRAQ traceability, 9 Column-level lineage explorer, 10 CrisMac SQL -> TRAQ rule migration, 11 Application-wide UX pass (planned). Finish, build, test and document each phase before the next. One phase per cycle.

## Lineage explorer (Phase 9)
- Pure logic in `src/domain/lineageFlow.ts` (traversal, column edges, grouping, layout); service methods `getCatalog` and `getFlow`; UI in `src/features/lineage/*`. Arrows are workbook mapping rows only; direct vs transformed comes from MAP TYPE, transformation text is the workbook remark verbatim. Do not add layout or tracing logic to components.
- Reusable help: `src/components/InfoTip.tsx` (`InfoTip`, `Term`). Motion is CSS only (`anim-*` classes, disabled under reduced motion). Backlog and acceptance criteria for Phases 9-11: docs/IMPLEMENTATION_PLAN.md.

## CrisMac SQL -> TRAQ rule migration (Phase 10)
- Agent 5 tab "CrisMac SQL → TRAQ rules" (`/rules?tab=convert`): upload -> analyse (Agent 3 parser) -> map (Agent 4 + workbook) -> review -> export. Pure logic in `src/domain/ruleConversion/` (one module per stage, see the business-rule-validation skill); service `RuleConversionService`; UI `src/features/rules/conversion/`.
- Output layouts come from real files only: `dd_export.csv` header and FPM_DA_RULES row 4. Rules must reference TRAQ tables/columns via existing mappings; unmapped columns, unset parameters and unsupported SQL stay as `[[...]]` placeholders that block export. New mappings go into Agent 4's store (manual mappings), never a separate list. Conversion is rule-based (not AI); confidence is labelled Simulated.
- `resolveColumn` (`src/domain/ruleConversion/resolve.ts`) tries, in order: Agent 4 manual mappings, Agent 4 approved suggestions, documented workbook mappings, an exact TRAQ name match, then (last resort) `suggest.ts`'s `suggestTraqColumnsForColumn` - the same name-token + type-family heuristic Agent 4 uses, scored against every in-scope TRAQ column instead of only a table's unfed pool. A hit renders the real TRAQ column text (status `suggested`, basis `agent4-suggestion`, a `confidence` score) instead of `[[UNMAPPED ...]]`, but still blocks export (`REF_SUGGESTED`/`TARGET_SUGGESTED` issues, checked explicitly in `templates.ts validateForExport` since there's no `[[...]]` text to pattern-match) until it is turned into a real mapping via Agent 4's "Map" action (pre-filled with the suggestion). Still Simulated, still never auto-approved. The candidate pool excludes `traqOnly` columns (the workbook's own statement that a column has no CrisMac source) - never suggest mapping onto one.
- `translate.ts` flags `ARG_NOT_SIMPLE` when `ISEMPTY`/`ISNOTEMPTY`/`DATEDIFF` are given a computed sub-expression instead of a bare column/variable, since the workbook's rule-reference only evidences that argument shape.
- Known, deliberately unimplemented correctness gaps (documented rather than guessed at with a fragile heuristic): (1) no check for a `DATEDIFF` call left unguarded by a NULL check, even though the TRAQ reference names this as a run-time failure mode - detecting "is this guarded" reliably would need parent-aware guard tracking through arbitrary CASE/IF nesting, which risks false positives/negatives more than it helps; (2) `compat()` (`typeUtils.ts`) does not cross-check a mapping's source-column nullability against a NOT NULL target beyond C1's "has some feeding mapping" check, since the workbook does not reliably state source nullability.
- `src/domain/ruleConversion/translate.ts` also translates or flags constructs against the generic TRAQ Derived Attribute rule-engine reference (function/operator palette, argument order, date-comparison and SCD2 boundary semantics) rather than the workbook: `NOTIN[...]`, `BETWEEN[...]` (non-date), `CONTAINS`/`BEGINSWITH`/`ENDSWITH`/`REGEX` for `LIKE`, `SUBSTR`, `ADDDAY`, `DATEPART`, and name/arity passthroughs for `UPPER`/`LOWER`/`LEN`/`ROUND`/`REPLACE`/`CONCAT`; and flags `AGGREGATE`, `SYSTEM_DATE`, `DATE_COMPARISON` (two date-typed columns compared directly instead of through `DATEDIFF`), `FUNCTION_ARITY` (`FLOOR`/`CEIL`'s undocumented second argument), `ADDDAY_UNVERIFIED`/`DATEPART_UNVERIFIED` (date parts TRAQ's own catalog doesn't document) and `SCD2_BOUNDARY` (CrisMac's inclusive-day-before close vs TRAQ's exclusive-same-day `RECORD_START_DATE`/`RECORD_END_DATE` close). These are engine-syntax rules, not workbook data or fabricated business rules; keep this class of check separate from anything that would assert a bank-specific mapping or rule. The same evidence is indexed for the chatbot as `conv:functions`/`conv:dates-and-params` chunks in `src/domain/knowledge.ts` (origin `derived`), so it can explain CrisMac-to-TRAQ syntax differences with citations without duplicating this logic.

## Guidance chatbot and sidebar (Phase 7)
- The chatbot is a real AI RAG assistant (supersedes the earlier mock). `services.assistant` (`src/services/chat/assistant.ts`) syncs browser-built knowledge chunks to the gateway; `server/src/chatbot` + `server/src/retrieval` retrieve (BM25 + exact names, plus embeddings when an OpenAI/Gemini key exists), build a grounded prompt and stream the answer from the user's active provider/model. See the guidance-chatbot skill and docs/AI_GATEWAY.md. The template pipeline (`pipeline.ts`, `mockPipeline.ts`, `mock/chat.ts`) is kept only for suggested questions and tests.
- Pure logic lives in `src/domain/knowledge.ts` (workbook model + `src/data/docs.ts` + `src/data/platformGuide.ts` -> chunks) and `retrieval.ts` (BM25 + exact object-name match; the server imports it too). Do not duplicate workbook logic: chunks are built from existing selectors (`lineage`, `procedures`, `rules`, `relationships`, `selectors`).
- The model may only use retrieved passages: it must cite `[S#]` tags, say "Not provided in workbook" for gaps, and never invent relationships, SQL or rules. No relevant passage and no history means a fixed not-found reply with no model call. Answers show `AI · provider · model`, a grounded/not-found badge and source references (linking to the app route where one exists). Never label AI answers "Simulated".
- Rate limits: only HTTP 429 opens `RateLimitDialog` (`withRateLimitRecovery` in `src/stores/rateLimitStore.ts`); the user picks provider/model and the same request is retried. Quota/billing, 401, 403, 5xx and network errors show their own messages. Never switch providers without the user's consent.
- Keys: server environment variables (`.env`, see `.env.example`) are the default and a key saved in AI Settings overrides per user; keys never reach the browser, browser storage or logs.
- When a screen, tab or button changes, update `src/data/platformGuide.ts`; when docs change, `src/data/docs.ts` already picks them up at build time. Add new knowledge by adding chunks in `knowledge.ts`, not by special-casing answers.
- UI: `src/components/chat/*` (reusable, no business logic), state in `src/stores/chatStore.ts` (session-scoped) and `layoutStore.ts` (sidebar and panel sizes, localStorage).
- Sidebar: collapse button + pointer-drag handle (`usePointerDrag`), widths in `SIDEBAR` constants, icon tooltips when collapsed, mobile keeps the drawer. Drag below `SIDEBAR.snapBelow` collapses.
- The chatbot is extended (not replaced) with a deterministic input/output guardrails layer (`server/src/guardrails/`), browser-native voice input (Web Speech API, `src/services/voice/speechToText.ts`) and text-to-speech (`window.speechSynthesis`, `src/services/voice/textToSpeech.ts`), plus an optional Voice Conversation Mode toggle in `ChatPanel.tsx`. See `docs/AI_GATEWAY.md` ("Guardrails" and "Voice" sections) and the guidance-chatbot skill.

## Source procedure SQL and TRAQ traceability (Phase 8)
- Inputs: 14 CrisMac procedure SQL files in `public/data/latest dd output/<proc>/` listed in `manifest.json`, plus an optional `dd_export.csv` per folder (the `.xlsx` files cannot be read; export to CSV). Loader: `src/services/procSource.ts` (mock services only; handles UTF-16 and the dev server's HTML fallback).
- Pure logic: `src/domain/sqlParse.ts` (statements, columns, expressions, guards, header, change comments) and `src/domain/procTrace.ts` (links to TRAQ columns and FPM_DA_RULES, Agent 5 rules, check C8). UI: `src/features/procedures/SourceProcedures.tsx`.
- "Migration" here means traceability, not code generation: each written column is linked to a TRAQ column only by name match or an FPM_DA_RULES row; unlinked procedures are shown as "no documented TRAQ link" (their outputs may be NPA/SMA tables, out of scope). Never generate TRAQ SQL or invent mappings; label links as derived.
- Procedure-derived rules flow to Agent 5 (kind `derivation`, origin `derived`, provenance SQL file and line) and to the chatbot index. Keep `KNOWN_GAPS` and `platformGuide.ts` in step when this changes.

## Auth and AI gateway
- Demo login (`src/auth`, `RequireAuth`) and a separate local gateway process in `server/` (keys encrypted there; the browser never sees them). The frontend has no AI SDKs and never names a provider except in response metadata.
- Agents 1-5 have opt-in AI features via `services.ai` -> gateway (`AiInsightPanel`). Prompts live in `src/domain/aiPrompts.ts`, use only workbook context, and outputs are labelled `AI · provider · model` (not "Simulated"; the "never fabricate" rule still applies, so parse/validate model output and drop anything outside the supplied candidates). Deterministic outputs stay deterministic. The chatbot and rule-conversion tab are still rule-based. See docs/AI_GATEWAY.md.

## Coding standards
Strict TS, no `any`, small components, named exports, no dead buttons (every control works or is removed), run `npm run build` before declaring a phase done. Keep docs current; link rather than duplicate.

## Skills
`.claude/skills/*/SKILL.md`: frontend-development, data-model-understanding, data-lineage-visualization, sql-procedure-analysis, migration-mapping, business-rule-validation, api-integration-readiness, guidance-chatbot.

## Workbook input
The app reads `public/data/CrisMac_to_TRAQ_Combined.csv` at runtime (Papa Parse, `src/domain/parse.ts`). No Excel parsing and no extraction script. Sheet shapes A/B/C are documented in DATA_DICTIONARY.md.

## Environment note
All code was written where shell execution was blocked (group policy). It has NOT been run. From Phase 10 on, files were type-checked through the VS Code TypeScript diagnostics (`getDiagnostics`); use that when the shell is blocked, and `npm run typecheck` / `npm run build` / `npm test` when it is not (no lint script is configured). See docs/IMPLEMENTATION_PLAN.md first-run checklist.
