import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { AsyncState } from '@/hooks/useAsync';
import type { ApiMeta } from '@/types';

// ---- shadcn-style primitives (hand-authored; replaceable with `npx shadcn add`) ----
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primaryfg hover:opacity-90',
        outline: 'border border-border bg-surface hover:bg-surface2',
        ghost: 'hover:bg-surface2',
        danger: 'bg-bad text-white hover:opacity-90',
        success: 'bg-ok text-bg hover:opacity-90',
      },
      size: { sm: 'h-8 px-3', md: 'h-9 px-4', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...p} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border border-border bg-surface', className)}>{children}</div>;
}
export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

const badgeTone = {
  neutral: 'bg-surface2 text-muted', ok: 'bg-okbg text-ok', warn: 'bg-warnbg text-warn', bad: 'bg-badbg text-bad',
  info: 'bg-infobg text-info', primary: 'bg-primarybg text-primary',
} as const;
export type Tone = keyof typeof badgeTone;
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', badgeTone[tone], className)}>{children}</span>;
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-primary', className)} {...p} />;
}
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-primary', className)} {...p}>
      {children}
    </select>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', value === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'ok' | 'warn' | 'bad' }) {
  const bg = { primary: 'bg-primary', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-surface2">
      <div className={cn('h-full rounded', bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, tag }: { label: string; value: ReactNode; hint?: ReactNode; tag?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{tag}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

// ---- labelling ----
export function SimulatedBadge({ label = 'Simulated' }: { label?: string }) {
  return (
    <span title="Simulated output - not produced by an AI model" className="inline-flex items-center gap-1 rounded bg-warnbg px-1.5 py-0.5 text-[11px] font-medium text-warn">
      <FlaskConical size={11} /> {label}
    </span>
  );
}
export function OriginBadge({ meta }: { meta: ApiMeta | null }) {
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" title={meta.note}>
      {meta.simulated ? <SimulatedBadge /> : <Badge tone="ok">Workbook-derived</Badge>}
      {meta.note && <span className="hidden max-w-[28rem] truncate md:inline">{meta.note}</span>}
    </span>
  );
}

// ---- async states ----
export function AsyncView<T>({ state, isEmpty, emptyMessage = 'Nothing to show.', children }: {
  state: AsyncState<T>; isEmpty?: (d: T) => boolean; emptyMessage?: string; children: (d: T) => ReactNode;
}) {
  if (state.status === 'loading' && state.data === null) {
    return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><Loader2 className="animate-spin" size={16} /> Loading...</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="m-4 rounded-md border border-bad bg-badbg p-4 text-sm text-bad">
        <div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> Something went wrong</div>
        <p className="mt-1 whitespace-pre-wrap">{state.error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={state.reload}><RefreshCw size={13} /> Retry</Button>
      </div>
    );
  }
  if (state.data === null) return null;
  if (isEmpty?.(state.data)) {
    return <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted"><Inbox size={20} />{emptyMessage}</div>;
  }
  return <>{children(state.data)}</>;
}

// ---- table ----
export interface Column<T> { key: string; header: ReactNode; render: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ rows, columns, pageSize = 25, onRowClick, rowKey, selectedKey, empty = 'No rows.' }: {
  rows: T[]; columns: Column<T>[]; pageSize?: number; onRowClick?: (r: T) => void; rowKey: (r: T) => string; selectedKey?: string; empty?: string;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { if (page > pages - 1) setPage(0); }, [rows.length, pages, page]);
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface2 text-xs text-muted">
            <tr>{columns.map((c) => <th key={c.key} className={cn('px-3 py-2 font-medium', c.className)}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {slice.length === 0 && <tr><td colSpan={columns.length} className="p-6 text-center text-muted">{empty}</td></tr>}
            {slice.map((r) => {
              const k = rowKey(r);
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn('border-t border-border align-top', onRowClick && 'cursor-pointer hover:bg-surface2', selectedKey === k && 'bg-primarybg')}
                >
                  {columns.map((c) => <td key={c.key} className={cn('px-3 py-2', c.className)}>{c.render(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
          <span>{rows.length.toLocaleString()} rows</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></Button>
            <span>Page {page + 1} / {pages}</span>
            <Button variant="outline" size="icon" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, description, right }: { title: string; description: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
      </div>
      {right}
    </div>
  );
}
