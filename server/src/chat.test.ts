import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../../src/types';
import type { ChatStreamEvent } from '../../src/types/ai';
import { ChatOrchestrator } from './chatbot/orchestrator';
import { buildChatMessages } from './chatbot/prompt';
import { AiGateway } from './gateway';
import { KnowledgeBase } from './knowledge_base/knowledgeBase';
import { mapStatus } from './providers/http';
import { GatewayError, type FetchLike } from './providers/types';
import { pickEmbedder } from './retrieval/embeddings';
import { HybridRetriever, fuse } from './retrieval/hybrid';
import { VectorStore } from './retrieval/vectorStore';
import { SettingsStore } from './store';

const KEY = randomBytes(32);
const chunk = (id: string, title: string, text: string, entities: string[] = []): KnowledgeChunk => ({
  id, kind: 'table', title, text, keywords: [], entities, origin: 'workbook', sources: [{ kind: 'table', label: title, sheet: 'Sheet1', rowNo: 3, route: '/data-model' }],
});
const sse = (...datas: string[]) => datas.map((d) => `data: ${d}\n\n`).join('');
const streamResponse = (text: string, status = 200) => new Response(new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
}), { status });
const groqDelta = (t: string) => JSON.stringify({ choices: [{ delta: { content: t } }] });

async function collect(g: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> { const out: ChatStreamEvent[] = []; for await (const e of g) out.push(e); return out; }
const codeOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof GatewayError ? e.code : 'other'; } };

describe('error classification', () => {
  it('separates the failure kinds the UI treats differently', () => {
    expect(mapStatus(429, 'Rate limit reached for model x', 12).code).toBe('RATE_LIMITED');
    expect(mapStatus(429, 'You exceeded your current quota | insufficient_quota').code).toBe('QUOTA_EXHAUSTED');
    expect(mapStatus(400, 'Your credit balance is too low').code).toBe('QUOTA_EXHAUSTED');
    expect(mapStatus(401, '').code).toBe('INVALID_KEY');
    expect(mapStatus(403, 'not allowed').code).toBe('PERMISSION_DENIED');
    expect(mapStatus(503, '').code).toBe('SERVER_ERROR');
    expect(mapStatus(429, '', 30).message).toMatch(/30s/);
  });
  it('treats Gemini per-minute quota wording as a rate limit, not billing', () => {
    expect(mapStatus(429, 'You exceeded your current quota, please check your plan and billing details').code).toBe('RATE_LIMITED');
  });
});

