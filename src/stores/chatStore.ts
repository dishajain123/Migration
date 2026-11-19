import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { services } from '@/services';
import type { ChatMessage, ChatTurn } from '@/types';
import type { ChatStreamEvent } from '@/types/ai';
import { withRateLimitRecovery } from './rateLimitStore';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const HISTORY_TURNS = 8;
let controller: AbortController | null = null;

interface ChatState {
  open: boolean;
  messages: ChatMessage[];
  pending: boolean;
  setOpen: (v: boolean) => void;
  send: (text: string, route?: string) => Promise<void>;
  /** Re-ask the last question (after a failure, or to regenerate an answer). The original question and history are reused. */
  retry: (route?: string) => Promise<void>;
  /** Stop a streaming answer, keeping the text received so far. */
  stop: () => void;
  clear: () => void;
}

/** Conversation lives for the browser tab session (sessionStorage); only the gateway receives it, to answer the question. */
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const patch = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
        set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));

      return {
        open: false,
        messages: [],
        pending: false,
        setOpen: (v) => set({ open: v }),
        stop: () => controller?.abort(),
        async send(text, route) {
          const question = text.trim();
          if (!question || get().pending) return;
          const history: ChatTurn[] = get().messages
            .filter((m) => !m.isError && !m.streaming && m.text.trim())
            .slice(-HISTORY_TURNS)
            .map((m) => ({ role: m.role, text: m.text }));
          const now = () => new Date().toISOString();
          const user: ChatMessage = { id: uid(), role: 'user', text: question, createdAt: now() };
          const reply: ChatMessage = { id: uid(), role: 'assistant', text: '', createdAt: now(), streaming: true };
          set((s) => ({ messages: [...s.messages, user, reply], pending: true }));
          controller = new AbortController();
          const { signal } = controller;

          const onEvent = (e: ChatStreamEvent) => {
            if (e.type === 'meta') patch(reply.id, (m) => ({ ...m, ai: { sources: e.sources, kind: 'grounded', retrieval: e.retrieval.mode, note: e.retrieval.note } }));
            else if (e.type === 'delta') patch(reply.id, (m) => ({ ...m, text: m.text + e.text }));
          };

          try {
            // A rate-limited attempt is retried with the user's chosen provider/model; the same question and history are sent again.
            const res = await withRateLimitRecovery((override) => {
              patch(reply.id, (m) => ({ ...m, text: '', isError: false, errorCode: undefined }));
              return services.assistant.askStream({ question, history, route }, onEvent, { override, signal });
            });
            if (res.data) {
              const d = res.data;
              patch(reply.id, (m) => ({ ...m, streaming: false, meta: res.meta, ai: { sources: m.ai?.sources ?? [], retrieval: m.ai?.retrieval, note: m.ai?.note, kind: d.kind, provider: d.provider, model: d.model } }));
            } else if (res.error?.code === 'ABORTED') {
              patch(reply.id, (m) => ({ ...m, streaming: false, text: m.text || 'Stopped.' }));
            } else {
              patch(reply.id, (m) => ({ ...m, streaming: false, isError: true, errorCode: res.error?.code, text: res.error?.message ?? 'The assistant could not answer.', meta: res.meta }));
            }
          } catch (e) {
            patch(reply.id, (m) => ({ ...m, streaming: false, isError: true, text: e instanceof Error ? e.message : 'The assistant could not answer.' }));
          } finally {
            controller = null;
            set({ pending: false });
          }
        },
        async retry(route) {
          const msgs = get().messages;
          const idx = msgs.map((m) => m.role).lastIndexOf('user');
          if (idx < 0 || get().pending) return;
          const text = msgs[idx].text;
          set({ messages: msgs.slice(0, idx) });
          await get().send(text, route);
        },
        clear: () => { controller?.abort(); set({ messages: [], pending: false }); },
      };
    },
    {
      name: 'crismac-traq-chat',
      storage: createJSONStorage(() => sessionStorage),
      // A reload cannot resume a stream: persisted messages are always complete.
      partialize: (s) => ({ open: s.open, messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }),
    },
  ),
);
