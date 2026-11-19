import type { ApiResult, KnowledgeChunk } from '@/types';
import type {
  ActiveProvider, ChatStreamEvent, ChatStreamRequest, CompletionRequest, CompletionResult, GatewayOverview, KnowledgeStatus,
  ProviderId, SaveProviderRequest, TestConnectionRequest, TestConnectionResult,
} from '@/types/ai';

// Browser client for the AI gateway (server/). Always real HTTP: keys live on the server, so there is no mock.
// The base path is proxied to the gateway process by Vite in dev; set a reverse proxy the same way in production.
const BASE = '/gateway';

export interface AiGatewayClient {
  overview(): Promise<ApiResult<GatewayOverview>>;
  saveProvider(id: ProviderId, req: SaveProviderRequest): Promise<ApiResult<GatewayOverview>>;
  removeKey(id: ProviderId): Promise<ApiResult<GatewayOverview>>;
  testConnection(id: ProviderId, req: TestConnectionRequest): Promise<ApiResult<TestConnectionResult>>;
  activate(id: ProviderId, model?: string): Promise<ApiResult<GatewayOverview>>;
  deactivate(): Promise<ApiResult<GatewayOverview>>;
  status(): Promise<ApiResult<{ active: ActiveProvider | null }>>;
  /** Entry point for any agent that needs an LLM. Uses the user's active provider and model (or `req.provider`/`req.model` for one call). */
  complete(req: CompletionRequest): Promise<ApiResult<CompletionResult>>;
  /** Models a provider offers, using its saved key (or server env key). */
  listModels(id: ProviderId): Promise<ApiResult<string[]>>;
  knowledgeStatus(): Promise<ApiResult<KnowledgeStatus>>;
  pushKnowledge(hash: string, chunks: KnowledgeChunk[]): Promise<ApiResult<KnowledgeStatus>>;
  /** RAG chat over the synced knowledge. Resolves once the stream ends; text and sources arrive through `onEvent`. */
  chatStream(req: ChatStreamRequest, onEvent: (e: ChatStreamEvent) => void, signal?: AbortSignal): Promise<ApiResult<{ kind: 'grounded' | 'not-found' | 'smalltalk'; provider?: ProviderId; model?: string }>>;
}

// The signed-in user id is supplied by the auth layer (see stores/authStore.ts) so services never import stores.
let userIdProvider: () => string | null = () => null;
export function setUserIdProvider(fn: () => string | null) { userIdProvider = fn; }

export function createAiGatewayClient(getUserId: () => string | null): AiGatewayClient {
  async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const started = performance.now();
    const fail = (code: string, message: string): ApiResult<T> => ({ data: null, meta: { simulated: false, requestId: '', latencyMs: Math.round(performance.now() - started) }, error: { code, message } });
    const uid = getUserId();
    if (!uid) return fail('UNAUTHENTICATED', 'Sign in first.');
    try {
      const res = await fetch(`${BASE}${path}`, {
        method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': uid }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      try { return JSON.parse(text) as ApiResult<T>; }
      catch { return fail('GATEWAY_DOWN', 'The AI gateway is not reachable. Start it with "npm run gateway".'); }
    } catch (e) {
      return fail('GATEWAY_DOWN', `The AI gateway is not reachable (${e instanceof Error ? e.message : 'network error'}). Start it with "npm run gateway".`);
    }
  }
  const p = (id: ProviderId) => `/providers/${id}`;

  async function chatStream(req: ChatStreamRequest, onEvent: (e: ChatStreamEvent) => void, signal?: AbortSignal): ReturnType<AiGatewayClient['chatStream']> {
    type R = Awaited<ReturnType<AiGatewayClient['chatStream']>>;
    const started = performance.now();
    const meta = () => ({ simulated: false, requestId: '', latencyMs: Math.round(performance.now() - started) });
    const fail = (code: string, message: string): R => ({ data: null, meta: meta(), error: { code, message } });
    const uid = getUserId();
    if (!uid) return fail('UNAUTHENTICATED', 'Sign in first.');
    try {
      const res = await fetch(`${BASE}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-User': uid }, body: JSON.stringify(req), signal });
      if (!(res.headers.get('content-type') ?? '').includes('text/event-stream') || !res.body) {
        // Errors before the first token (not configured, rate limit, bad key, ...) arrive as a normal JSON envelope.
        const text = await res.text();
        try { const j = JSON.parse(text) as ApiResult<unknown>; return fail(j.error?.code ?? String(res.status), j.error?.message ?? res.statusText); }
        catch { return fail('GATEWAY_DOWN', 'The AI gateway is not reachable. Start it with "npm run gateway".'); }
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let done: R | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!data) continue;
          const e = JSON.parse(data) as ChatStreamEvent;
          onEvent(e);
          if (e.type === 'error') return fail(e.code, e.message);
          if (e.type === 'done') done = { data: { kind: e.kind, provider: e.provider, model: e.model }, meta: { ...meta(), provider: e.provider, model: e.model } };
        }
      }
      return done ?? fail('PROVIDER_ERROR', 'The response ended before it was complete.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return fail('ABORTED', 'Cancelled.');
      return fail('GATEWAY_DOWN', `The AI gateway is not reachable (${e instanceof Error ? e.message : 'network error'}). Start it with "npm run gateway".`);
    }
  }

  return {
    listModels: (id) => call('POST', `${p(id)}/models`, {}),
    knowledgeStatus: () => call('GET', '/knowledge'),
    pushKnowledge: (hash, chunks) => call('PUT', '/knowledge', { hash, chunks }),
    chatStream,
    overview: () => call('GET', ''),
    saveProvider: (id, req) => call('PUT', p(id), req),
    removeKey: (id) => call('DELETE', `${p(id)}/key`),
    testConnection: (id, req) => call('POST', `${p(id)}/test`, req),
    activate: (id, model) => call('POST', '/active', { provider: id, model }),
    deactivate: () => call('POST', '/active', { provider: null }),
    status: () => call('GET', '/status'),
    complete: (req) => call('POST', '/complete', req),
  };
}

/** Shared client for the whole app (settings page and every agent). */
export const aiGateway: AiGatewayClient = createAiGatewayClient(() => userIdProvider());
