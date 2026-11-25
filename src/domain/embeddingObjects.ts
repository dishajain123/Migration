import type { WorkbookModel } from '@/types';
import type { EmbeddingIndex, ProfileMetadata } from '@/types/profile';
import { candidatePool, unfedColumns } from './mappingEngine';
import { columnObjectText, embeddingKey, indexId } from './schemaEmbedding';

/*
 * Which schema objects get embedded for one target table: its unfed columns plus every candidate source column the
 * engine compares. Pure; the gateway call lives in services/ai/agentAi.ts.
 */

export interface EmbeddingObject { key: string; table: string; column: string; text: string }

/** Cap on objects per table, so one request stays small and cheap. */
export const MAX_EMBEDDING_OBJECTS = 1200;

export function embeddingObjects(model: WorkbookModel, tableName: string, profile?: ProfileMetadata): EmbeddingObject[] {
  const t = model.tables.find((x) => x.name === tableName);
  if (!t) return [];
  const seen = new Set<string>();
  const out: EmbeddingObject[] = [];
  const add = (table: string, column: string, dataType: string) => {
    const key = embeddingKey(table, column);
    if (seen.has(key) || out.length >= MAX_EMBEDDING_OBJECTS) return;
    seen.add(key);
    out.push({ key, table, column, text: columnObjectText({ table, column, dataType }, profile) });
  };
  for (const u of unfedColumns(model, t)) add(t.name, u.targetColumn, u.targetType);
  for (const p of candidatePool(model, t)) add(p.table, p.column, p.type);
  return out;
}

export function buildEmbeddingIndex(objects: EmbeddingObject[], vectors: number[][], modelName: string, profile?: ProfileMetadata): EmbeddingIndex {
  if (vectors.length !== objects.length) throw new Error('Embedding count does not match the number of schema objects.');
  const map: Record<string, number[]> = {};
  objects.forEach((o, i) => { map[o.key] = vectors[i]; });
  return { id: indexId(`${modelName}${profile ? `|${profile.id}` : ''}`, objects.map((o) => o.key)), model: modelName, usesProfile: !!profile, vectors: map };
}
