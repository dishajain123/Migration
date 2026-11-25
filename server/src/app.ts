import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ApiResult, ApiMeta } from '../../src/types';
import type { ChatStreamEvent, CompletionRequest, EmbedResult, KnowledgeStatus, ProviderId, SaveProviderRequest, TestConnectionRequest } from '../../src/types/ai';
import type { ChatOrchestrator } from './chatbot/orchestrator';
import type { Env } from './config/env';
import type { AiGateway } from './gateway';
import { checkInput } from './guardrails/inputGuardrails';
import type { KnowledgeBase } from './knowledge_base/knowledgeBase';
import { isProviderId } from './providers/registry';
import { GatewayError, type FetchLike } from './providers/types';
import { pickEmbedder } from './retrieval/embeddings';
import { JobRunner } from './jobs/jobRunner';
import { DecisionStore } from './mappingDecisions/decisionStore';
import { embedSchemaTexts, SchemaEmbeddingCache } from './retrieval/schemaEmbeddings';
import type { VectorStore } from './retrieval/vectorStore';
import { parseChatRequest, parseDecisionRecord, parseEmbedRequest, parseJobRequest, parseKnowledgePush } from './schemas/requests';

const MAX_BODY = 1_000_000;
const MAX_JOB_BODY = 12_000_000;
const MAX_EMBED_BODY = 2_000_000;
const MAX_KNOWLEDGE_BODY = 40_000_000;

/**
 * DEMO IDENTITY: the caller's id comes from the X-Demo-User header, which the dummy login sets. This is NOT
 * authentication. Replace `resolveUser` with real session/JWT verification when real auth exists; everything
 * downstream is already keyed by user id.
 */
export function resolveUser(req: IncomingMessage): string {
  const raw = req.headers['x-demo-user'];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || !/^[A-Za-z0-9._@+-]{1,120}$/.test(id)) throw new GatewayError('UNAUTHENTICATED', 'Sign in first (missing or invalid demo identity).', 401);
  return id.toLowerCase();
}

async function readJson(req: IncomingMessage, limit = MAX_BODY): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new GatewayError('BAD_REQUEST', 'Request body too large.', 413);
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fallthrough */ }
  throw new GatewayError('BAD_REQUEST', 'Body must be a JSON object.');
}

function send(res: ServerResponse, status: number, body: ApiResult<unknown>) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export interface AppDeps {
  gateway: AiGateway;
  chat: ChatOrchestrator;
  kb: KnowledgeBase;
  vectors: VectorStore;
  /** Cache for schema-object embeddings (Agent 4). Created per app when omitted. */
  schemaCache?: SchemaEmbeddingCache;
  /** Human mapping decisions (approve / reject). In-memory when omitted. */
  decisions?: DecisionStore;
  /** Async bulk jobs. Created per app when omitted. */
  jobs?: JobRunner;
  fetchImpl: FetchLike;
  env?: Env;
  log?: (line: string) => void;
}

/**
 * Stream chat events as SSE. Events are held back until the first model text arrives, so a failure before any text
 * (rate limit, bad key, ...) is returned as a normal JSON error with its HTTP status; later failures become an
 * `error` event on the open stream.
 */
async function streamChat(res: ServerResponse, events: AsyncGenerator<ChatStreamEvent>, abort: AbortController, meta: () => ApiMeta) {
  const held: ChatStreamEvent[] = [];
  let open = false;
  const write = (e: ChatStreamEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  try {
    for await (const e of events) {
      if (!open && e.type === 'delta') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        open = true;
        held.forEach(write);
      }
      if (open) write(e); else held.push(e);
    }
    if (!open) { res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }); held.forEach(write); }
    res.end();
  } catch (e) {
    const err = e instanceof GatewayError ? e : new GatewayError('PROVIDER_ERROR', 'Internal gateway error.', 500);
    if (open) { write({ type: 'error', code: err.code, message: err.message }); res.end(); }
    else send(res, err.status, { data: null, meta: meta(), error: { code: err.code, message: err.message } });
  } finally {
    abort.abort();
  }
}

