import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KnowledgeChunk } from '../../../src/types';
import { buildIndex, type KnowledgeIndex } from '../../../src/domain/retrieval';

/**
 * Structured project metadata the chatbot may use. Chunks are built in the browser from the workbook, data dictionary,
 * lineage, mappings, procedure SQL, rules and docs (src/domain/knowledge.ts) and pushed here, so the server never
 * holds anything that is not derived from those sources. Held in memory and mirrored to disk to survive restarts.
 */
export class KnowledgeBase {
  private chunks: KnowledgeChunk[] = [];
  private hashValue: string | null = null;
  private idx: KnowledgeIndex | null = null;

  constructor(private readonly file: string | null = null) {
    if (file && existsSync(file)) {
      try {
        const j = JSON.parse(readFileSync(file, 'utf8')) as { hash: string; chunks: KnowledgeChunk[] };
        this.chunks = j.chunks; this.hashValue = j.hash;
      } catch { /* start empty; the client will re-sync */ }
    }
  }

  get hash(): string | null { return this.hashValue; }
  get size(): number { return this.chunks.length; }
  all(): KnowledgeChunk[] { return this.chunks; }
  index(): KnowledgeIndex { return (this.idx ??= buildIndex(this.chunks)); }

  replace(hash: string, chunks: KnowledgeChunk[]) {
    this.chunks = chunks; this.hashValue = hash; this.idx = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ hash, chunks }));
    renameSync(tmp, this.file);
  }
}
