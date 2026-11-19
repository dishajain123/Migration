import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KnowledgeChunk } from '../../../src/types';
import type { Embedder } from './embeddings';

const textOf = (c: KnowledgeChunk) => `${c.title}\n${c.text}`.slice(0, 6000);
const digest = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

interface Entry { h: string; v: number[] }

/**
 * Small file-backed vector store: one JSON file per embedding model id, holding a vector per chunk keyed by a content
 * hash, so only new or edited chunks are re-embedded. Brute-force cosine search is ample for a few thousand chunks.
 * Swap this class for a real vector database behind the same two methods (`ensure`, `query`).
 */
export class VectorStore {
  private readonly mem = new Map<string, Map<string, Entry>>();
  private readonly building = new Map<string, Promise<void>>();

  constructor(private readonly dir: string | null) {}

  private fileFor(embedderId: string) { return this.dir ? join(this.dir, `vectors-${embedderId.replace(/[^a-z0-9._-]/gi, '_')}.json`) : null; }

  private load(embedderId: string): Map<string, Entry> {
    let m = this.mem.get(embedderId);
    if (m) return m;
    m = new Map();
    const f = this.fileFor(embedderId);
    if (f && existsSync(f)) {
      try { for (const [id, e] of Object.entries(JSON.parse(readFileSync(f, 'utf8')) as Record<string, Entry>)) m.set(id, e); } catch { /* rebuild */ }
    }
    this.mem.set(embedderId, m);
    return m;
  }

  private save(embedderId: string, m: Map<string, Entry>) {
    const f = this.fileFor(embedderId);
    if (!f) return;
    mkdirSync(dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(m)));
    renameSync(tmp, f);
  }

  /** Number of the given chunks that already have an up-to-date vector. */
  indexed(embedderId: string, chunks: KnowledgeChunk[]): number {
    const m = this.load(embedderId);
    return chunks.filter((c) => m.get(c.id)?.h === digest(textOf(c))).length;
  }

  /** Embed whatever is missing or changed. Concurrent callers share one build. */
  ensure(chunks: KnowledgeChunk[], embedder: Embedder, signal?: AbortSignal): Promise<void> {
    const running = this.building.get(embedder.id);
    if (running) return running;
    const m = this.load(embedder.id);
    const todo = chunks.filter((c) => m.get(c.id)?.h !== digest(textOf(c)));
    if (todo.length === 0) return Promise.resolve();
    const job = (async () => {
      const vectors = await embedder.embed(todo.map(textOf), signal);
      todo.forEach((c, i) => m.set(c.id, { h: digest(textOf(c)), v: vectors[i] }));
      const live = new Set(chunks.map((c) => c.id));
      for (const id of m.keys()) if (!live.has(id)) m.delete(id);
      this.save(embedder.id, m);
    })().finally(() => this.building.delete(embedder.id));
    this.building.set(embedder.id, job);
    return job;
  }

  /** Top-k chunk ids by cosine similarity to the query vector. */
  query(embedderId: string, vector: number[], k: number): { id: string; score: number }[] {
    const m = this.load(embedderId);
    const qn = Math.sqrt(vector.reduce((a, x) => a + x * x, 0)) || 1;
    const out: { id: string; score: number }[] = [];
    for (const [id, e] of m) {
      if (e.v.length !== vector.length) continue;
      let dot = 0; let en = 0;
      for (let i = 0; i < vector.length; i++) { dot += vector[i] * e.v[i]; en += e.v[i] * e.v[i]; }
      out.push({ id, score: dot / (qn * (Math.sqrt(en) || 1)) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
