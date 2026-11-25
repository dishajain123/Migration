import type { EmbeddingIndex, ProfileMetadata } from '@/types/profile';
import { describeProfile } from './profile';
import { tokens } from './mappingSemantics';

/*
 * Pure helpers for semantic (embedding) similarity between schema objects. The vectors themselves come from the AI
 * gateway (`POST /gateway/embeddings`, server/src/retrieval); this module only builds the text that is embedded, keys the
 * vectors and measures cosine similarity. Without an index the engine behaves exactly as before.
 */

export const embeddingKey = (table: string, column: string) => `${table.trim().toUpperCase()}::${column.trim().toUpperCase()}`;

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Text embedded for one column: name (split into words), type, table, and - only when supplied - profile content. */
export function columnObjectText(o: { table: string; column: string; dataType: string }, profile?: ProfileMetadata): string {
  const words = [...tokens(o.column)].join(' ');
  const prof = profile ? describeProfile(profile, o.table, o.column) : '';
  return [`column ${o.column}`, words && `words: ${words}`, o.dataType && `type: ${o.dataType}`, `table: ${o.table}`, prof].filter(Boolean).join('; ');
}

/** Cosine similarity between two columns' stored vectors, or undefined when either is missing. */
export function embeddingSimilarity(index: EmbeddingIndex | undefined, a: { table: string; column: string }, b: { table: string; column: string }): number | undefined {
  if (!index) return undefined;
  const va = index.vectors[embeddingKey(a.table, a.column)];
  const vb = index.vectors[embeddingKey(b.table, b.column)];
  return va && vb ? cosine(va, vb) : undefined;
}

/** Below this cosine the embedding adds nothing; the engine's weight scales linearly from here to 1. */
export const EMBEDDING_FLOOR = 0.6;
export const EMBEDDING_WEIGHT = 0.2;

export function embeddingBonus(cos: number | undefined): number {
  if (cos === undefined || cos <= EMBEDDING_FLOOR) return 0;
  return EMBEDDING_WEIGHT * Math.min(1, (cos - EMBEDDING_FLOOR) / (1 - EMBEDDING_FLOOR));
}

/** FNV-1a id for an index (model + keys), for caches. */
export function indexId(model: string, keys: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of `${model}|${keys.slice().sort().join(',')}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `emb:${h.toString(16).padStart(8, '0')}`;
}
