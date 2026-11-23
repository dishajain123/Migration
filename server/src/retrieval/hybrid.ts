import type { ChatTurn, RetrievedChunk } from '../../../src/types';
import { detectEntities, inheritEntities, isSmallTalk, search } from '../../../src/domain/retrieval';
import type { KnowledgeBase } from '../knowledge_base/knowledgeBase';
import type { Embedder } from './embeddings';
import type { VectorStore } from './vectorStore';

export interface RetrievalOutcome {
  passages: RetrievedChunk[];
  entities: string[];
  intent: 'smalltalk' | 'question';
  mode: 'hybrid' | 'keyword';
  note?: string;
}

const POOL = 20;
const RRF_K = 60;

/** Reciprocal-rank fusion of ranked id lists: robust, needs no score calibration between BM25 and cosine. */
export function fuse(lists: string[][]): Map<string, number> {
  const s = new Map<string, number>();
  for (const l of lists) l.forEach((id, i) => s.set(id, (s.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  return s;
}

/**
 * Keyword retrieval (BM25 + exact object-name match, shared with the front end's domain code) fused with embedding
 * similarity when an embedder is available. If embeddings fail for any reason the answer still comes from keyword
 * retrieval, with `note` explaining why.
 */
export class HybridRetriever {
  constructor(private readonly kb: KnowledgeBase, private readonly vectors: VectorStore) {}

  async retrieve(
    question: string, history: ChatTurn[], route: string | undefined, embedder: Embedder | null, limit = 8, signal?: AbortSignal,
  ): Promise<RetrievalOutcome> {
    if (isSmallTalk(question)) return { passages: [], entities: [], intent: 'smalltalk', mode: 'keyword' };
    const index = this.kb.index();
    const own = detectEntities(index, question);
    const entities = own.length ? own : inheritEntities(index, question, history);
    const query = own.length ? question : `${question} ${entities.join(' ')}`;
    const keyword = search(index, query, { entities, route, limit: POOL });
    if (!embedder) return { passages: keyword.slice(0, limit), entities, intent: 'question', mode: 'keyword' };

    try {
      await this.vectors.ensure(this.kb.all(), embedder, signal);
      const [qv] = await embedder.embed([query], signal);
      const semantic = this.vectors.query(embedder.id, qv, POOL);
      const fused = fuse([keyword.map((r) => r.chunk.id), semantic.map((r) => r.id)]);
      const byId = new Map(this.kb.all().map((c) => [c.id, c]));
      const kw = new Map(keyword.map((r) => [r.chunk.id, r]));
      const passages: RetrievedChunk[] = [...fused.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .flatMap(([id, score]) => {
          const chunk = byId.get(id);
          if (!chunk) return [];
          const r = kw.get(id);
          return [{ chunk, score, matchedOn: r ? r.matchedOn : ['semantic'] }];
        });
      return { passages, entities, intent: 'question', mode: 'hybrid' };
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 160) : 'unknown error';
      return { passages: keyword.slice(0, limit), entities, intent: 'question', mode: 'keyword', note: `Semantic search unavailable (${why}); used keyword search only.` };
    }
  }
}
