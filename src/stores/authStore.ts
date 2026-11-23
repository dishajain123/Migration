import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { authService, type Session } from '@/auth/authService';
import { setUserIdProvider } from '@/services/aiGateway';

interface AuthState {
  session: Session | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (name: string, identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// sessionStorage: the demo session ends with the tab. Only the session (no password) is persisted.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      async signIn(identifier, password) { set({ session: await authService.signIn(identifier, password) }); },
      async signUp(name, identifier, password) { set({ session: await authService.signUp(name, identifier, password) }); },
      async signOut() { await authService.signOut(); set({ session: null }); },
    }),
    { name: 'crismac-traq-demo-session', storage: createJSONStorage(() => sessionStorage), partialize: (s) => ({ session: s.session }) },
  ),
);
setUserIdProvider(() => useAuthStore.getState().session?.userId ?? null);
