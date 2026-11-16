import { create } from 'zustand';

type Theme = 'light' | 'dark';
const KEY = 'crismac-traq-theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

interface ThemeState { theme: Theme; toggle: () => void; init: () => void }

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  init() { const t = initialTheme(); apply(t); set({ theme: t }); },
  toggle() { const t: Theme = get().theme === 'dark' ? 'light' : 'dark'; apply(t); set({ theme: t }); },
}));
