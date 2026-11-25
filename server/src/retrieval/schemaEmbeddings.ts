import { GatewayError } from '../providers/types';
import type { Embedder } from './embeddings';

/*
 * Embeddings for schema objects (columns), exposed through the same Embedder abstraction the chatbot's retrieval uses
 * (`pickEmbedder`). Vectors are unit-normalised, so cosine similarity is a dot product, and cached per embedder id so
 * re-running a table never pays for the same text twice. Vectors from different embedder ids are never mixed.
 */

export class SchemaEmbeddingCache {
  private readonly map = new Map<string, number[]>();
  constructor(private readonly max = 5000) {}
  get(key: string): number[] | undefined { return this.map.get(key); }
  set(key: string, v: number[]): void {
    if (this.map.size >= this.max) { const first = this.map.keys().next(); if (!first.done) this.map.delete(first.value); }
    this.map.set(key, v);
  }
  get size(): number { return this.map.size; }
}

export function normalise(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  const len = Math.sqrt(n);
  return len === 0 ? v : v.map((x) => x / len);
}

/** One vector per text, in order. Only texts missing from the cache are sent to the embedder (duplicates once). */
export async function embedSchemaTexts(embedder: Embedder, texts: string[], cache: SchemaEmbeddingCache, signal?: AbortSignal): Promise<number[][]> {
  const key = (t: string) => `${embedder.id}|${t}`;
  const missing = Array.from(new Set(texts.filter((t) => !cache.get(key(t)))));
  if (missing.length) {
    const vectors = await embedder.embed(missing, signal);
    if (vectors.length !== missing.length) throw new GatewayError('PROVIDER_ERROR', 'Embedding response was incomplete.', 502);
    const dim = vectors[0]?.length ?? 0;
    vectors.forEach((v, i) => {
      if (v.length === 0 || v.length !== dim) throw new GatewayError('PROVIDER_ERROR', 'Embedding response had inconsistent vector sizes.', 502);
      cache.set(key(missing[i]), normalise(v));
    });
  }
  return texts.map((t) => {
    const v = cache.get(key(t));
    if (!v) throw new GatewayError('PROVIDER_ERROR', 'Embedding cache miss after embedding.', 500);
    return v;
  });
}
