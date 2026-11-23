import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fullscreen for one element. Uses the browser Fullscreen API when available and falls back to a fixed full-viewport
 * overlay (callers apply `active` styling) when it is blocked or unsupported. The element stays mounted either way,
 * so React state and the React Flow instance are kept.
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  const native = useRef(false);

  useEffect(() => {
    const onChange = () => {
      if (native.current && !document.fullscreenElement) { native.current = false; setActive(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active && !native.current) setActive(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('keydown', onKey); };
  }, [active]);

  // Leaving the page while fullscreen must not leave the browser in fullscreen.
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const enter = useCallback(async () => {
    setActive(true);
    const el = ref.current;
    if (el && typeof el.requestFullscreen === 'function') {
      try { await el.requestFullscreen(); native.current = true; } catch { native.current = false; }
    }
  }, []);

  const exit = useCallback(async () => {
    if (document.fullscreenElement) {
      native.current = false;
      try { await document.exitFullscreen(); } catch { /* already left */ }
    }
    native.current = false;
    setActive(false);
  }, []);

  const toggle = useCallback(() => { void (active ? exit() : enter()); }, [active, enter, exit]);
  return { ref, active, toggle, exit };
}
