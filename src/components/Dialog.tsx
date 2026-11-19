import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Button } from './ui';

/** Accessible modal: focus moves in and returns on close, Esc and backdrop close, page scroll locked. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea')?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="anim-fade fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn('anim-pop flex max-h-[90vh] w-full flex-col rounded-xl border border-border bg-surface shadow-2xl', {
          sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl',
        }[size])}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><X size={16} /></Button>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Yes/no confirmation for actions that change many records or discard work. */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'default', onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; tone?: 'default' | 'danger';
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Dialog
      open={open} onClose={onCancel} title={title} size="sm"
      footer={<>
        <Button variant="outline" onClick={onCancel} data-autofocus>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'default'} onClick={() => { onConfirm(); onCancel(); }}>{confirmLabel}</Button>
      </>}
    >
      <div className="px-5 py-4 text-sm text-muted">{body}</div>
    </Dialog>
  );
}
