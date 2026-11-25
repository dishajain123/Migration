import type { SuggestionProvenance } from './profile';

/**
 * A human's approve/reject decision on one source -> target pairing, stored by the backend (server/src/mappingDecisions)
 * so it outlives the browser tab. Approved records feed future few-shot context and evaluation runs; rejected ones are
 * passed to the model as pairings not to propose again. Only the reviewer's decision is stored, never AI credentials.
 */
export interface MappingDecisionRecord {
  /** The mapping's id in the review store (`sug:...`, `ai:...`, `manual:...`). Unique per user. */
  id: string;
  targetTable: string;
  targetColumn: string;
  sourceTable: string;
  sourceColumn: string;
  decision: 'approved' | 'rejected';
  origin: 'heuristic' | 'ai' | 'manual';
  provenance?: SuggestionProvenance;
  /** The score the reviewer saw (calibrated for heuristic suggestions, AI-estimated for AI ones). */
  confidence?: number;
  /** An AI_DRAFT transformation the reviewer approved or rejected along with the pairing. */
  transformation?: string;
  comment: string;
  /** ISO timestamp. */
  decidedAt: string;
}