describe('env keys, overrides and streaming', () => {
  const mk = (f: FetchLike, env: Record<string, string> = {}) => {
    const store = new SettingsStore(null, KEY);
    return { store, gw: new AiGateway(store, { fetchImpl: f, timeoutMs: 500, env }) };
  };
  it('uses a server environment key and reports its source without exposing it', () => {
    const calls: string[] = [];
    const f = (async (_u: string, init: RequestInit) => { calls.push(String((init.headers as Record<string, string>).Authorization)); return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })); }) as unknown as FetchLike;
    const { gw } = mk(f, { GROQ_API_KEY: 'gsk_ENVKEY1234567' });
    const o = gw.overview('u');
    expect(o.providers.find((p) => p.info.id === 'groq')?.settings).toMatchObject({ hasKey: true, keySource: 'env' });
    expect(JSON.stringify(o)).not.toContain('ENVKEY');
    gw.activate('u', 'groq', 'm');
    return gw.complete('u', { messages: [{ role: 'user', content: 'x' }] }).then(() => expect(calls[0]).toBe('Bearer gsk_ENVKEY1234567'));
  });
  it('a one-off override does not change the active provider', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }) as unknown as FetchLike;
    const { gw } = mk(f, { GROQ_API_KEY: 'gsk_aaaaaaaaaa', OPENAI_API_KEY: 'sk-bbbbbbbbbbbb' });
    gw.activate('u', 'groq', 'g-model');
    const r = await gw.complete('u', { messages: [{ role: 'user', content: 'x' }], provider: 'openai', model: 'o-model' });
    expect(r).toMatchObject({ provider: 'openai', model: 'o-model' });
    expect(urls[0]).toContain('api.openai.com');
    expect(gw.getActive('u')).toEqual({ provider: 'groq', model: 'g-model' });
  });
  it('streams deltas', async () => {
    const f = (async () => streamResponse(sse(groqDelta('Hel'), groqDelta('lo'), '[DONE]'))) as unknown as FetchLike;
    const { gw } = mk(f, { GROQ_API_KEY: 'gsk_aaaaaaaaaa' });
    gw.activate('u', 'groq', 'm');
    const s = gw.openStream('u', { messages: [{ role: 'user', content: 'x' }] });
    let text = ''; for await (const d of s.deltas) text += d;
    expect(text).toBe('Hello');
  });
  it('surfaces a 429 on the stream before any text', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429, headers: { 'retry-after': '7' } })) as unknown as FetchLike;
    const { gw } = mk(f, { GROQ_API_KEY: 'gsk_aaaaaaaaaa' });
    gw.activate('u', 'groq', 'm');
    const s = gw.openStream('u', { messages: [{ role: 'user', content: 'x' }] });
    expect(await codeOf((async () => { for await (const _ of s.deltas) { /* drain */ } })())).toBe('RATE_LIMITED');
  });
  it('parses Anthropic and Gemini streams', async () => {
    const a = (async () => streamResponse(sse(JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } }), JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } })))) as unknown as FetchLike;
    const ma = mk(a, { ANTHROPIC_API_KEY: 'k-anthropic-1' }); ma.gw.activate('u', 'anthropic', 'm');
    let t = ''; for await (const d of ma.gw.openStream('u', { messages: [{ role: 'user', content: 'x' }] }).deltas) t += d;
    expect(t).toBe('AB');
    const g = (async () => streamResponse(sse(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'G1' }] } }] }), JSON.stringify({ candidates: [{ content: { parts: [{ text: 'G2' }] } }] })))) as unknown as FetchLike;
    const mg = mk(g, { GEMINI_API_KEY: 'AIzaSyAAAAAAAAAAAA' }); mg.gw.activate('u', 'gemini', 'm');
    t = ''; for await (const d of mg.gw.openStream('u', { messages: [{ role: 'user', content: 'x' }] }).deltas) t += d;
    expect(t).toBe('G1G2');
  });
});

