import Grow from '@mui/material/Grow';
import MuiDialog from '@mui/material/Dialog';
import { X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from './ui';

const WIDTH = { sm: 448, md: 672, lg: 896, xl: 1152 } as const;

/**
 * Accessible modal on MUI's Dialog: focus is trapped and returns on close, Esc and backdrop close, page scroll locked.
 * It grows in and fades out; the backdrop fades.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const titleId = useId();
  const descId = useId();
  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      TransitionComponent={Grow}
      transitionDuration={{ enter: 220, exit: 150 }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      PaperProps={{
        sx: {
          width: '100%', maxWidth: WIDTH[size], maxHeight: '90vh', m: 2, display: 'flex', flexDirection: 'column',
          borderRadius: '12px', border: '1px solid var(--border)', bgcolor: 'var(--surface)', color: 'var(--fg)', backgroundImage: 'none',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
        },
      }}
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
    </MuiDialog>
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
        <Button variant="outline" onClick={onCancel} autoFocus>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'default'} onClick={() => { onConfirm(); onCancel(); }}>{confirmLabel}</Button>
      </>}
    >
      <div className="px-5 py-4 text-sm text-muted">{body}</div>
    </Dialog>
  );
}
