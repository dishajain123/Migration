import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';
import { AiGateway } from './gateway';
import { GatewayError, type FetchLike } from './providers/types';
import { SettingsStore } from './store';

const KEY = randomBytes(32);
const SECRET = 'sk-test-SECRET-1234567890';

interface Call { url: string; init: RequestInit }
function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }, calls: Call[] = []): FetchLike {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as FetchLike;
}
const make = (f: FetchLike) => {
  const store = new SettingsStore(null, KEY);
  return { store, gw: new AiGateway(store, { fetchImpl: f, timeoutMs: 500, env: {} }) }; // env {} keeps real shell keys out of tests
};
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof GatewayError ? e.code : 'other'; } };

describe('crypto', () => {
  it('round-trips and uses a random IV', () => {
    const a = encrypt(SECRET, KEY); const b = encrypt(SECRET, KEY);
    expect(a).not.toContain(SECRET);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe(SECRET);
  });
  it('rejects tampering', () => {
    const a = encrypt(SECRET, KEY).split(':'); a[3] = Buffer.from('x').toString('base64');
    expect(() => decrypt(a.join(':'), KEY)).toThrow();
  });
});

describe('settings and secrecy', () => {
  it('never exposes the key in the overview', () => {
    const { gw } = make(mockFetch(() => ({ body: {} })));
    gw.saveProvider('u1', 'openai', { apiKey: SECRET, model: 'm' });
    const json = JSON.stringify(gw.overview('u1'));
    expect(json).not.toContain(SECRET);
    expect(gw.overview('u1').providers.find((p) => p.info.id === 'openai')?.settings.hasKey).toBe(true);
  });
  it('isolates users', () => {
    const { gw } = make(mockFetch(() => ({ body: {} })));
    gw.saveProvider('u1', 'groq', { apiKey: SECRET });
    expect(gw.overview('u2').providers.find((p) => p.info.id === 'groq')?.settings.hasKey).toBe(false);
  });
  it('rejects empty key and bad numbers', () => {
    const { gw } = make(mockFetch(() => ({ body: {} })));
    expect(() => gw.saveProvider('u', 'groq', { apiKey: '  ' })).toThrow(GatewayError);
    expect(() => gw.saveProvider('u', 'groq', { temperature: 5 })).toThrow(GatewayError);
    expect(() => gw.saveProvider('u', 'ollama', { apiKey: 'x' })).toThrow(GatewayError);
    expect(() => gw.saveProvider('u', 'ollama', { baseUrl: 'ftp://x' })).toThrow(GatewayError);
  });
});

