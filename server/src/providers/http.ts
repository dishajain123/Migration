import type { FetchLike } from './types';
import { GatewayError } from './types';

/** Remove anything that looks like the caller's key from text that may be logged or returned. */
export function redact(text: string, secret: string | null): string {
  let out = text;
  if (secret && secret.length >= 6) out = out.split(secret).join('[redacted]');
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{12,})/g, '[redacted]');
}

function providerMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (b.error && typeof b.error === 'object') {
      const e = b.error as { message?: unknown; code?: unknown; type?: unknown };
      const parts = [e.message, e.code, e.type].filter((x): x is string => typeof x === 'string');
      if (parts.length) return parts.join(' | ');
    }
    if (typeof b.message === 'string') return b.message;
  }
  return '';
}

const KEY_INVALID = /api key not valid|invalid api key|invalid x-api-key|incorrect api key|invalid_api_key|authentication_error/i;
// Billing/credit exhaustion, as opposed to short-lived throttling. These are NOT retried by switching models in place.
// Wording such as "exceeded your current quota ... check your plan and billing" is deliberately NOT matched: Gemini
// sends it for ordinary per-minute throttling too, so it stays RATE_LIMITED. OpenAI's hard quota carries `insufficient_quota`.
const QUOTA = /insufficient_quota|credit balance|out of credits|insufficient credits|payment required|billing_not_active|billing hard limit/i;

/**
 * Classify a provider HTTP failure. Only RATE_LIMITED opens the provider/model switching dialog in the UI.
 * `retryAfter` is the Retry-After header in seconds, when sent.
 */
export function mapStatus(status: number, detail: string, retryAfter?: number): GatewayError {
  const d = detail ? ` (${detail.slice(0, 240)})` : '';
  if (status === 401 || KEY_INVALID.test(detail)) return new GatewayError('INVALID_KEY', `The provider rejected the API key${d}.`, 401);
  if (status === 402 || QUOTA.test(detail)) return new GatewayError('QUOTA_EXHAUSTED', `The provider account has no remaining quota or credit. Check billing with the provider${d}.`, 402);
  if (status === 403) return new GatewayError('PERMISSION_DENIED', `The key is valid but not permitted to use this model or endpoint${d}.`, 403);
  if (status === 404) return new GatewayError('MODEL_NOT_FOUND', `Model or endpoint not found${d}.`, 404);
  if (status === 429) {
    const wait = retryAfter ? ` Retry in about ${Math.ceil(retryAfter)}s.` : '';
    return new GatewayError('RATE_LIMITED', `Provider rate limit reached${d}.${wait}`, 429);
  }
  if (status >= 500) return new GatewayError('SERVER_ERROR', `The provider is having problems (HTTP ${status})${d}. Try again shortly.`, 502);
  return new GatewayError('PROVIDER_ERROR', `Provider returned HTTP ${status}${d}.`, 502);
}

const retryAfterOf = (res: Response): number | undefined => {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

function wrapNetwork(e: unknown, timeoutMs: number, secret: string | null): GatewayError {
  if (e instanceof GatewayError) return e;
  if (e instanceof Error && e.name === 'AbortError') return new GatewayError('TIMEOUT', `The provider did not respond within ${Math.round(timeoutMs / 1000)}s.`, 504);
  return new GatewayError('UNREACHABLE', `Could not reach the provider: ${redact(e instanceof Error ? e.message : String(e), secret)}`, 502);
}

/** Link an outer cancellation signal (client disconnected) to an inner controller. */
function link(outer: AbortSignal | undefined, ctl: AbortController) {
  if (!outer) return;
  if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true });
}

/** fetch + JSON with timeout and uniform error mapping. Never includes request headers in errors. */
export async function requestJson(
  fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, secret: string | null, signal?: AbortSignal,
): Promise<unknown> {
  const ctl = new AbortController();
  link(signal, ctl);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    const raw = await res.text();
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* non-JSON body */ }
    if (!res.ok) throw mapStatus(res.status, redact(providerMessage(body) || raw.slice(0, 200), secret), retryAfterOf(res));
    return body;
  } catch (e) {
    throw wrapNetwork(e, timeoutMs, secret);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST and read a server-sent-events stream, yielding each `data:` payload. The timeout is an idle timeout: it
 * restarts whenever bytes arrive, so long answers are fine but a stalled provider is not.
 */
export async function* streamSse(
  fetchImpl: FetchLike, url: string, init: RequestInit, idleMs: number, secret: string | null, signal?: AbortSignal,
): AsyncGenerator<string> {
  const ctl = new AbortController();
  link(signal, ctl);
  let timer = setTimeout(() => ctl.abort(), idleMs);
  const poke = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), idleMs); };
  try {
    let res: Response;
    try { res = await fetchImpl(url, { ...init, signal: ctl.signal }); } catch (e) { throw wrapNetwork(e, idleMs, secret); }
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* ignore */ }
      throw mapStatus(res.status, redact(providerMessage(body) || raw.slice(0, 200), secret), retryAfterOf(res));
    }
    if (!res.body) throw new GatewayError('PROVIDER_ERROR', 'Provider returned an empty stream.', 502);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (e) { throw wrapNetwork(e, idleMs, secret); }
      poke();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
    }
    const tail = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (tail) yield tail;
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}
