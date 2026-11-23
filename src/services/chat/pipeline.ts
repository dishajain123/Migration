import type { ChatAnswer, ChatContext, ChatRequest, RetrievalResult } from '@/types';

/*
 * The three stages of a retrieval-augmented answer, each behind its own interface so they can be swapped one at a
 * time without touching the UI or ChatService:
 *
 *   KnowledgeRetriever  mock: BM25 + entity match over workbook-derived chunks
 *                       real: embeddings + vector database query
 *   ContextBuilder      mock: pick passages, decide whether the answer is grounded
 *                       real: assemble the LLM prompt within a token budget
 *   ResponseGenerator   mock: restate retrieved text via templates (no model)
 *                       real: LLM call constrained to the supplied context
 */
export interface KnowledgeRetriever {
  retrieve(req: ChatRequest): Promise<RetrievalResult>;
}
export interface ContextBuilder {
  build(req: ChatRequest, retrieved: RetrievalResult): ChatContext;
}
export interface ResponseGenerator {
  generate(ctx: ChatContext): Promise<ChatAnswer>;
}
export interface SuggestionProvider {
  suggest(route?: string): Promise<string[]>;
}

export interface ChatPipeline {
  retriever: KnowledgeRetriever;
  contextBuilder: ContextBuilder;
  generator: ResponseGenerator;
  suggestions: SuggestionProvider;
}
