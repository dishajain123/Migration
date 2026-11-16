import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { services } from '@/services';
import type { ManualMapping, ReviewDecision, ReviewedMapping } from '@/types';

export interface StoredDecision {
  decision: ReviewDecision;
  comment: string;
  at: string;
  mapping?: ReviewedMapping; // snapshot, kept for approved mapping suggestions
}

interface ReviewState {
  mappingDecisions: Record<string, StoredDecision>;
  manualMappings: ManualMapping[];
  ruleDecisions: Record<string, StoredDecision>;
  proceduresAnalysed: Record<string, boolean>;
  lastError: string | null;
  reviewMapping: (id: string, decision: ReviewDecision, comment: string, mapping: ReviewedMapping) => Promise<boolean>;
  clearMappingDecision: (id: string) => void;
  addManualMapping: (m: Omit<ManualMapping, 'id' | 'createdAt'>) => void;
  removeManualMapping: (id: string) => void;
  reviewRule: (id: string, decision: ReviewDecision, comment: string) => Promise<boolean>;
  toggleProcedure: (id: string) => void;
  reset: () => void;
}

const initial = { mappingDecisions: {}, manualMappings: [], ruleDecisions: {}, proceduresAnalysed: {}, lastError: null };

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      ...initial,
      async reviewMapping(id, decision, comment, mapping) {
        const res = await services.mapping.submitReview(id, decision, comment);
        if (res.error) { set({ lastError: res.error.message }); return false; }
        set({
          lastError: null,
          mappingDecisions: { ...get().mappingDecisions, [id]: { decision, comment, at: new Date().toISOString(), mapping } },
        });
        return true;
      },
      clearMappingDecision(id) {
        const next = { ...get().mappingDecisions };
        delete next[id];
        set({ mappingDecisions: next });
      },
      addManualMapping(m) {
        const entry: ManualMapping = { ...m, id: `manual:${m.targetTable}.${m.targetColumn}:${Date.now()}`, createdAt: new Date().toISOString() };
        set({ manualMappings: [...get().manualMappings, entry] });
      },
      removeManualMapping(id) {
        set({ manualMappings: get().manualMappings.filter((m) => m.id !== id) });
      },
      async reviewRule(id, decision, comment) {
        const res = await services.rules.submitReview(id, decision, comment);
        if (res.error) { set({ lastError: res.error.message }); return false; }
        set({ lastError: null, ruleDecisions: { ...get().ruleDecisions, [id]: { decision, comment, at: new Date().toISOString() } } });
        return true;
      },
      toggleProcedure(id) {
        const cur = get().proceduresAnalysed;
        set({ proceduresAnalysed: { ...cur, [id]: !cur[id] } });
      },
      reset() { set({ ...initial }); },
    }),
    { name: 'crismac-traq-review-v1', partialize: (s) => ({ mappingDecisions: s.mappingDecisions, manualMappings: s.manualMappings, ruleDecisions: s.ruleDecisions, proceduresAnalysed: s.proceduresAnalysed }) },
  ),
);

/** Mappings the human reviewer has approved (or entered manually) - fed to Agent 5 validation. */
export function selectReviewedMappings(s: Pick<ReviewState, 'mappingDecisions' | 'manualMappings'>): ReviewedMapping[] {
  const approved = Object.values(s.mappingDecisions).filter((d) => d.decision === 'approved' && d.mapping).map((d) => d.mapping!);
  const manual = s.manualMappings.map((m) => ({ id: m.id, targetTable: m.targetTable, targetColumn: m.targetColumn, targetType: m.targetType, sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, sourceType: m.sourceType }));
  return [...approved, ...manual];
}
