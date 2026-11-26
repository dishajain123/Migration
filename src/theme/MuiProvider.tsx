import { createTheme, StyledEngineProvider, ThemeProvider } from '@mui/material/styles';
import { MotionConfig } from 'motion/react';
import { useMemo, type ReactNode } from 'react';
import { useThemeStore } from '@/stores/themeStore';

/** Reads a CSS variable so the MUI theme and the Tailwind theme share one source of colours (src/index.css). */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function buildTheme(mode: 'light' | 'dark') {
  const c = (n: string, fb: string) => cssVar(n, fb);
  return createTheme({
    palette: {
      mode,
      primary: { main: c('--primary', '#4338ca'), contrastText: c('--primaryfg', '#ffffff') },
      success: { main: c('--ok', '#15803d') },
      warning: { main: c('--warn', '#b45309') },
      error: { main: c('--bad', '#b91c1c') },
      info: { main: c('--info', '#0369a1') },
      background: { default: c('--bg', '#f6f7f9'), paper: c('--surface', '#ffffff') },
      text: { primary: c('--fg', '#0f172a'), secondary: c('--muted', '#5b6678') },
      divider: c('--border', '#dfe3ea'),
    },
    shape: { borderRadius: 6 },
    typography: { fontFamily: 'inherit', fontSize: 14, button: { textTransform: 'none', fontWeight: 500 } },
    transitions: { duration: { shortest: 120, shorter: 160, short: 200, standard: 260, complex: 320, enteringScreen: 220, leavingScreen: 160 } },
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: false } },
    },
  });
}

/**
 * MUI theme + Motion config for the whole app. `injectFirst` puts MUI's styles before Tailwind's so the layout utility
 * classes we pass as `className` (w-full, h-8, hidden...) still win. `reducedMotion="user"` makes every Motion animation
 * honour the OS "reduce motion" setting.
 */
export function MuiProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.theme);
  const theme = useMemo(() => buildTheme(mode), [mode]);
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
