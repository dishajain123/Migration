import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { services } from '@/services';
import type { ManualMapping, ReviewDecision, ReviewedMapping, RuleApproval } from '@/types';
import type { MappingDecisionRecord } from '@/types/decisions';
import type { SuggestionProvenance } from '@/types/profile';

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
  /** Agent 5 conversion rules the user approved, with the mappings that approval saved or reused (see stores/approvalWorkflow.ts). */
  approvals: Record<string, RuleApproval>;
  proceduresAnalysed: Record<string, boolean>;
  lastError: string | null;
  /** Why a decision could not be stored by the backend (it is still kept in this browser). Not persisted. */
  syncNote: string | null;
  reviewMapping: (id: string, decision: ReviewDecision, comment: string, mapping: ReviewedMapping, meta?: DecisionMeta) => Promise<boolean>;
  clearMappingDecision: (id: string) => void;
  addManualMapping: (m: Omit<ManualMapping, 'id' | 'createdAt'>) => void;
  removeManualMapping: (id: string) => void;
  reviewRule: (id: string, decision: ReviewDecision, comment: string) => Promise<boolean>;
  /** Replace manual mappings and approval records in one update (used by the approval workflow; callers go through approvalWorkflow). */
  setMappingState: (next: { manualMappings: ManualMapping[]; approvals: Record<string, RuleApproval> }) => void;
  toggleProcedure: (id: string) => void;
  reset: () => void;
}

const initial = { mappingDecisions: {}, manualMappings: [], ruleDecisions: {}, approvals: {}, proceduresAnalysed: {}, lastError: null, syncNote: null };

/** What the reviewer saw and decided about, beyond the pairing itself. */
export interface DecisionMeta {
  origin: MappingDecisionRecord['origin'];
  provenance?: SuggestionProvenance;
  confidence?: number;
  transformation?: string;
}

export function toDecisionRecord(id: string, decision: ReviewDecision, comment: string, m: ReviewedMapping, meta: DecisionMeta | undefined, at: string): MappingDecisionRecord {
  return {
    id, targetTable: m.targetTable, targetColumn: m.targetColumn, sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, decision,
    origin: meta?.origin ?? (id.startsWith('ai:') ? 'ai' : id.startsWith('manual:') ? 'manual' : 'heuristic'),
    ...(meta?.provenance ? { provenance: meta.provenance } : {}), ...(meta?.confidence !== undefined ? { confidence: meta.confidence } : {}),
    ...(meta?.transformation ? { transformation: meta.transformation } : {}), comment, decidedAt: at,
  };
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set, get) => ({
      ...initial,
      async reviewMapping(id, decision, comment, mapping, meta) {
        const res = await services.mapping.submitReview(id, decision, comment);
        if (res.error) { set({ lastError: res.error.message }); return false; }
        const at = new Date().toISOString();
        set({
          lastError: null,
          mappingDecisions: { ...get().mappingDecisions, [id]: { decision, comment, at, mapping } },
        });
        // Also store the decision in the backend so it outlives this tab and can feed future AI runs and evaluations.
        void services.decisions.save(toDecisionRecord(id, decision, comment, mapping, meta, at))
          .then((r) => set({ syncNote: r.data ? null : `Decision kept in this browser only; the backend could not store it (${r.error?.message ?? 'unknown error'}).` }));
        return true;
      },
      clearMappingDecision(id) {
        const next = { ...get().mappingDecisions };
        delete next[id];
        set({ mappingDecisions: next });
        void services.decisions.remove(id).then((r) => { if (r.data) set({ syncNote: null }); });
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
      setMappingState(next) { set({ manualMappings: next.manualMappings, approvals: next.approvals }); },
      toggleProcedure(id) {
        const cur = get().proceduresAnalysed;
        set({ proceduresAnalysed: { ...cur, [id]: !cur[id] } });
      },
      reset() { set({ ...initial }); },
    }),
    { name: 'crismac-traq-review-v1', partialize: (s) => ({ mappingDecisions: s.mappingDecisions, manualMappings: s.manualMappings, ruleDecisions: s.ruleDecisions, approvals: s.approvals, proceduresAnalysed: s.proceduresAnalysed }) },
  ),
);

/** Mappings the human reviewer has approved (or entered manually) - fed to Agent 5 validation. */
export function selectReviewedMappings(s: Pick<ReviewState, 'mappingDecisions' | 'manualMappings'>): ReviewedMapping[] {
  const approved = Object.values(s.mappingDecisions).filter((d) => d.decision === 'approved' && d.mapping).map((d) => d.mapping!);
  const manual = s.manualMappings.map((m) => ({ id: m.id, targetTable: m.targetTable, targetColumn: m.targetColumn, targetType: m.targetType, sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, sourceType: m.sourceType }));
  return [...approved, ...manual];
}
