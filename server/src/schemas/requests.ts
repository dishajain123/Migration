import type { KnowledgeChunk } from '../../../src/types';
import type { ChatStreamRequest, CompletionRequest, EmbedRequest } from '../../../src/types/ai';
import type { MappingDecisionRecord } from '../../../src/types/decisions';
import type { JobCreateRequest } from '../../../src/types/jobs';
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

const nameField = (v: unknown, what: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${what} is required (max ${max} characters).`);
  return v.trim();
};

export function parseDecisionRecord(b: Record<string, unknown>, now = () => new Date().toISOString()): MappingDecisionRecord {
  const id = nameField(b.id, 'id', 300);
  if (!/^[\x20-\x7E]+$/.test(id)) throw bad('id must be printable ASCII.');
  if (b.decision !== 'approved' && b.decision !== 'rejected') throw bad('decision must be "approved" or "rejected".');
  if (b.origin !== 'heuristic' && b.origin !== 'ai' && b.origin !== 'manual') throw bad('origin must be "heuristic", "ai" or "manual".');
  const rec: MappingDecisionRecord = {
    id, targetTable: nameField(b.targetTable, 'targetTable'), targetColumn: nameField(b.targetColumn, 'targetColumn'),
    sourceTable: nameField(b.sourceTable, 'sourceTable'), sourceColumn: nameField(b.sourceColumn, 'sourceColumn'),
    decision: b.decision, origin: b.origin, comment: typeof b.comment === 'string' ? b.comment.slice(0, 1000) : '',
    decidedAt: typeof b.decidedAt === 'string' && !Number.isNaN(Date.parse(b.decidedAt)) ? new Date(b.decidedAt).toISOString() : now(),
  };
  if (b.provenance !== undefined) {
    if (b.provenance !== 'workbook' && b.provenance !== 'profile_enriched' && b.provenance !== 'embedding_enriched') throw bad('Unknown provenance.');
    rec.provenance = b.provenance;
  }
  if (b.confidence !== undefined) {
    if (typeof b.confidence !== 'number' || !Number.isFinite(b.confidence)) throw bad('confidence must be a number.');
    rec.confidence = Math.max(0, Math.min(100, Math.round(b.confidence)));
  }
  if (typeof b.transformation === 'string' && b.transformation.trim()) rec.transformation = b.transformation.trim().slice(0, 600);
  return rec;
}

export const JOB_MAX_ITEMS = 50;
const ROLES = new Set(['system', 'user', 'assistant']);

export function parseJobRequest(b: Record<string, unknown>): JobCreateRequest {
  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (!/^[a-z0-9-]{1,40}$/.test(kind)) throw bad('kind must be 1-40 characters of a-z, 0-9 and "-".');
  if (!Array.isArray(b.items) || b.items.length === 0) throw bad('items must be a non-empty array.');
  if (b.items.length > JOB_MAX_ITEMS) throw bad(`Too many items (max ${JOB_MAX_ITEMS}).`);
  const seen = new Set<string>();
  const items = b.items.map((it, i) => {
    if (!isObj(it) || typeof it.id !== 'string' || !it.id.trim() || it.id.length > 200 || !isObj(it.request)) throw bad(`items[${i}] must be { id, request }.`);
    if (seen.has(it.id)) throw bad(`items[${i}].id is not unique.`);
    seen.add(it.id);
    const r = it.request;
    if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > 12) throw bad(`items[${i}].request.messages must have 1-12 messages.`);
    const messages = r.messages.map((m) => {
      if (!isObj(m) || typeof m.role !== 'string' || !ROLES.has(m.role) || typeof m.content !== 'string' || m.content.length > 200_000) throw bad(`items[${i}].request.messages are invalid.`);
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
    });
    const request: CompletionRequest = { messages };
    if (typeof r.json === 'boolean') request.json = r.json;
    if (typeof r.maxTokens === 'number' && r.maxTokens > 0) request.maxTokens = Math.min(16_000, Math.floor(r.maxTokens));
    if (typeof r.temperature === 'number') request.temperature = Math.max(0, Math.min(2, r.temperature));
    if (typeof r.agent === 'string') request.agent = r.agent.slice(0, 60);
    if (r.provider !== undefined) {
      if (typeof r.provider !== 'string' || !isProviderId(r.provider)) throw bad(`items[${i}].request.provider is unknown.`);
      request.provider = r.provider;
    }
    if (typeof r.model === 'string' && r.model.trim()) request.model = r.model.trim().slice(0, 200);
    return { id: it.id, request };
  });
  return { kind, label: typeof b.label === 'string' ? b.label.slice(0, 120) : undefined, items };
}

export const EMBED_MAX_TEXTS = 500;
export const EMBED_MAX_CHARS = 2000;

export function parseEmbedRequest(b: Record<string, unknown>): EmbedRequest {
  if (!Array.isArray(b.texts) || b.texts.length === 0) throw bad('texts must be a non-empty array.');
  if (b.texts.length > EMBED_MAX_TEXTS) throw bad(`Too many texts (max ${EMBED_MAX_TEXTS}).`);
  const texts = b.texts.map((t, i) => {
    if (typeof t !== 'string' || !t.trim()) throw bad(`texts[${i}] must be a non-empty string.`);
    return t.trim().slice(0, EMBED_MAX_CHARS);
  });
  return { texts };
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
