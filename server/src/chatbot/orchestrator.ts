import type { ChatStreamEvent, ChatStreamRequest } from '../../../src/types/ai';
import type { AiGateway } from '../gateway';
import type { Env } from '../config/env';
import { checkGroundedness, checkOutputSecrets, hasUnverifiedClaim } from '../guardrails/outputGuardrails';
import type { KnowledgeBase } from '../knowledge_base/knowledgeBase';
import { GatewayError, type FetchLike } from '../providers/types';
import { pickEmbedder } from '../retrieval/embeddings';
import type { HybridRetriever } from '../retrieval/hybrid';
import { NOT_FOUND_TEXT, buildChatMessages, toSources } from './prompt';

/** Output guardrails only re-check a bounded prefix of the stream for leaked secrets (tokens already sent cannot be un-sent). */
const SECRET_CHECK_WINDOW = 400;

/**
 * Conversation orchestration, independent of any provider: retrieve project knowledge, build a grounded prompt, and
 * stream the model's answer through the gateway. Switching providers or models changes nothing here.
 * Events: `meta` (sources + retrieval info) first, then `delta`s, then `done`. Failures throw GatewayError.
 */
export class ChatOrchestrator {
  constructor(
    private readonly gateway: AiGateway,
    private readonly kb: KnowledgeBase,
    private readonly retriever: HybridRetriever,
    private readonly fetchImpl: FetchLike,
    private readonly env?: Env,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  async *run(uid: string, req: ChatStreamRequest, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    if (this.kb.size === 0) throw new GatewayError('BAD_REQUEST', 'The project knowledge base is empty. Reload the app so it can sync the workbook knowledge, then ask again.', 409);
    const embedder = pickEmbedder((id) => this.gateway.resolveKey(uid, id), this.fetchImpl, this.env);
    const out = await this.retriever.retrieve(req.question, req.history, req.route, embedder, 8, signal);
    const sources = toSources(out.passages);
    const meta: ChatStreamEvent = { type: 'meta', sources, retrieval: { mode: out.mode, entities: out.entities, note: out.note } };

    // Nothing relevant and no conversation to lean on: say so without spending a model call or risking a guess.
    if (out.intent === 'question' && out.passages.length === 0 && req.history.length === 0) {
      yield meta;
      yield { type: 'delta', text: NOT_FOUND_TEXT };
      yield { type: 'done', kind: 'not-found' };
      return;
    }

    const messages = buildChatMessages({ question: req.question, history: req.history, passages: out.passages, route: req.route, smalltalk: out.intent === 'smalltalk' });
    const s = this.gateway.openStream(uid, { messages, temperature: 0.2, maxTokens: 4096, agent: 'chatbot', provider: req.provider, model: req.model }, signal);
    yield meta;
    let full = '';
    for await (const text of s.deltas) {
      full += text;
      if (full.length <= SECRET_CHECK_WINDOW) {
        const secretCheck = checkOutputSecrets(full);
        if (!secretCheck.allowed) {
          this.log(`guardrail blocked output reason=${secretCheck.reason}`);
          yield { type: 'error', code: 'BLOCKED_OUTPUT', message: secretCheck.message ?? 'The answer was withheld.' };
          return;
        }
      }
      yield { type: 'delta', text };
    }
    const grounded = checkGroundedness(full, sources);
    const warning = !grounded.allowed
      ? 'fabricated-citation'
      : hasUnverifiedClaim(full, sources) ? 'unverified-claim' : undefined;
    if (warning) this.log(`guardrail warning=${warning}`);
    yield { type: 'done', provider: s.provider, model: s.model, kind: out.intent === 'smalltalk' ? 'smalltalk' : 'grounded', warning };
  }
}