describe('test connection', () => {
  it('succeeds and lists models (Groq)', async () => {
    const { gw } = make(mockFetch(() => ({ body: { data: [{ id: 'b' }, { id: 'a' }] } })));
    const r = await gw.testConnection('u', 'groq', { apiKey: SECRET, model: 'a' });
    expect(r).toMatchObject({ ok: true, models: ['a', 'b'] });
  });
  it('reports an invalid key without echoing it', async () => {
    const { gw } = make(mockFetch(() => ({ status: 401, body: { error: { message: `bad key ${SECRET}` } } })));
    const r = await gw.testConnection('u', 'openai', { apiKey: SECRET });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected the API key/);
    expect(r.message).not.toContain(SECRET);
  });
  it('flags a model the provider does not offer', async () => {
    const { gw } = make(mockFetch(() => ({ body: { data: [{ id: 'a' }] } })));
    expect((await gw.testConnection('u', 'groq', { apiKey: SECRET, model: 'zzz' })).ok).toBe(false);
  });
  it('maps rate limits and missing key', async () => {
    const { gw } = make(mockFetch(() => ({ status: 429, body: { error: 'slow down' } })));
    expect((await gw.testConnection('u', 'groq', { apiKey: SECRET })).message).toMatch(/rate limit/i);
    expect((await gw.testConnection('u', 'groq')).message).toMatch(/No API key/);
  });
  it('Ollama needs no key and parses /api/tags', async () => {
    const calls: Call[] = [];
    const { gw } = make(mockFetch(() => ({ body: { models: [{ name: 'llama3' }] } }), calls));
    const r = await gw.testConnection('u', 'ollama', { baseUrl: 'http://localhost:11434/' });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('http://localhost:11434/api/tags');
  });
  it('reports unreachable hosts', async () => {
    const { gw } = make((async () => { throw new Error('ECONNREFUSED'); }) as FetchLike);
    expect((await gw.testConnection('u', 'ollama')).message).toMatch(/Could not reach/);
  });
  it('times out', async () => {
    const slow = ((_u: string, init: RequestInit) => new Promise((_r, rej) => {
      init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as FetchLike;
    const { gw } = make(slow);
    expect((await gw.testConnection('u', 'ollama')).message).toMatch(/did not respond/);
  });
});

describe('complete (agent entry point)', () => {
  const setup = (provider: 'groq' | 'gemini' | 'anthropic' | 'openai' | 'ollama', handler: Parameters<typeof mockFetch>[0], calls: Call[] = []) => {
    const m = make(mockFetch(handler, calls));
    if (provider !== 'ollama') m.gw.saveProvider('u', provider, { apiKey: SECRET });
    m.gw.activate('u', provider, 'model-x');
    return m;
  };

  it('fails clearly when nothing is configured', async () => {
    const { gw } = make(mockFetch(() => ({ body: {} })));
    expect(await code(gw.complete('u', { messages: [{ role: 'user', content: 'hi' }] }))).toBe('NOT_CONFIGURED');
  });
  it('refuses to activate without a key', () => {
    const { gw } = make(mockFetch(() => ({ body: {} })));
    expect(() => gw.activate('u', 'groq', 'm')).toThrow(/API key/);
  });
  it('uses the active provider and switches without restart', async () => {
    const calls: Call[] = [];
    const m = setup('groq', (url) => url.includes('groq')
      ? { body: { choices: [{ message: { content: 'from groq' } }] } }
      : { body: { candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] } }, calls);
    m.gw.saveProvider('u', 'gemini', { apiKey: SECRET });
    const msg = [{ role: 'user' as const, content: 'hi' }];
    expect((await m.gw.complete('u', { messages: msg })).text).toBe('from groq');
    m.gw.activate('u', 'gemini', 'g-model');
    const r = await m.gw.complete('u', { messages: msg });
    expect(r).toMatchObject({ text: 'from gemini', provider: 'gemini', model: 'g-model' });
    expect(calls[0].url).toContain('api.groq.com');
    expect(calls[1].url).toContain('g-model:generateContent');
    expect(calls[1].url).not.toContain(SECRET); // key is sent in a header, not the URL
    expect((calls[1].init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
  });
  it('sends system prompt and params to Anthropic', async () => {
    const calls: Call[] = [];
    const m = setup('anthropic', () => ({ body: { content: [{ type: 'text', text: 'ok' }] } }), calls);
    await m.gw.complete('u', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], temperature: 0.2, maxTokens: 50 });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ system: 'S', max_tokens: 50, temperature: 0.2, model: 'model-x' });
    expect(body.messages).toEqual([{ role: 'user', content: 'U' }]);
  });
  it('returns a compatibility error instead of degrading', async () => {
    const m = setup('anthropic', () => ({ body: {} }));
    expect(await code(m.gw.complete('u', { messages: [{ role: 'user', content: 'x' }], json: true }))).toBe('INCOMPATIBLE');
    expect(await code(m.gw.complete('u', { messages: [{ role: 'user', content: 'x' }], tools: true }))).toBe('INCOMPATIBLE');
  });
  it('requests JSON mode where supported', async () => {
    const calls: Call[] = [];
    const m = setup('openai', () => ({ body: { choices: [{ message: { content: '{}' } }] } }), calls);
    await m.gw.complete('u', { messages: [{ role: 'user', content: 'x' }], json: true, maxTokens: 10 });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ response_format: { type: 'json_object' }, max_completion_tokens: 10 });
  });
  it('surfaces provider failures as typed errors', async () => {
    const m = setup('groq', () => ({ status: 401, body: { error: { message: 'Invalid API Key' } } }));
    expect(await code(m.gw.complete('u', { messages: [{ role: 'user', content: 'x' }] }))).toBe('INVALID_KEY');
  });
});
