import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { services } from '@/services';
import type { ChatMessage, ChatTurn } from '@/types';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const HISTORY_TURNS = 8;

interface ChatState {
  open: boolean;
  messages: ChatMessage[];
  pending: boolean;
  setOpen: (v: boolean) => void;
  send: (text: string, route?: string) => Promise<void>;
  /** Re-ask the last question after a failure. */
  retry: (route?: string) => Promise<void>;
  clear: () => void;
}

/** Conversation lives for the browser tab session (sessionStorage); nothing is sent anywhere but ChatService. */
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      open: false,
      messages: [],
      pending: false,
      setOpen: (v) => set({ open: v }),
      async send(text, route) {
        const question = text.trim();
        if (!question || get().pending) return;
        const history: ChatTurn[] = get().messages
          .filter((m) => !m.isError)
          .slice(-HISTORY_TURNS)
          .map((m) => ({ role: m.role, text: m.text }));
        const user: ChatMessage = { id: uid(), role: 'user', text: question, createdAt: new Date().toISOString() };
        set((s) => ({ messages: [...s.messages, user], pending: true }));
        let reply: ChatMessage;
        try {
          const res = await services.chat.ask({ question, history, route });
          reply = res.data
            ? { id: uid(), role: 'assistant', text: res.data.text, createdAt: new Date().toISOString(), answer: res.data, meta: res.meta }
            : { id: uid(), role: 'assistant', text: res.error?.message ?? 'The assistant could not answer.', createdAt: new Date().toISOString(), meta: res.meta, isError: true };
        } catch (e) {
          reply = { id: uid(), role: 'assistant', text: e instanceof Error ? e.message : 'The assistant could not answer.', createdAt: new Date().toISOString(), isError: true };
        }
        set((s) => ({ messages: [...s.messages, reply], pending: false }));
      },
      async retry(route) {
        const msgs = get().messages;
        const idx = msgs.map((m) => m.role).lastIndexOf('user');
        if (idx < 0 || get().pending) return;
        const text = msgs[idx].text;
        set({ messages: msgs.slice(0, idx) });
        await get().send(text, route);
      },
      clear: () => set({ messages: [], pending: false }),
    }),
    {
      name: 'crismac-traq-chat',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ open: s.open, messages: s.messages }),
    },
  ),
);
