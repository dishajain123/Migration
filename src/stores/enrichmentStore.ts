import { useMemo } from 'react';
import { create } from 'zustand';
import { parseProfileFile } from '@/domain/profile';
import type { EmbeddingIndex, EnrichmentOptions, ProfileMetadata } from '@/types/profile';

/**
 * The OPTIONAL enrichment inputs for Agent 4. Held in memory only on purpose (never persisted): a profile may contain
 * real data values. Nothing here is ever sent anywhere by this store; the services decide what reaches the AI gateway.
 */
interface EnrichmentState {
  profile: ProfileMetadata | null;
  fileName: string | null;
  errors: string[];
  warnings: string[];
  /** Embedding indexes by target table (built on request, see services.ai.buildEmbeddingIndex). */
  embeddings: Record<string, EmbeddingIndex>;
  loadFile: (fileName: string, text: string, shareSampleValuesWithAi?: boolean) => boolean;
  clearProfile: () => void;
  setEmbeddings: (table: string, index: EmbeddingIndex) => void;
  clearEmbeddings: () => void;
}

export const useEnrichmentStore = create<EnrichmentState>()((set, get) => ({
  profile: null, fileName: null, errors: [], warnings: [], embeddings: {},
  loadFile(fileName, text, share = false) {
    const r = parseProfileFile(fileName, text, share);
    if (!r.profile) { set({ errors: r.errors, warnings: r.warnings }); return false; }
    // A new profile invalidates indexes that embedded the old profile's content.
    const kept = Object.fromEntries(Object.entries(get().embeddings).filter(([, e]) => !e.usesProfile));
    set({ profile: r.profile, fileName, errors: r.errors, warnings: r.warnings, embeddings: kept });
    return true;
  },
  clearProfile() {
    const kept = Object.fromEntries(Object.entries(get().embeddings).filter(([, e]) => !e.usesProfile));
    set({ profile: null, fileName: null, errors: [], warnings: [], embeddings: kept });
  },
  setEmbeddings(table, index) { set({ embeddings: { ...get().embeddings, [table]: index } }); },
  clearEmbeddings() { set({ embeddings: {} }); },
}));

/** Options for one table, or undefined (pure workbook-only mode) when the user supplied nothing. */
export function enrichmentFor(s: Pick<EnrichmentState, 'profile' | 'embeddings'>, table: string): EnrichmentOptions | undefined {
  const embeddings = s.embeddings[table];
  if (!s.profile && !embeddings) return undefined;
  return { ...(s.profile ? { profile: s.profile } : {}), ...(embeddings ? { embeddings } : {}) };
}

/** Stable (memoised) options for a table, for components. */
export function useEnrichment(table: string): EnrichmentOptions | undefined {
  const profile = useEnrichmentStore((s) => s.profile);
  const embeddings = useEnrichmentStore((s) => s.embeddings[table]);
  return useMemo(() => enrichmentFor({ profile, embeddings: embeddings ? { [table]: embeddings } : {} }, table), [profile, embeddings, table]);
}
