import type { KnowledgeChunk } from '../../../src/types';
import type { ChatStreamRequest } from '../../../src/types/ai';
import { isProviderId } from '../providers/registry';
import { GatewayError } from '../providers/types';

// Hand-written request validation (no schema library): every external payload is checked before use.
const bad = (m: string) => new GatewayError('BAD_REQUEST', m);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseChatRequest(b: Record<string, unknown>): ChatStreamRequest {
  const q = typeof b.question === 'string' ? b.question.trim() : '';
  if (!q) throw bad('question is required.');
  if (q.length > 4000) throw bad('question is too long (max 4000 characters).');
  const history = Array.isArray(b.history) ? b.history : [];
  if (history.length > 40) throw bad('history is too long.');
  const turns = history.map((t) => {
    if (!isObj(t) || (t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string') throw bad('history items must be { role, text }.');
    return { role: t.role, text: t.text.slice(0, 8000) };
  });
  const out: ChatStreamRequest = { question: q, history: turns };
  if (typeof b.route === 'string') out.route = b.route.slice(0, 200);
  if (b.provider !== undefined) {
    if (typeof b.provider !== 'string' || !isProviderId(b.provider)) throw bad('Unknown provider.');
    out.provider = b.provider;
  }
  if (typeof b.model === 'string' && b.model.trim()) out.model = b.model.trim().slice(0, 200);
  return out;
}

const KINDS = new Set(['table', 'column', 'lineage', 'mapping', 'procedure', 'rule', 'relationship', 'scope', 'gap', 'glossary', 'documentation', 'platform']);
const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function parseKnowledgePush(b: Record<string, unknown>): { hash: string; chunks: KnowledgeChunk[] } {
  if (typeof b.hash !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(b.hash)) throw bad('hash is required.');
  if (!Array.isArray(b.chunks) || b.chunks.length === 0) throw bad('chunks must be a non-empty array.');
  if (b.chunks.length > 20_000) throw bad('Too many chunks.');
  const chunks = b.chunks.map((c, i): KnowledgeChunk => {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.text !== 'string' || typeof c.kind !== 'string' || !KINDS.has(c.kind)
      || !strArr(c.keywords) || !strArr(c.entities) || !Array.isArray(c.sources) || !['workbook', 'derived', 'documentation'].includes(String(c.origin))) {
      throw bad(`chunks[${i}] is not a valid knowledge chunk.`);
    }
    return c as unknown as KnowledgeChunk;
  });
  return { hash: b.hash, chunks };
}
