# CLAUDE.md - AI-First CrisMAC -> TRAQ Migration Platform

Frontend demonstration now; production-grade AI migration platform later. Every decision must allow backend/DB/LLM integration WITHOUT a frontend rewrite.

## Source of truth and scope
- Workbook (`CrisMac_to_TRAQ_Combined.csv` / original xlsx) is the only source of truth. See `docs/DATA_DICTIONARY.md` (scope, structure, known gaps).
- Scope: tables up to and including FCT_PRODUCT_MASTER and their dependencies. Do NOT add FCT_NPA_*, FCT_PRODUCT_MASTER_AGG, FCT_SMA_EVALUATION or anything downstream.
- NEVER fabricate metadata, mappings, SQL or business rules. If the workbook lacks it, show "Not provided in workbook". There is no stored-procedure SQL in the workbook; Agent 3 shows only documented logic and object names.
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
0 Foundation, 1 Data Model, 2 Lineage, 3 Procedures, 4 Mapping, 5 Rules, 6 Integration. Finish, build, test and document each phase before the next. One phase per cycle.

## Coding standards
Strict TS, no `any`, small components, named exports, no dead buttons (every control works or is removed), run `npm run build` before declaring a phase done. Keep docs current; link rather than duplicate.

## Skills
`.claude/skills/*/SKILL.md`: frontend-development, data-model-understanding, data-lineage-visualization, sql-procedure-analysis, migration-mapping, business-rule-validation, api-integration-readiness.

## Workbook input
The app reads `public/data/CrisMac_to_TRAQ_Combined.csv` at runtime (Papa Parse, `src/domain/parse.ts`). No Excel parsing and no extraction script. Sheet shapes A/B/C are documented in DATA_DICTIONARY.md.

## Environment note
All code was written where shell execution was blocked (group policy). It has NOT been compiled or run. Use `npm run typecheck` / `npm run build` (no lint script is configured). See docs/IMPLEMENTATION_PLAN.md first-run checklist.
