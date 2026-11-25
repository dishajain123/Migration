import { describe, expect, it } from 'vitest';
import { GatewayError } from '../providers/types';
import { EMBED_MAX_TEXTS, parseEmbedRequest } from '../schemas/requests';
import type { Embedder } from './embeddings';
import { embedSchemaTexts, normalise, SchemaEmbeddingCache } from './schemaEmbeddings';

function fake(id = 'test:m'): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return { id, calls, async embed(texts) { calls.push(texts); return texts.map((t) => [t.length, 1, 0]); } };
}

describe('embedSchemaTexts', () => {
  it('returns unit-length vectors in input order', async () => {
    const out = await embedSchemaTexts(fake(), ['aa', 'b'], new SchemaEmbeddingCache());
    expect(out).toHaveLength(2);
    for (const v of out) expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(out[0][0]).toBeGreaterThan(out[1][0]);
  });

  it('only sends uncached, de-duplicated texts to the provider and caches per embedder id', async () => {
    const e = fake(); const cache = new SchemaEmbeddingCache();
    await embedSchemaTexts(e, ['a', 'b', 'a'], cache);
    await embedSchemaTexts(e, ['a', 'c'], cache);
    expect(e.calls).toEqual([['a', 'b'], ['c']]);
    const other = fake('other:m');
    await embedSchemaTexts(other, ['a'], cache);
    expect(other.calls).toEqual([['a']]); // vectors from a different model are never reused
  });

  it('rejects an incomplete or inconsistent provider response', async () => {
    const short: Embedder = { id: 's', embed: async () => [[1, 0]] };
    await expect(embedSchemaTexts(short, ['a', 'b'], new SchemaEmbeddingCache())).rejects.toBeInstanceOf(GatewayError);
    const ragged: Embedder = { id: 'r', embed: async () => [[1, 0], [1]] };
    await expect(embedSchemaTexts(ragged, ['a', 'b'], new SchemaEmbeddingCache())).rejects.toBeInstanceOf(GatewayError);
  });

  it('evicts the oldest entry when full and keeps zero vectors as they are', () => {
    const c = new SchemaEmbeddingCache(2);
    c.set('a', [1]); c.set('b', [1]); c.set('c', [1]);
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(2);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });
});

describe('parseEmbedRequest', () => {
  it('accepts texts, trims and caps their length', () => {
    expect(parseEmbedRequest({ texts: [' a ', 'b'.repeat(5000)] }).texts.map((t) => t.length)).toEqual([1, 2000]);
  });
  it('rejects empty, oversized and non-string input', () => {
    expect(() => parseEmbedRequest({})).toThrow(GatewayError);
    expect(() => parseEmbedRequest({ texts: [] })).toThrow(GatewayError);
    expect(() => parseEmbedRequest({ texts: [1] })).toThrow(GatewayError);
    expect(() => parseEmbedRequest({ texts: ['  '] })).toThrow(GatewayError);
    expect(() => parseEmbedRequest({ texts: new Array(EMBED_MAX_TEXTS + 1).fill('x') })).toThrow(GatewayError);
  });
});
