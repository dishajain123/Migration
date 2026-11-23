import { Boxes, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-2">
          <Boxes size={26} className="text-primary" />
          <div>
            <div className="text-base font-semibold leading-tight">CrisMAC → TRAQ</div>
            <div className="text-xs text-muted">Migration Intelligence</div>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-4">{children}</div>
        </Card>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
        <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-[11px] text-warn">
          <FlaskConical size={12} className="mt-0.5 shrink-0" />
          <span>Demo sign-in: any non-empty credentials are accepted and nothing is verified or stored.</span>
        </p>
      </div>
    </div>
  );
}

export function Field({ label, id, error, children }: { label: string; id: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      {children}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
