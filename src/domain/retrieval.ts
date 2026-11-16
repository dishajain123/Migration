import type { ChatTurn, KnowledgeChunk, KnowledgeKind, RetrievedChunk } from '@/types';

/*
 * Pure keyword retrieval (BM25 + exact-entity boost). This is the part a real RAG pipeline replaces with
 * embeddings + a vector store; the KnowledgeRetriever interface in services/chat hides the difference.
 */

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'what', 'which', 'who',
  'how', 'does', 'do', 'did', 'it', 'its', 'this', 'that', 'these', 'those', 'me', 'my', 'i', 'you', 'can', 'could', 'should',
  'about', 'tell', 'show', 'give', 'please', 'there', 'from', 'by', 'at', 'as', 'any', 'all', 'has', 'have', 'had', 'get', 'gets',
  'know', 'want', 'need', 'let', 'us', 'we', 'if', 'so', 'than', 'then', 'into', 'out', 'up', 'not',
  'where', 'when', 'why', 'whose', 'whom', 'explain', 'describe', 'list', 'many', 'much', 'name',
]);
const SYNONYMS: Record<string, string> = {
  field: 'column', fields: 'column', attribute: 'column', attributes: 'column',
  sproc: 'procedure', proc: 'procedure', etl: 'procedure',
  migrate: 'mapping', migration: 'mapping', mapped: 'mapping', maps: 'mapping',
  validation: 'rule', validate: 'rule', constraint: 'rule',
};

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Lower-cased content terms; underscored names also contribute their parts (FCT_PRODUCT_MASTER -> fct, product, master). */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const w = raw.toLowerCase();
    const parts = w.includes('_') ? [w, ...w.split('_').filter(Boolean)] : [w];
    for (const p of parts) {
      if (p.length < 2 || STOP.has(p)) continue;
      const s = stem(p);
      out.push(SYNONYMS[s] ?? SYNONYMS[p] ?? s);
    }
  }
  return out;
}

interface IndexedDoc { chunk: KnowledgeChunk; len: number }
export interface KnowledgeIndex {
  docs: IndexedDoc[];
  postings: Map<string, [number, number][]>;
  avgLen: number;
  entities: Map<string, number[]>;
  entityNames: Set<string>;
}

const W_TITLE = 3;
const W_KEYWORD = 2;

export function buildIndex(chunks: KnowledgeChunk[]): KnowledgeIndex {
  const docs: IndexedDoc[] = [];
  const postings = new Map<string, [number, number][]>();
  const entities = new Map<string, number[]>();
  let total = 0;
  chunks.forEach((chunk, i) => {
    const tf = new Map<string, number>();
    const add = (list: string[], w: number) => { for (const t of list) tf.set(t, (tf.get(t) ?? 0) + w); };
    add(terms(chunk.title), W_TITLE);
    add(terms(chunk.keywords.join(' ')), W_KEYWORD);
    add(terms(chunk.text), 1);
    let len = 0;
    for (const [t, f] of tf) {
      len += f;
      const p = postings.get(t);
      if (p) p.push([i, f]); else postings.set(t, [[i, f]]);
    }
    total += len;
    docs.push({ chunk, len });
    for (const e of chunk.entities) {
      const key = e.toUpperCase();
      const list = entities.get(key);
      if (list) list.push(i); else entities.set(key, [i]);
    }
  });
  return { docs, postings, avgLen: docs.length ? total / docs.length : 1, entities, entityNames: new Set(entities.keys()) };
}

/**
 * Exact object names mentioned in free text. A bare word only counts when it contains an underscore or was typed in
 * capitals, so ordinary words such as "status" do not pull in every column of that name.
 * Qualified references (TABLE.COLUMN) are returned as "TABLE.COLUMN".
 */
export function detectEntities(index: KnowledgeIndex, text: string): string[] {
  const found: string[] = [];
  const push = (e: string) => { if (!found.includes(e)) found.push(e); };
  for (const m of text.matchAll(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
    const q = `${m[1]}.${m[2]}`.toUpperCase();
    if (index.entityNames.has(q)) push(q);
  }
  for (const raw of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const up = raw.toUpperCase();
    if (!index.entityNames.has(up)) continue;
    if (raw.includes('_') || (raw === up && raw.length >= 3)) push(up);
  }
  return found;
}

const PRONOUN = /\b(it|its|that table|this table|that column|this column|those|them|same table|the same)\b/i;

/** Carry the previous question's objects into a follow-up such as "what rules apply to it?". */
export function inheritEntities(index: KnowledgeIndex, question: string, history: ChatTurn[]): string[] {
  if (!PRONOUN.test(question)) return [];
  const users = history.filter((t) => t.role === 'user').slice(-3).reverse();
  for (const t of users) {
    const e = detectEntities(index, t.text);
    if (e.length) return e;
  }
  return [];
}

const SMALLTALK = /^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|thanks|thank you|thx|ok|okay|help|what can you do\??|who are you\??)\W*$/i;
export const isSmallTalk = (q: string): boolean => SMALLTALK.test(q);

