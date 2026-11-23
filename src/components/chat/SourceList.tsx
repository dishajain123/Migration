import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SourceRef } from '@/types';

const chip = 'inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface2 px-1.5 py-0.5 text-[11px] text-muted';

function describe(s: SourceRef): string {
  const where = [s.sheet, s.rowNo !== undefined ? `row ${s.rowNo}` : ''].filter(Boolean).join(', ');
  return where ? `${s.label} (${where})` : s.label;
}

export function SourceList({ sources, onNavigate }: { sources: SourceRef[]; onNavigate?: () => void }) {
  if (!sources.length) return null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1 text-[11px] font-medium text-muted">Sources</div>
      <ul className="flex flex-wrap gap-1">
        {sources.map((s, i) => (
          <li key={`${s.kind}-${s.label}-${s.sheet ?? ''}-${s.rowNo ?? ''}-${i}`} className="max-w-full">
            {s.route ? (
              <Link to={s.route} onClick={onNavigate} className={`${chip} hover:bg-primarybg hover:text-primary`} title={`Open ${s.route}`}>
                <FileText size={10} className="shrink-0" /> <span className="truncate">{describe(s)}</span>
              </Link>
            ) : (
              <span className={chip}><FileText size={10} className="shrink-0" /> <span className="truncate">{describe(s)}</span></span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
