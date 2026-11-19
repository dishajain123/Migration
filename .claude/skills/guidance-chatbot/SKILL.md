---
name: guidance-chatbot
description: Extend or debug the CrisMAC to TRAQ AI chatbot (RAG over workbook data, procedure SQL, rules, docs and platform guide, streamed from the AI gateway) and its sidebar/panel layout. Use when adding knowledge, changing prompts or answers, or changing retrieval, providers or the rate-limit flow.
---
# Guidance chatbot (real AI, RAG)

Answers come from an LLM (the user's active provider/model) that may only use retrieved project passages. Never fabricate; cite sources; say "Not provided in workbook".

## Flow
1. Browser builds `KnowledgeChunk[]` (`src/domain/knowledge.ts`, via `src/services/chat/knowledgeSource.ts`) from the workbook model, procedure SQL/traces, rules, docs and `platformGuide.ts`, hashes them, and syncs to the gateway when the hash differs (`services.assistant`, `src/services/chat/assistant.ts`).
2. `POST /gateway/chat` (SSE) -> `server/src/chatbot/orchestrator.ts`: `retrieval/hybrid.ts` (BM25 + exact object names from `src/domain/retrieval.ts`, fused by reciprocal rank with embedding similarity when an OpenAI or Gemini key exists; keyword-only otherwise or if embeddings fail) -> `chatbot/prompt.ts` (rules, numbered `[S1]` context, last 8 turns) -> `AiGateway.openStream` -> provider adapter `stream()`.
3. Events: `meta` (sources, retrieval mode), `delta`, `done`, `error`. Errors before the first token are a JSON envelope with an HTTP status; the client treats both the same.
4. No relevant passage and no history: fixed not-found text, no model call.

Server layout: `providers/` (adapters), `chatbot/`, `retrieval/` (`embeddings.ts`, `vectorStore.ts` file-backed, `hybrid.ts`), `knowledge_base/`, `config/env.ts`, `schemas/requests.ts`. `docs/AI_GATEWAY.md` has the details.

## Adding knowledge
1. Add a builder in `src/domain/knowledge.ts` (self-contained `text`, `entities` = exact object names, `sources` with sheet/row/route). Build from existing selectors; never re-parse the workbook.
2. App usage text goes in `src/data/platformGuide.ts`; update it whenever a screen, tab or button changes. Docs are picked up from `src/data/docs.ts`.
3. The next page load re-syncs automatically (content hash).

## Prompt/answer rules
- Change behaviour in `server/src/chatbot/prompt.ts`, not in the UI. Keep rule 1-3 (context only, never invent, cite tags).
- SQL is copied verbatim into a fenced `sql` block; never rewritten.
- Test with mocked fetch in `server/src/chat.test.ts` (grounded, not-found, follow-up history, 429 before text, embeddings failure fallback).

## Providers and errors
- Add a provider: adapter (with optional `stream`) + `registry.ts` + `ProviderId`. Chat logic must not change.
- Only `RATE_LIMITED` (429) opens `RateLimitDialog` (via `withRateLimitRecovery`); quota/billing, 401, 403, 5xx and network errors show their own message. Never switch provider without the user's choice.

## UI (src/components/chat, stores/chatStore.ts, layoutStore.ts)
No business logic in components. Streaming message with markdown (`RichText`, `CodeBlock`), source chips, copy, regenerate, stop, retry, active provider/model in the header, suggested questions (deterministic, from workbook names). History is session-only. The old template pipeline (`pipeline.ts`, `mockPipeline.ts`, `mock/chat.ts`) remains only for suggested questions and tests.

## Verify
`npm run typecheck`, `npm test`, `npm run build`; run `npm run gateway`, then ask: a table question, `TABLE.COLUMN`, a follow-up with "it", an out-of-scope table, an unrelated question (must say not found), "How do I approve a mapping?", and trigger a 429 (small-quota key) to see the dialog.