const INTENTS: { re: RegExp; kinds: KnowledgeKind[] }[] = [
  { re: /\b(column|field|datatype|data type|nullable|null|type)s?\b/i, kinds: ['column', 'table'] },
  { re: /\b(lineage|flow|upstream|downstream|feeds?|fed|source[sd]?|comes? from|come from|where does)\b/i, kinds: ['lineage', 'mapping'] },
  { re: /\b(map|maps|mapping|mappings|mapped|migrate|migration|crismac)\b/i, kinds: ['mapping', 'column'] },
  { re: /\b(procedure|procedures|view|views|workflow|logic|etl|sql|stored)\b/i, kinds: ['procedure'] },
  { re: /\b(rule|rules|validate|validation|mandatory|constraint|default|derived|derivation|npa_id)\b/i, kinds: ['rule'] },
  { re: /\b(relationship|relationships|relate|related|join|joins|foreign|key|keys|link|links|lookup)\b/i, kinds: ['relationship'] },
  { re: /\b(how do i|how to|where (do|can) i|navigate|navigation|page|screen|click|button|tab|sidebar|chatbot|use the|approve|reject)\b/i, kinds: ['platform'] },
  { re: /\b(gap|gaps|missing|limitation|limitations|not provided|unknown|caveat)\b/i, kinds: ['gap'] },
  { re: /\b(scope|in scope|out of scope|sheet|sheets|which tables|layer|layers|architecture)\b/i, kinds: ['scope', 'glossary'] },
  { re: /\b(what is|what are|explain|mean|meaning|define|definition|overview|traq|purpose)\b/i, kinds: ['glossary', 'table', 'documentation'] },
];

export interface SearchOptions { entities: string[]; route?: string; limit: number }

export function search(index: KnowledgeIndex, query: string, opts: SearchOptions): RetrievedChunk[] {
  const qTerms = Array.from(new Set(terms(query)));
  const scores = new Map<number, { score: number; matched: Set<string> }>();
  const N = index.docs.length;
  for (const t of qTerms) {
    const post = index.postings.get(t);
    if (!post) continue;
    const idf = Math.log(1 + (N - post.length + 0.5) / (post.length + 0.5));
    for (const [di, f] of post) {
      const len = index.docs[di].len;
      const s = idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / index.avgLen))));
      const cur = scores.get(di) ?? { score: 0, matched: new Set<string>() };
      cur.score += s;
      cur.matched.add(t);
      scores.set(di, cur);
    }
  }
  // exact object-name boost (qualified TABLE.COLUMN references are strongest)
  for (const e of opts.entities) {
    const boost = e.includes('.') ? 20 : 8;
    for (const di of index.entities.get(e) ?? []) {
      const cur = scores.get(di) ?? { score: 0, matched: new Set<string>() };
      cur.score += boost;
      cur.matched.add(e);
      scores.set(di, cur);
    }
    if (e.includes('.')) {
      const [tbl, col] = e.split('.');
      // a qualified reference should also surface the column chunk of that exact table
      for (const di of index.entities.get(col) ?? []) {
        const c = index.docs[di].chunk;
        if (c.kind === 'column' && c.title.toUpperCase().startsWith(`${tbl}.`)) {
          const cur = scores.get(di) ?? { score: 0, matched: new Set<string>() };
          cur.score += 20;
          cur.matched.add(e);
          scores.set(di, cur);
        }
      }
    }
  }
  const wanted = new Set<KnowledgeKind>();
  for (const i of INTENTS) if (i.re.test(query)) i.kinds.forEach((k) => wanted.add(k));
  const here = /\b(this|current)\s+(page|screen|view)\b|\bhere\b/i.test(query);

  const out: RetrievedChunk[] = [];
  for (const [di, { score, matched }] of scores) {
    const chunk = index.docs[di].chunk;
    let s = score;
    if (wanted.has(chunk.kind)) s *= 1.4;
    if (here && opts.route && chunk.kind === 'platform' && chunk.sources.some((r) => r.route === opts.route)) s += 10;
    out.push({ chunk, score: s, matchedOn: Array.from(matched) });
  }
  out.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  return out.slice(0, opts.limit);
}