describe('retrieval', () => {
  it('fuses rankings so items found by both lists win', () => {
    const f = fuse([['a', 'b', 'c'], ['c', 'a', 'd']]);
    expect([...f.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('hybrid retrieval brings in a semantically matched chunk keyword search missed', async () => {
    const kb = new KnowledgeBase(null);
    kb.replace('h1', [
      chunk('c1', 'FCT_PRODUCT_MASTER', 'Master table of products with product code.', ['FCT_PRODUCT_MASTER']),
      chunk('c2', 'Loan servicing notes', 'Repayment schedule description.'),
    ]);
    // Fake embeddings: the query vector points at c2 even though no keyword overlaps.
    const vecs: Record<string, number[]> = { 'FCT_PRODUCT_MASTER\nMaster table of products with product code.': [1, 0], 'Loan servicing notes\nRepayment schedule description.': [0, 1] };
    const embedder = { id: 'fake:1', embed: async (t: string[]) => t.map((x) => vecs[x] ?? [0, 1]) };
    const r = await new HybridRetriever(kb, new VectorStore(null)).retrieve('zzzz qqqq', [], undefined, embedder);
    expect(r.mode).toBe('hybrid');
    expect(r.passages.map((p) => p.chunk.id)).toContain('c2');
  });
  it('falls back to keyword search when embeddings fail', async () => {
    const kb = new KnowledgeBase(null);
    kb.replace('h1', [chunk('c1', 'FCT_PRODUCT_MASTER', 'Master table of products.', ['FCT_PRODUCT_MASTER'])]);
    const embedder = { id: 'fake:2', embed: async () => { throw new GatewayError('RATE_LIMITED', 'embedding limit'); } };
    const r = await new HybridRetriever(kb, new VectorStore(null)).retrieve('What is FCT_PRODUCT_MASTER?', [], undefined, embedder);
    expect(r.mode).toBe('keyword');
    expect(r.note).toMatch(/keyword/);
    expect(r.passages[0].chunk.id).toBe('c1');
  });
  it('only picks an embedder when an OpenAI or Gemini key exists', () => {
    const f = fetch;
    expect(pickEmbedder(() => null, f)).toBeNull();
    expect(pickEmbedder((id) => (id === 'groq' ? 'x' : null), f)).toBeNull();
    expect(pickEmbedder((id) => (id === 'gemini' ? 'k' : null), f)?.id).toMatch(/^gemini:/);
    expect(pickEmbedder((id) => (id === 'openai' ? 'k' : null), f)?.id).toMatch(/^openai:/);
  });
});

describe('chat orchestrator', () => {
  const setup = (fetchImpl: FetchLike) => {
    const store = new SettingsStore(null, KEY);
    const gateway = new AiGateway(store, { fetchImpl, env: { GROQ_API_KEY: 'gsk_aaaaaaaaaa' } });
    gateway.activate('u', 'groq', 'm');
    const kb = new KnowledgeBase(null);
    kb.replace('h', [chunk('c1', 'FCT_PRODUCT_MASTER', 'Master table of products.', ['FCT_PRODUCT_MASTER'])]);
    return { chat: new ChatOrchestrator(gateway, kb, new HybridRetriever(kb, new VectorStore(null)), fetchImpl, {}), kb };
  };
  it('streams a grounded answer with numbered sources and the prompt carries the context', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = String(init.body); return streamResponse(sse(groqDelta('It is a master table [S1].'), '[DONE]')); }) as unknown as FetchLike;
    const ev = await collect(setup(f).chat.run('u', { question: 'What is FCT_PRODUCT_MASTER?', history: [] }));
    expect(ev[0]).toMatchObject({ type: 'meta', sources: [{ tag: 'S1', title: 'FCT_PRODUCT_MASTER', route: '/data-model' }], retrieval: { mode: 'keyword' } });
    expect(ev.filter((e) => e.type === 'delta')).toHaveLength(1);
    expect(ev.at(-1)).toMatchObject({ type: 'done', provider: 'groq', model: 'm', kind: 'grounded' });
    const sent = JSON.parse(body) as { messages: { role: string; content: string }[]; stream: boolean };
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].content).toMatch(/ONLY from the numbered CONTEXT/);
    expect(sent.messages.at(-1)?.content).toContain('[S1] table · FCT_PRODUCT_MASTER');
  });
  it('answers not-found without calling the model', async () => {
    let called = false;
    const f = (async () => { called = true; return streamResponse(''); }) as unknown as FetchLike;
    const ev = await collect(setup(f).chat.run('u', { question: 'unrelated pizza recipe', history: [] }));
    expect(called).toBe(false);
    expect(ev.at(-1)).toMatchObject({ type: 'done', kind: 'not-found' });
  });
  it('keeps conversation history in the prompt for follow-ups', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => { body = String(init.body); return streamResponse(sse(groqDelta('ok'))); }) as unknown as FetchLike;
    await collect(setup(f).chat.run('u', { question: 'What columns does it have?', history: [{ role: 'user', text: 'What is FCT_PRODUCT_MASTER?' }, { role: 'assistant', text: 'A master table.' }] }));
    const msgs = (JSON.parse(body) as { messages: { content: string }[] }).messages;
    expect(msgs.map((m) => m.content)).toContain('What is FCT_PRODUCT_MASTER?');
    expect(msgs.at(-1)?.content).toContain('FCT_PRODUCT_MASTER'); // entity inherited from the earlier turn
  });
  it('fails with a typed error when the provider rate limits before any text', async () => {
    const f = (async () => new Response('{"error":{"message":"Rate limit reached"}}', { status: 429 })) as unknown as FetchLike;
    expect(await codeOf(collect(setup(f).chat.run('u', { question: 'What is FCT_PRODUCT_MASTER?', history: [] })))).toBe('RATE_LIMITED');
  });
  it('refuses to run with an empty knowledge base', async () => {
    const s = setup((async () => streamResponse('')) as unknown as FetchLike);
    s.kb.replace('x', []);
    expect(await codeOf(collect(s.chat.run('u', { question: 'hello there', history: [] })))).toBe('BAD_REQUEST');
  });
});

describe('prompt builder', () => {
  it('trims history and omits unlisted tags', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `t${i}` }));
    const m = buildChatMessages({ question: 'q', history, passages: [] });
    expect(m).toHaveLength(1 + 8 + 1);
    expect(m.at(-1)?.content).toMatch(/No new passages/);
  });
});
