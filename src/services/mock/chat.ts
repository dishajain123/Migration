import { mockChatPipeline } from '../chat/mockPipeline';
import type { ChatPipeline } from '../chat/pipeline';
import type { ChatService } from '../types';
import { respond } from './respond';

const NOTE = 'Simulated: retrieval-based answer assembled from workbook-derived data and project docs. No AI model was called.';

/** Composes the pipeline stages. A real RAG backend replaces the pipeline (or this whole service via http.ts). */
export function createChatService(p: ChatPipeline = mockChatPipeline): ChatService {
  return {
    ask: (req) => respond(async () => {
      const retrieved = await p.retriever.retrieve(req);
      const ctx = p.contextBuilder.build(req, retrieved);
      return p.generator.generate(ctx);
    }, { simulated: true, note: NOTE, provider: 'mock-retriever', model: 'template-v1' }),
    getSuggestedQuestions: (route) => respond(() => p.suggestions.suggest(route), { simulated: false, note: 'Built from workbook object names' }),
  };
}

export const mockChat: ChatService = createChatService();
