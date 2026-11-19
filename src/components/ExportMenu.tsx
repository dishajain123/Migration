import { Check, Download, FileSpreadsheet, FileText, FileType2, Braces, ChevronDown, AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { EXPORT_FORMATS, type ExportDoc, type ExportFormat } from '@/domain/exporters';
import { downloadDoc } from '@/lib/download';

const ICON: Record<ExportFormat, typeof Download> = { xlsx: FileSpreadsheet, csv: FileText, pdf: FileType2, json: Braces };

/**
 * Reusable export dropdown. The screen supplies `getDoc` (built lazily on click, so it always reflects the current
 * view) and a file name; encoding lives in domain/exporters.
 */
export function ExportMenu({ getDoc, baseName, disabled, align = 'right' }: {
  getDoc: () => ExportDoc | null; baseName: string; disabled?: boolean; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    if (!status) return;
    const id = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(id);
  }, [status]);

  const run = (format: ExportFormat) => {
    setOpen(false);
    try {
      const doc = getDoc();
      if (!doc) { setStatus({ ok: false, text: 'Nothing to export yet.' }); return; }
      const out = downloadDoc(format, doc, baseName);
      setStatus({ ok: true, text: `Downloaded ${out.filename} (${out.rows} rows)` });
    } catch (e) {
      setStatus({ ok: false, text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Download the current view as Excel, CSV, PDF or JSON">
        <Download size={13} /> Export <ChevronDown size={12} />
      </Button>
      {open && (
        <div role="menu" className={`anim-pop absolute top-full z-50 mt-1 w-72 rounded-lg border border-border bg-surface p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {EXPORT_FORMATS.map((f) => {
            const Icon = ICON[f.id];
            return (
              <button key={f.id} role="menuitem" type="button" onClick={() => run(f.id)} className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface2 focus-visible:bg-surface2 focus-visible:outline-none">
                <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
                <span><span className="block text-sm font-medium">{f.label} <span className="font-normal text-muted">.{f.ext}</span></span><span className="block text-[11px] text-muted">{f.hint}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <span role="status" aria-live="polite" className="sr-only">{status?.text}</span>
      {status && (
        <span className={`anim-fade absolute left-0 top-full z-40 mt-1 flex max-w-xs items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow ${status.ok ? 'border-ok bg-okbg text-ok' : 'border-bad bg-badbg text-bad'} ${open ? 'hidden' : ''}`} aria-hidden="true">
          {status.ok ? <Check size={12} /> : <AlertTriangle size={12} />}{status.text}
        </span>
      )}
    </div>
  );
}
