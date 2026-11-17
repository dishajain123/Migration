import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Small (i) button with an explanation popover. Opens on hover, keyboard focus or click/tap; closes on Esc or outside click.
 * Reusable on every screen: `title` says what the thing is, children explain why it exists and how to use it.
 */
export function InfoTip({ title, children, align = 'left', className }: {
  title: string; children: ReactNode; align?: 'left' | 'right'; className?: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pinned]);

  return (
    <span ref={ref} className={cn('relative inline-flex align-middle', className)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={`About: ${title}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Info size={14} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'anim-pop absolute top-full z-50 mt-1.5 w-72 rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal leading-relaxed text-fg shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <span className="mb-1 block text-[13px] font-semibold">{title}</span>
          <span className="block space-y-1 text-muted">{children}</span>
        </span>
      )}
    </span>
  );
}

/** Inline hint for a technical term: dotted underline, plain-language definition on hover/focus. */
export function Term({ children, hint }: { children: ReactNode; hint: string }) {
  return (
    <span
      tabIndex={0}
      title={hint}
      className="cursor-help underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </span>
  );
}
