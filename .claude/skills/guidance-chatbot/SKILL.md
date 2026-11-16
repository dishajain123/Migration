---
name: guidance-chatbot
description: Extend or debug the CrisMAC to TRAQ guidance chatbot (mock RAG over workbook data, docs and platform guide) and its sidebar/panel layout. Use when adding knowledge, changing answers, or swapping in a real RAG backend.
---
# Guidance chatbot

Frontend-only. No LLM, no backend. Answers must be grounded, cited and labelled `Simulated`.

## Pipeline (src/services/chat/pipeline.ts)
`ChatService.ask` = `KnowledgeRetriever.retrieve` -> `ContextBuilder.build` -> `ResponseGenerator.generate`, plus `SuggestionProvider`. Mock stages: `mockPipeline.ts` over `domain/retrieval.ts`, `domain/answer.ts`. Swap a stage, or the whole service in `http.ts` (`/chat/ask`, `/chat/suggestions`). UI only imports `services.chat`.

## Adding knowledge
1. Add a builder in `src/domain/knowledge.ts` returning `KnowledgeChunk[]` (self-contained `text`, `entities` = exact object names, `sources` with sheet/row/route). Build from existing selectors, never re-parse the workbook.
2. Missing facts: write `Not provided in workbook`. Never infer purposes, definitions or SQL.
3. App usage text goes in `src/data/platformGuide.ts` and must match the real UI; update it whenever a screen, tab or button changes.
4. Docs are picked up from `src/data/docs.ts` (`?raw`, split by heading). Add a file there to index it.

## Rules for answers
- The generator restates retrieved chunk text only. If `ctx.grounded` is false, return `kind: 'not-found'` with no sources.
- Entity detection only counts names with `_` or typed in capitals, so ordinary words do not match columns.
- Add a case to `src/domain/chat.test.ts` for every new chunk kind or intent (grounded, not-found, citation).

## UI (src/components/chat, stores/chatStore.ts, stores/layoutStore.ts)
No business logic in components. States: empty (suggested questions), loading (spinner row), error (message + Retry), success. History is session-only. Resizing uses `usePointerDrag`; limits live in `SIDEBAR` / `CHAT_PANEL`.

## Verify
`npm run typecheck`, `npm test`, `npm run build`; then ask: a table question, `TABLE.COLUMN`, a follow-up with "it", an out-of-scope table, an unrelated question (must say not found), and "How do I approve a mapping?".
