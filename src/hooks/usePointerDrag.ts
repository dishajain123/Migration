import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

interface Options {
  onStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  onMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onEnd?: () => void;
  cursor: string;
}

/**
 * Pointer-capture drag for resize handles. Capturing on the handle keeps the drag alive when the pointer leaves it
 * and stops the gesture from reaching (or clicking) anything underneath. Spread `handleProps` on the handle element.
 */
export function usePointerDrag({ onStart, onMove, onEnd, cursor }: Options) {
  const [dragging, setDragging] = useState(false);
  const active = useRef(false);

  useEffect(() => {
    if (!dragging) return undefined;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging, cursor]);

  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!active.current) return;
    active.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    onEnd?.();
  };

  return {
    dragging,
    handleProps: {
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        active.current = true;
        setDragging(true);
        onStart?.(e);
      },
      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        if (active.current) onMove(e);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClick(e: ReactMouseEvent) { e.stopPropagation(); },
    },
  };
}
