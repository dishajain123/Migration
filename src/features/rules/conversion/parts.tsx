import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { Badge, SimulatedBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ConversionIssue, ConversionStatus, ConvertedRule, MappingStatus, RuleDecision } from '@/types';

export const STATUS_LABEL: Record<ConversionStatus, string> = { converted: 'Converted', 'needs-review': 'Needs review', failed: 'Failed' };
const STATUS_TONE: Record<ConversionStatus, 'ok' | 'warn' | 'bad'> = { converted: 'ok', 'needs-review': 'warn', failed: 'bad' };
const STATUS_HINT: Record<ConversionStatus, string> = {
  converted: 'Every column mapped through an approved or documented mapping and no open issues. Still needs your approval.',
  'needs-review': 'Converted, but something needs a human: an unconfirmed mapping, a parameter, or SQL without a documented TRAQ form.',
  failed: 'No TRAQ column to write to: the CrisMac column has no mapping in Agent 4 or the workbook.',
};

export function ConversionBadge({ status }: { status: ConversionStatus }) {
  return <span title={STATUS_HINT[status]}><Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge></span>;
}

export function DecisionBadge({ decision }: { decision: RuleDecision | 'pending' }) {
  return <Badge tone={decision === 'approved' ? 'ok' : decision === 'rejected' ? 'bad' : 'neutral'}>{decision === 'pending' ? 'Pending review' : decision === 'approved' ? 'Approved' : 'Rejected'}</Badge>;
}

const MAP_LABEL: Record<MappingStatus, string> = { approved: 'Approved in Agent 4', documented: 'Documented (workbook)', 'name-match': 'Name match only', ambiguous: 'Ambiguous', missing: 'Not mapped', suggested: 'Simulated suggestion' };
const MAP_TONE: Record<MappingStatus, 'ok' | 'info' | 'warn' | 'bad'> = { approved: 'ok', documented: 'info', 'name-match': 'warn', ambiguous: 'warn', missing: 'bad', suggested: 'info' };

export function MappingBadge({ status, note }: { status: MappingStatus; note?: string }) {
  return <span title={note}><Badge tone={MAP_TONE[status]}>{MAP_LABEL[status]}</Badge></span>;
}

export function ConfidencePill({ rule }: { rule: ConvertedRule }) {
  const v = rule.confidence.value;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Heuristic score, not a model output:\n${rule.confidence.basis.join('\n')}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded bg-surface2" aria-hidden="true">
        <span className={cn('block h-full rounded', v >= 80 ? 'bg-ok' : v >= 50 ? 'bg-warn' : 'bg-bad')} style={{ width: `${v}%` }} />
      </span>
      <span className="text-xs tabular-nums">{v}%</span>
    </span>
  );
}

export function ConfidenceBlock({ rule }: { rule: ConvertedRule }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2"><ConfidencePill rule={rule} /><SimulatedBadge label="Simulated confidence" /></div>
      <ul className="list-disc pl-4 text-[11px] text-muted">{rule.confidence.basis.map((b) => <li key={b}>{b}</li>)}</ul>
    </div>
  );
}

const ICON = { error: AlertCircle, warning: AlertTriangle, info: Info } as const;
const TONE = { error: 'text-bad', warning: 'text-warn', info: 'text-info' } as const;

export function IssueList({ issues, empty = 'No issues.' }: { issues: ConversionIssue[]; empty?: string }) {
  const sorted = useMemo(() => {
    const rank = { error: 0, warning: 1, info: 2 };
    return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [issues]);
  if (sorted.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {sorted.map((i, n) => {
        const Icon = ICON[i.severity];
        return (
          <li key={`${i.code}-${n}`} className="flex gap-2 text-xs">
            <Icon size={14} className={cn('mt-0.5 shrink-0', TONE[i.severity])} aria-label={i.severity} />
            <span>{i.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Line-numbered, read-only view of a SQL file; scrolls to and highlights a line range when given. */
export function SqlPreviewDialog({ open, onClose, fileName, content, highlight }: {
  open: boolean; onClose: () => void; fileName: string; content: string; highlight?: [number, number];
}) {
  const lines = useMemo(() => content.split(/\r?\n/), [content]);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && highlight) window.setTimeout(() => first.current?.scrollIntoView({ block: 'center' }), 50);
  }, [open, highlight]);
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={<span className="font-mono">{fileName}</span>}
      description={`${lines.length.toLocaleString()} lines · original CrisMac SQL, shown as written${highlight ? ` · lines ${highlight[0]}-${highlight[1]} highlighted` : ''}`}>
      <div className="overflow-x-auto bg-surface2/40 py-2 font-mono text-[11.5px] leading-5">
        {lines.map((l, i) => {
          const n = i + 1;
          const on = !!highlight && n >= highlight[0] && n <= highlight[1];
          return (
            <div key={n} ref={on && n === highlight?.[0] ? first : undefined} className={cn('flex whitespace-pre', on && 'bg-warnbg')}>
              <span className="w-14 shrink-0 select-none pr-3 text-right text-muted">{n}</span>
              <span className="pr-4">{l || ' '}</span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted" title={hint}>{title}</h3>
      {children}
    </section>
  );
}
