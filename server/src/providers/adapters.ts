import type { ChatMessage, ProviderInfo } from '../../../src/types/ai';
import { requestJson, streamSse } from './http';
import { filterGeminiModels, filterGroqModels, filterOpenRouterModels } from './modelFilter';
import { GatewayError, type ProviderAdapter, type ProviderConfig } from './types';

const trim = (u: string) => u.replace(/\/+$/, '');
// The gateway does not yet pass tool schemas through, so toolCalling is false for every provider.
const CAPS = { toolCalling: false, temperature: true, maxTokens: true };

function authHeaders(key: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}
function need(cfg: { apiKey: string | null }, info: ProviderInfo) {
  if (info.requiresKey && !cfg.apiKey) throw new GatewayError('MISSING_KEY', `No API key saved for ${info.label}.`, 400);
}
const parse = (data: string): unknown => { try { return JSON.parse(data); } catch { return null; } };

interface OpenAiShape { choices?: { message?: { content?: string | null } }[] }
interface OpenAiChunk { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } }

/** OpenAI-style /chat/completions. Used by OpenAI, Groq, OpenRouter and Ollama (its /v1 compatibility endpoint). */
function openAiCompatible(opts: {
  info: ProviderInfo; chatBase: (base: string) => string; maxTokensField: string;
  listModels: (base: string, key: string | null) => { url: string; pick: (b: unknown) => string[] };
}): ProviderAdapter {
  const { info } = opts;
  const payload = (messages: ChatMessage[], cfg: ProviderConfig, stream: boolean) => {
    const p: Record<string, unknown> = { model: cfg.model, messages };
    if (cfg.temperature !== undefined) p.temperature = cfg.temperature;
    if (cfg.maxTokens !== undefined) p[opts.maxTokensField] = cfg.maxTokens;
    if (cfg.json) p.response_format = { type: 'json_object' };
    if (stream) p.stream = true;
    return JSON.stringify(p);
  };
  const url = (cfg: ProviderConfig) => `${opts.chatBase(trim(cfg.baseUrl))}/chat/completions`;
  return {
    info,
    async listModels(cfg) {
      need(cfg, info);
      const l = opts.listModels(trim(cfg.baseUrl), cfg.apiKey);
      const body = await requestJson(cfg.fetchImpl, l.url, { headers: authHeaders(cfg.apiKey) }, cfg.timeoutMs, cfg.apiKey, cfg.signal);
      return l.pick(body).sort();
    },
    async complete(messages, cfg) {
      need(cfg, info);
      const body = (await requestJson(cfg.fetchImpl, url(cfg),
        { method: 'POST', headers: authHeaders(cfg.apiKey), body: payload(messages, cfg, false) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) as OpenAiShape;
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        // Reasoning models (e.g. gpt-oss) can spend the whole token budget thinking and return an empty message.
        throw new GatewayError('PROVIDER_ERROR', 'Provider returned an empty message. If this is a reasoning model, raise Max tokens in AI Settings.', 502);
      }
      return text;
    },
    async *stream(messages, cfg) {
      need(cfg, info);
      let any = false;
      for await (const data of streamSse(cfg.fetchImpl, url(cfg),
        { method: 'POST', headers: authHeaders(cfg.apiKey), body: payload(messages, cfg, true) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) {
        if (data.trim() === '[DONE]') break;
        const j = parse(data) as OpenAiChunk | null;
        if (j?.error?.message) throw new GatewayError('PROVIDER_ERROR', j.error.message.slice(0, 240), 502);
        const t = j?.choices?.[0]?.delta?.content;
        if (typeof t === 'string' && t) { any = true; yield t; }
      }
      if (!any) throw new GatewayError('PROVIDER_ERROR', 'The model returned no text. If this is a reasoning model, raise Max tokens in AI Settings.', 502);
    },
  };
}

const idsFromData = (b: unknown): string[] => ((b as { data?: { id?: string }[] })?.data ?? []).map((m) => m.id ?? '').filter(Boolean);

const info = (i: Omit<ProviderInfo, 'capabilities'> & { jsonMode: boolean }): ProviderInfo => {
  const { jsonMode, ...rest } = i;
  return { ...rest, capabilities: { ...CAPS, jsonMode } };
};

export const openai = openAiCompatible({
  info: info({ id: 'openai', label: 'OpenAI', requiresKey: true, usesBaseUrl: false, defaultBaseUrl: 'https://api.openai.com/v1', keyHelpUrl: 'https://platform.openai.com/api-keys', jsonMode: true }),
  chatBase: (b) => b, maxTokensField: 'max_completion_tokens',
  listModels: (b) => ({ url: `${b}/models`, pick: idsFromData }),
});
export const groq = openAiCompatible({
  info: info({ id: 'groq', label: 'Groq', requiresKey: true, usesBaseUrl: false, defaultBaseUrl: 'https://api.groq.com/openai/v1', keyHelpUrl: 'https://console.groq.com/keys', jsonMode: true }),
  chatBase: (b) => b, maxTokensField: 'max_tokens',
  listModels: (b) => ({ url: `${b}/models`, pick: (x) => filterGroqModels(idsFromData(x)) }),
});
export const openrouter = openAiCompatible({
  info: info({ id: 'openrouter', label: 'OpenRouter', requiresKey: true, usesBaseUrl: false, defaultBaseUrl: 'https://openrouter.ai/api/v1', keyHelpUrl: 'https://openrouter.ai/keys', jsonMode: true }),
  chatBase: (b) => b, maxTokensField: 'max_tokens',
  listModels: (b) => ({ url: `${b}/models`, pick: (x) => filterOpenRouterModels((x as { data?: { id?: string; created?: number }[] })?.data ?? []) }),
});
export const ollama = openAiCompatible({
  info: info({ id: 'ollama', label: 'Ollama (local)', requiresKey: false, usesBaseUrl: true, defaultBaseUrl: 'http://localhost:11434', keyHelpUrl: 'https://ollama.com/download', jsonMode: true }),
  chatBase: (b) => `${b}/v1`, maxTokensField: 'max_tokens',
  listModels: (b) => ({ url: `${b}/api/tags`, pick: (x) => ((x as { models?: { name?: string }[] })?.models ?? []).map((m) => m.name ?? '').filter(Boolean) }),
});

// ---- Anthropic ----
const anthropicInfo = info({ id: 'anthropic', label: 'Anthropic Claude', requiresKey: true, usesBaseUrl: false, defaultBaseUrl: 'https://api.anthropic.com/v1', keyHelpUrl: 'https://console.anthropic.com/settings/keys', jsonMode: false });
const anthropicHeaders = (key: string | null) => ({ 'Content-Type': 'application/json', 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' });
const anthropicBody = (messages: ChatMessage[], cfg: ProviderConfig, stream: boolean) => {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const p: Record<string, unknown> = {
    model: cfg.model, max_tokens: cfg.maxTokens ?? 1024,
    messages: messages.filter((m) => m.role !== 'system'),
  };
  if (system) p.system = system;
  if (cfg.temperature !== undefined) p.temperature = cfg.temperature;
  if (stream) p.stream = true;
  return JSON.stringify(p);
};
export const anthropic: ProviderAdapter = {
  info: anthropicInfo,
  async listModels(cfg) {
    need(cfg, anthropicInfo);
    return idsFromData(await requestJson(cfg.fetchImpl, `${trim(cfg.baseUrl)}/models?limit=100`, { headers: anthropicHeaders(cfg.apiKey) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)).sort();
  },
  async complete(messages, cfg) {
    need(cfg, anthropicInfo);
    const body = (await requestJson(cfg.fetchImpl, `${trim(cfg.baseUrl)}/messages`,
      { method: 'POST', headers: anthropicHeaders(cfg.apiKey), body: anthropicBody(messages, cfg, false) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) as { content?: { type: string; text?: string }[] };
    const text = (body?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text) throw new GatewayError('PROVIDER_ERROR', 'Provider returned no text content.', 502);
    return text;
  },
  async *stream(messages, cfg) {
    need(cfg, anthropicInfo);
    for await (const data of streamSse(cfg.fetchImpl, `${trim(cfg.baseUrl)}/messages`,
      { method: 'POST', headers: anthropicHeaders(cfg.apiKey), body: anthropicBody(messages, cfg, true) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) {
      const j = parse(data) as { type?: string; delta?: { type?: string; text?: string }; error?: { type?: string; message?: string } } | null;
      if (j?.type === 'error') {
        const t = j.error?.type ?? '';
        throw new GatewayError(t === 'rate_limit_error' ? 'RATE_LIMITED' : t === 'overloaded_error' ? 'SERVER_ERROR' : 'PROVIDER_ERROR', (j.error?.message ?? 'Stream error').slice(0, 240), t === 'rate_limit_error' ? 429 : 502);
      }
      if (j?.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) yield j.delta.text;
    }
  },
};

// ---- Google Gemini (key sent in a header, never in the URL) ----
const geminiInfo = info({ id: 'gemini', label: 'Google Gemini', requiresKey: true, usesBaseUrl: false, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHelpUrl: 'https://aistudio.google.com/apikey', jsonMode: true });
const geminiHeaders = (key: string | null) => ({ 'Content-Type': 'application/json', 'x-goog-api-key': key ?? '' });
const geminiBody = (messages: ChatMessage[], cfg: ProviderConfig) => {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const generationConfig: Record<string, unknown> = {};
  if (cfg.temperature !== undefined) generationConfig.temperature = cfg.temperature;
  if (cfg.maxTokens !== undefined) generationConfig.maxOutputTokens = cfg.maxTokens;
  if (cfg.json) generationConfig.responseMimeType = 'application/json';
  const p: Record<string, unknown> = {
    contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig,
  };
  if (system) p.systemInstruction = { parts: [{ text: system }] };
  return JSON.stringify(p);
};
const geminiText = (b: unknown): string => ((b as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
export const gemini: ProviderAdapter = {
  info: geminiInfo,
  async listModels(cfg) {
    need(cfg, geminiInfo);
    const body = (await requestJson(cfg.fetchImpl, `${trim(cfg.baseUrl)}/models?pageSize=200`, { headers: geminiHeaders(cfg.apiKey) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) as
      { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    return filterGeminiModels((body?.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean));
  },
  async complete(messages, cfg) {
    need(cfg, geminiInfo);
    const body = await requestJson(cfg.fetchImpl, `${trim(cfg.baseUrl)}/models/${encodeURIComponent(cfg.model)}:generateContent`,
      { method: 'POST', headers: geminiHeaders(cfg.apiKey), body: geminiBody(messages, cfg) }, cfg.timeoutMs, cfg.apiKey, cfg.signal);
    const text = geminiText(body);
    if (!text) throw new GatewayError('PROVIDER_ERROR', 'Provider returned no text (the response may have been blocked).', 502);
    return text;
  },
  async *stream(messages, cfg) {
    need(cfg, geminiInfo);
    let any = false;
    for await (const data of streamSse(cfg.fetchImpl, `${trim(cfg.baseUrl)}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`,
      { method: 'POST', headers: geminiHeaders(cfg.apiKey), body: geminiBody(messages, cfg) }, cfg.timeoutMs, cfg.apiKey, cfg.signal)) {
      const t = geminiText(parse(data));
      if (t) { any = true; yield t; }
    }
    if (!any) throw new GatewayError('PROVIDER_ERROR', 'Provider returned no text (the response may have been blocked).', 502);
  },
};
