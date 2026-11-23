import { DOCS } from '@/data/docs';
import { PLATFORM_GUIDE } from '@/data/platformGuide';
import { buildKnowledge } from '@/domain/knowledge';
import { traceAll } from '@/domain/procTrace';
import type { KnowledgeChunk } from '@/types';
import { getProcSources } from '../procSource';
import { getWorkbook } from '../workbookSource';

/** cyrb53: small, fast, non-cryptographic content hash. Only used to detect "knowledge changed". */
export function hashChunks(chunks: KnowledgeChunk[]): string {
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (const c of chunks) {
    const s = `${c.id}\u0000${c.title}\u0000${c.text}\u0001`;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

let cached: Promise<{ chunks: KnowledgeChunk[]; hash: string }> | null = null;

/**
 * Everything the chatbot may know, built from the same selectors the agents use: workbook tables/columns/relationships,
 * lineage and mappings, procedure SQL and traces, business rules, docs and the platform guide. Procedure SQL is optional.
 */
export function getKnowledge(): Promise<{ chunks: KnowledgeChunk[]; hash: string }> {
  cached ??= (async () => {
    const model = await getWorkbook();
    const procs = await getProcSources().catch(() => []);
    const chunks = buildKnowledge(model, { docs: DOCS, platform: PLATFORM_GUIDE, procs, traces: traceAll(model, procs) });
    return { chunks, hash: hashChunks(chunks) };
  })().catch((e) => { cached = null; throw e; });
  return cached;
}