export function createApp(deps: AppDeps): Server {
  const { gateway, chat, kb, vectors } = deps;
  const log = deps.log ?? (() => undefined);
  const schemaCache = deps.schemaCache ?? new SchemaEmbeddingCache();
  const decisions = deps.decisions ?? new DecisionStore(null);
  const jobs = deps.jobs ?? new JobRunner((uid, r, signal) => gateway.complete(uid, r, signal));
  return createServer(async (req, res) => {
    const started = Date.now();
    const requestId = randomUUID();
    const meta = (extra?: Partial<ApiMeta>): ApiMeta => ({ simulated: false, requestId, latencyMs: Date.now() - started, ...extra });
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['gateway', ...]
      const method = req.method ?? 'GET';
      if (parts[0] === 'gateway' && parts[1] === 'health') return send(res, 200, { data: { ok: true }, meta: meta() });
      if (parts[0] !== 'gateway') throw new GatewayError('BAD_REQUEST', 'Unknown route.', 404);
      const uid = resolveUser(req);
      const ok = (data: unknown, extra?: Partial<ApiMeta>) => send(res, 200, { data, meta: meta(extra) });
      const pid = (): ProviderId => {
        if (!parts[2] || !isProviderId(parts[2])) throw new GatewayError('BAD_REQUEST', 'Unknown provider.', 404);
        return parts[2];
      };
      const knowledgeStatus = (): KnowledgeStatus => {
        const emb = pickEmbedder((id) => gateway.resolveKey(uid, id), deps.fetchImpl, deps.env);
        return { hash: kb.hash, chunks: kb.size, embeddings: { enabled: !!emb, model: emb?.id ?? null, indexed: emb ? vectors.indexed(emb.id, kb.all()) : 0 } };
      };

      if (method === 'GET' && parts.length === 1) return ok(gateway.overview(uid));
      if (method === 'GET' && parts[1] === 'status') return ok({ active: gateway.getActive(uid) });
      if (parts[1] === 'knowledge') {
        if (method === 'GET') return ok(knowledgeStatus());
        if (method === 'PUT') {
          const k = parseKnowledgePush(await readJson(req, MAX_KNOWLEDGE_BODY));
          kb.replace(k.hash, k.chunks);
          log(`knowledge synced chunks=${k.chunks.length}`);
          return ok(knowledgeStatus());
        }
      }
      if (method === 'POST' && parts[1] === 'chat') {
        const body = parseChatRequest(await readJson(req));
        const guard = checkInput(body.question, body.history);
        if (!guard.allowed) {
          log(`guardrail blocked input reason=${guard.reason}`); // never log the message/matched text itself
          throw new GatewayError('BLOCKED_INPUT', guard.message ?? 'This message cannot be processed.', 400);
        }
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        return await streamChat(res, chat.run(uid, body, abort.signal), abort, meta);
      }
      const seg = (s?: string): string | undefined => {
        try { return s ? decodeURIComponent(s) : undefined; } catch { throw new GatewayError('BAD_REQUEST', 'Malformed id in the URL.'); }
      };
      if (parts[1] === 'mapping-decisions') {
        const id = seg(parts[2]);
        if (method === 'GET' && !id) return ok(decisions.list(uid));
        if (method === 'PUT' && !id) return ok(decisions.upsert(uid, parseDecisionRecord(await readJson(req))));
        if (method === 'DELETE' && id) return ok({ removed: decisions.remove(uid, id) });
      }
      if (parts[1] === 'jobs') {
        const id = seg(parts[2]);
        if (method === 'POST' && !id) { const j = jobs.create(uid, parseJobRequest(await readJson(req, MAX_JOB_BODY))); log(`job ${j.id} kind=${j.kind} items=${j.total}`); return ok(j); }
        if (method === 'GET' && !id) return ok(jobs.list(uid));
        if (method === 'GET' && id) return ok(jobs.get(uid, id));
        if (method === 'DELETE' && id) return ok(jobs.cancel(uid, id));
      }
      if (method === 'POST' && parts[1] === 'embeddings') {
        const { texts } = parseEmbedRequest(await readJson(req, MAX_EMBED_BODY));
        const emb = pickEmbedder((id) => gateway.resolveKey(uid, id), deps.fetchImpl, deps.env);
        if (!emb) throw new GatewayError('NOT_CONFIGURED', 'Semantic embeddings need an OpenAI or Gemini API key (AI Settings or server environment).', 409);
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        const result: EmbedResult = { model: emb.id, vectors: await embedSchemaTexts(emb, texts, schemaCache, abort.signal) };
        log(`schema embeddings texts=${texts.length}`); // never log the texts: they describe the customer's schema
        return ok(result);
      }
      if (method === 'POST' && parts[1] === 'complete') {
        const r = await gateway.complete(uid, (await readJson(req)) as unknown as CompletionRequest);
        return ok(r, { provider: r.provider, model: r.model });
      }
      if (method === 'POST' && parts[1] === 'active') {
        const b = await readJson(req);
        if (b.provider === null) return ok(gateway.deactivate(uid));
        if (typeof b.provider !== 'string' || !isProviderId(b.provider)) throw new GatewayError('BAD_REQUEST', 'Unknown provider.');
        return ok(gateway.activate(uid, b.provider, typeof b.model === 'string' ? b.model : undefined));
      }
      if (parts[1] === 'providers' && parts.length >= 3) {
        const id = pid();
        const action = parts[3];
        if (method === 'PUT' && !action) return ok(gateway.saveProvider(uid, id, (await readJson(req)) as SaveProviderRequest));
        if (method === 'DELETE' && action === 'key') return ok(gateway.removeKey(uid, id));
        if (method === 'POST' && action === 'test') return ok(await gateway.testConnection(uid, id, (await readJson(req)) as TestConnectionRequest));
        if (method === 'POST' && action === 'models') return ok(await gateway.listModels(uid, id, (await readJson(req)) as TestConnectionRequest));
      }
      throw new GatewayError('BAD_REQUEST', 'Unknown route.', 404);
    } catch (e) {
      const err = e instanceof GatewayError ? e : new GatewayError('PROVIDER_ERROR', 'Internal gateway error.', 500);
      if (!(e instanceof GatewayError)) log(`unhandled ${e instanceof Error ? e.name : 'error'}`); // never log the message: it could carry secrets
      if (!res.headersSent) send(res, err.status, { data: null, meta: meta(), error: { code: err.code, message: err.message } });
      else res.end();
    }
  });
}
