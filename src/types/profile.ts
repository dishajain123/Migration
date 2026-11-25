// Optional, opt-in enrichment inputs for Agent 4. NOTHING in here comes from the workbook: it is supplied by the user
// (a profile export, a glossary, ...). Pure workbook-only mode never touches these types. See docs/PROFILE_INPUT.md.

/** Statistics for one column, as produced by a data-profiling run. Every field is optional. */
export interface ColumnProfileStats {
  rowCount?: number;
  distinctCount?: number;
  /** Fraction 0..1 (not a percentage). */
  nullRate?: number;
  min?: string | number;
  max?: string | number;
  /** Most frequent values. Real data: only shown to an AI model when `shareSampleValuesWithAi` is set. */
  topValues?: string[];
  /** Value shapes such as `AAA-9999` or `dd/MM/yyyy`. */
  patterns?: string[];
}

export interface ProfileColumnMeta {
  table: string;
  column: string;
  description?: string;
  /** Name of a glossary term this column represents. */
  glossaryTerm?: string;
  /** Name of a value set (code list) this column draws from. */
  valueSet?: string;
  profile?: ColumnProfileStats;
}

export interface GlossaryTerm { term: string; definition?: string; synonyms?: string[] }
export interface ValueSet { name: string; values: string[] }

export interface ProfileMetadata {
  version: 1;
  /** Content hash; identifies this exact input in caches and provenance. */
  id: string;
  label?: string;
  generatedAt?: string;
  /**
   * Explicit consent flag. Sample values (`topValues`, `patterns`, value-set members) are real data: they are sent to
   * the AI provider / embedding model only when this is true. Names, descriptions and statistics never include them.
   */
  shareSampleValuesWithAi: boolean;
  columns: ProfileColumnMeta[];
  glossary: GlossaryTerm[];
  valueSets: ValueSet[];
}

/** Where a suggestion's evidence came from. Anything other than 'workbook' needs the reviewer's extra attention. */
export type SuggestionProvenance = 'workbook' | 'profile_enriched' | 'embedding_enriched';

/** Vectors for schema objects (columns), keyed `TABLE::COLUMN` upper-case. JSON-serialisable on purpose. */
export interface EmbeddingIndex {
  id: string;
  /** Provider + model that produced the vectors; vectors from different models are never compared. */
  model: string;
  /** True when profile content (descriptions, stats, sample values) was part of the embedded text. */
  usesProfile: boolean;
  vectors: Record<string, number[]>;
}

/** Optional inputs to Agent 4's engine. Leave both out for pure workbook-only mode. */
export interface EnrichmentOptions { profile?: ProfileMetadata; embeddings?: EmbeddingIndex }
