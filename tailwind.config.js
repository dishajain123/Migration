/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border: 'var(--border)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        primaryfg: 'var(--primaryfg)',
        primarybg: 'var(--primarybg)',
        ok: 'var(--ok)',
        okbg: 'var(--okbg)',
        warn: 'var(--warn)',
        warnbg: 'var(--warnbg)',
        bad: 'var(--bad)',
        badbg: 'var(--badbg)',
        info: 'var(--info)',
        infobg: 'var(--infobg)',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'], mono: ['ui-monospace', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
