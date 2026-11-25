// Structured output of Agent 4's AI proposals. Every item is a DRAFT: it was checked by the deterministic validators, not
// approved. Nothing here is workbook data; it is labelled AI wherever it is shown.

export interface ProposalSource { table: string; column: string; /** From the schema, once validated. */ type?: string }

export interface ProposedTransformation {
  /** The expression exactly as the model wrote it. */
  text: string;
  /** Only valid expressions are ever attached. */
  status: 'AI_DRAFT';
  /** What the SQL parser and identifier checks confirmed (or warned about). */
  checks: string[];
}

export interface AiMappingProposal {
  id: string;
  targetTable: string;
  targetColumn: string;
  targetType: string;
  /** More than one source = many-to-one (the transformation says how they combine). */
  sources: ProposalSource[];
  /** 'heuristic-candidate' = the model picked one of the engine's candidates; 'ai-discovered' = it found a column the heuristics did not offer. */
  origin: 'heuristic-candidate' | 'ai-discovered';
  /** The model's own estimate, 0-100. Not calibrated. */
  confidence: number | null;
  reason: string;
  transformation?: ProposedTransformation;
  /** 'valid' or 'valid_with_warnings' from `validateCandidateMapping`. Invalid proposals are never surfaced. */
  validation: 'valid' | 'valid_with_warnings';
  warnings: string[];
  status: 'AI_DRAFT';
}

export interface DiscardedProposal { targetColumn: string; source?: string; reason: string }

export interface MappingProposalSet {
  table: string;
  proposals: AiMappingProposal[];
  unresolved: { targetColumn: string; reason: string }[];
  discarded: DiscardedProposal[];
}
