import type { ProviderId } from '../../../src/types/ai';
import { embeddingModels, type Env } from '../config/env';
import { requestJson } from '../providers/http';
import { GatewayError, type FetchLike } from '../providers/types';

/** Turns text into vectors. Implement this to add an embedding source; retrieval does not care which one is used. */
export interface Embedder {
  /** Stable id of provider + model; vectors from different ids are never mixed. */
  id: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

const BATCH = 64;
const TIMEOUT = 60_000;

export function openAiEmbedder(key: string, model: string, fetchImpl: FetchLike, baseUrl = 'https://api.openai.com/v1'): Embedder {
  return {
    id: `openai:${model}`,
    async embed(texts, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const body = (await requestJson(fetchImpl, `${baseUrl}/embeddings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, input: texts.slice(i, i + BATCH) }),
        }, TIMEOUT, key, signal)) as { data?: { index: number; embedding: number[] }[] };
        const rows = (body?.data ?? []).slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
        if (rows.length !== Math.min(BATCH, texts.length - i)) throw new GatewayError('PROVIDER_ERROR', 'Embedding response was incomplete.', 502);
        out.push(...rows);
      }
      return out;
    },
  };
}

export function geminiEmbedder(key: string, model: string, fetchImpl: FetchLike, baseUrl = 'https://generativelanguage.googleapis.com/v1beta'): Embedder {
  return {
    id: `gemini:${model}`,
    async embed(texts, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const slice = texts.slice(i, i + 100);
        const body = (await requestJson(fetchImpl, `${baseUrl}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ requests: slice.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }),
        }, TIMEOUT, key, signal)) as { embeddings?: { values: number[] }[] };
        const rows = (body?.embeddings ?? []).map((e) => e.values);
        if (rows.length !== slice.length) throw new GatewayError('PROVIDER_ERROR', 'Embedding response was incomplete.', 502);
        out.push(...rows);
      }
      return out;
    },
  };
}

/**
 * Pick an embedder from the keys the caller has. Only OpenAI and Gemini offer embedding APIs among the supported
 * providers, so with neither key retrieval stays keyword-only (null).
 */
export function pickEmbedder(keyFor: (id: ProviderId) => string | null, fetchImpl: FetchLike, env?: Env): Embedder | null {
  const models = embeddingModels(env);
  const oa = keyFor('openai');
  if (oa) return openAiEmbedder(oa, models.openai, fetchImpl);
  const g = keyFor('gemini');
  if (g) return geminiEmbedder(g, models.gemini, fetchImpl);
  return null;
}
