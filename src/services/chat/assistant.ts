import type { ApiResult } from '@/types';
import type { AiGatewayClient } from '../aiGateway';
import type { AssistantService, ChatService } from '../types';
import { getKnowledge } from './knowledgeSource';

const fail = (code: string, message: string): ApiResult<never> => ({ data: null, meta: { simulated: false, requestId: '', latencyMs: 0 }, error: { code, message } });

/**
 * The AI chatbot. The browser builds the knowledge chunks from workbook-derived data (so nothing is fabricated), syncs
 * them to the gateway when they change, and the gateway does retrieval, prompting and streaming against the user's
 * active provider/model. `suggestions` stays the deterministic, workbook-derived list.
 */
export function createAssistant(gateway: AiGatewayClient, suggestions: ChatService): AssistantService {
  async function ensureKnowledge(): Promise<ApiResult<never> | null> {
    let k;
    try { k = await getKnowledge(); } catch (e) { return fail('KNOWLEDGE', `Could not load the workbook knowledge: ${e instanceof Error ? e.message : 'unknown error'}`); }
    const status = await gateway.knowledgeStatus();
    if (!status.data) return fail(status.error?.code ?? 'GATEWAY_DOWN', status.error?.message ?? 'Could not reach the AI gateway.');
    if (status.data.hash === k.hash) return null;
    const pushed = await gateway.pushKnowledge(k.hash, k.chunks);
    return pushed.data ? null : fail(pushed.error?.code ?? 'GATEWAY_DOWN', pushed.error?.message ?? 'Could not sync knowledge to the AI gateway.');
  }

  return {
    async askStream(req, onEvent, opts) {
      const blocked = await ensureKnowledge();
      if (blocked) return blocked;
      return gateway.chatStream({
        question: req.question, history: req.history, route: req.route,
        provider: opts?.override?.provider, model: opts?.override?.model,
      }, onEvent, opts?.signal);
    },
    getSuggestedQuestions: (route) => suggestions.getSuggestedQuestions(route),
  };
}
