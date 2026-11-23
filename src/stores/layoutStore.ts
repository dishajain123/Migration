import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Layout limits shared by the sidebar and the chat panel (pixels). */
export const SIDEBAR = { min: 200, max: 420, initial: 240, collapsed: 64, snapBelow: 140 } as const;
export const CHAT_PANEL = { minW: 340, maxW: 780, minH: 380, initialW: 400, initialH: 560 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatW: number;
  chatH: number;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setChatSize: (w: number, h: number) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR.initial,
      chatW: CHAT_PANEL.initialW,
      chatH: CHAT_PANEL.initialH,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setSidebarWidth: (w) => set({ sidebarWidth: clamp(Math.round(w), SIDEBAR.min, SIDEBAR.max) }),
      setChatSize: (w, h) => set({ chatW: clamp(Math.round(w), CHAT_PANEL.minW, CHAT_PANEL.maxW), chatH: Math.max(CHAT_PANEL.minH, Math.round(h)) }),
    }),
    { name: 'crismac-traq-layout' },
  ),
);
