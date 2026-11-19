# AI Gateway, demo auth and AI Settings

## Status
- Agents 1-5 each have an opt-in AI feature (button on the page; nothing is sent until clicked), all through `services.ai` (`src/services/ai/agentAi.ts`) -> gateway -> the user's active provider/model:
  | Agent | Where | Feature |
  |---|---|---|
  | 1 Data Model | Table detail | AI table briefing |
  | 2 Lineage | below the diagram | AI flow explanation of the current selection |
  | 3 Procedures | Referenced objects detail, Source procedures overview | AI procedure explanation (uses the verbatim SQL when a sample file exists) |
  | 4 Mapping | Suggestions tab | AI ranks the heuristic candidates; picks naming a candidate that was not offered are discarded |
  | 5 Rules | Validation tab | AI review of the non-passing validation results |
- Prompts are built only from workbook-derived context (`src/domain/aiPrompts.ts`), forbid invention ("Not provided in workbook"), and require JSON that is parsed and validated. Output is badged `AI · provider · model`; existing deterministic outputs and their Simulated labels are unchanged. The CrisMac SQL -> TRAQ rule conversion tab remains rule-based; the chatbot is now AI (next section).
- Agents ask for JSON; providers that cannot guarantee it (Anthropic here) return a compatibility error shown in the panel.
- Groq: model id is `openai/gpt-oss-120b` (use Test connection to list the exact ids). It is a reasoning model, so the empty-message error means raise Max tokens (default per request is 4096).
- Written without shell access: nothing here has been run, built or tested against a live provider. Run `npm install`, `npm run typecheck`, `npm test` first.

## Chatbot (RAG), rate limits, keys
- **Chat**: `POST /gateway/chat` streams (SSE) an answer. The browser builds knowledge chunks from the workbook, procedure SQL, lineage, mappings, rules and docs and syncs them (`PUT /gateway/knowledge`, only when the content hash changes). The server retrieves with `server/src/retrieval` (BM25 + exact object names, fused by reciprocal rank with embeddings when an OpenAI or Gemini key is available; keyword-only otherwise, or if embedding fails, with a note on the message), builds the prompt in `server/src/chatbot/prompt.ts` (cite `[S#]`, never invent, SQL verbatim) and streams from the active provider. Embedding models are configurable (`EMBEDDING_MODEL_OPENAI`, `EMBEDDING_MODEL_GEMINI`); vectors are cached in `server/.data/vectors-*.json`.
- **Layout** (`server/src`): `providers/` (OpenAI-compatible, Anthropic, Gemini adapters, streaming), `chatbot/`, `retrieval/`, `knowledge_base/`, `config/env.ts`, `schemas/requests.ts`, `gateway.ts`, `app.ts`. Chat logic never names a provider.
- **Errors** (`providers/http.ts`): `RATE_LIMITED` (429), `QUOTA_EXHAUSTED` (billing/credit), `INVALID_KEY` (401), `PERMISSION_DENIED` (403), `SERVER_ERROR` (5xx), `UNREACHABLE`/`TIMEOUT` (network). Only `RATE_LIMITED` opens the provider/model switching dialog, in the chatbot and in every agent's AI panel; the user chooses, the same request is retried (optionally making the choice active). Nothing switches silently. Gemini's per-minute "quota exceeded" wording is treated as a rate limit.
- **Keys**: set `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` in a git-ignored `.env` (see `.env.example`; `npm run gateway` loads it) or save one per user in AI Settings, which overrides. Keys are never returned by any endpoint, stored in the browser, or logged.
- **Not verified**: none of this has been run against live providers; the tests (`server/src/*.test.ts`) use mocked responses.

## Run
1. `npm install` (adds `tsx`)
2. Terminal 1: `npm run gateway` (127.0.0.1:8787). Terminal 2: `npm run dev` (Vite proxies `/gateway`).
3. Sign in with any non-empty credentials, open **AI Settings**.

WSL with the project on `/mnt/c`: `tsx` fails with `listen ENOTSUP ... .pipe` because the temp dir is on the Windows drive. Run `TMPDIR=/tmp npm run gateway` (or `export TMPDIR=/tmp` in `~/.bashrc`).

## Providers (AI Settings -> pick provider)
| Provider | Setup |
|---|---|
| Groq | key from console.groq.com/keys, Test connection, pick a model, Save & activate |
| Gemini | key from aistudio.google.com/apikey |
| OpenAI | key from platform.openai.com/api-keys |
| Anthropic | key from console.anthropic.com/settings/keys (no JSON mode through the gateway) |
| OpenRouter | key from openrouter.ai/keys |
| Ollama | no key; set Base URL (default http://localhost:11434), model from `ollama list` |

Model ids are fetched from each provider; none are hardcoded.

## Architecture
- `server/src/providers/*`: `ProviderAdapter` interface; OpenAI-compatible adapter (OpenAI, Groq, OpenRouter, Ollama) plus Anthropic and Gemini. Add a provider = new adapter + registry entry + `ProviderId`.
- `server/src/gateway.ts`: per-user active provider/model read on every call (switching needs no restart), capability checks (`INCOMPATIBLE` instead of silent degradation), timeouts, typed errors (`INVALID_KEY`, `RATE_LIMITED`, `TIMEOUT`, ...), key redaction.
- `server/src/store.ts` + `crypto.ts`: per-user settings in `server/.data/providers.json`, keys AES-256-GCM encrypted; master key from `GATEWAY_MASTER_KEY` or an auto-generated local file. Keys are never returned by any endpoint (only `hasKey`).
- Frontend: `src/stores/aiStore.ts`, `src/features/aiSettings/*`, `AiStatusBanner` (shown when nothing is active).

## Demo auth (not real security)
`src/auth/authService.ts` accepts any credentials; the session (no password) lives in sessionStorage; `RequireAuth` guards routes. The gateway identifies users by the `X-Demo-User` header, which anyone on localhost can forge: it is bound to loopback only. Replace `authService` and `resolveUser` (server/src/app.ts) for real auth.

## Limitations
Tool calling is not implemented in the gateway (flagged `INCOMPATIBLE`); Anthropic JSON mode unsupported; no streaming; no rate-limit retry; no live provider testing.
