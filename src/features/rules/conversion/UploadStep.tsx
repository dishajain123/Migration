import { CheckCircle2, Eye, FileCode2, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { ConfirmDialog } from '@/components/Dialog';
import { Badge, Button, Card, CardHeader, DataTable, Progress } from '@/components/ui';
import { checkSqlFileMeta, MAX_SQL_BYTES } from '@/domain/ruleConversion/intake';
import { cn } from '@/lib/cn';
import { services } from '@/services';
import { readSqlFile } from '@/services/fileRead';
import { useConversionStore } from '@/stores/conversionStore';
import type { SqlFileAnalysis } from '@/types';
import { SqlPreviewDialog } from './parts';

type Phase = 'reading' | 'analysing' | 'done' | 'error';

export function UploadStep({ onNext }: { onNext: () => void }) {
  const files = useConversionStore((s) => s.files);
  const addFiles = useConversionStore((s) => s.addFiles);
  const removeFile = useConversionStore((s) => s.removeFile);
  const clearFiles = useConversionStore((s) => s.clearFiles);
  const [queue, setQueue] = useState<Record<string, Phase>>({});
  const [drag, setDrag] = useState(false);
  const [busySamples, setBusySamples] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<SqlFileAnalysis | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const inFlight = Object.values(queue).filter((p) => p === 'reading' || p === 'analysing').length;
  const totalQueued = Object.keys(queue).length;
  const doneQueued = totalQueued - inFlight;

  const handle = async (list: File[]) => {
    if (list.length === 0) return;
    setMessage(null);
    const rejected: SqlFileAnalysis[] = [];
    const accepted: File[] = [];
    for (const f of list) {
      const err = checkSqlFileMeta(f.name, f.size);
      if (err) rejected.push({ fileName: f.name, size: f.size, procedure: null, warnings: [], error: err });
      else accepted.push(f);
    }
    if (rejected.length) addFiles(rejected);
    setQueue((q) => ({ ...q, ...Object.fromEntries(accepted.map((f) => [f.name, 'reading' as Phase])) }));
    let ok = 0;
    await Promise.all(accepted.map(async (f) => {
      try {
        const uploaded = await readSqlFile(f);
        setQueue((q) => ({ ...q, [f.name]: 'analysing' }));
        const res = await services.ruleConversion.analyzeFiles([uploaded]);
        if (res.error || !res.data) throw new Error(res.error?.message ?? 'No result');
        addFiles(res.data);
        const failed = res.data.some((d) => d.error);
        if (!failed) ok++;
        setQueue((q) => ({ ...q, [f.name]: failed ? 'error' : 'done' }));
      } catch (e) {
        addFiles([{ fileName: f.name, size: f.size, procedure: null, warnings: [], error: e instanceof Error ? e.message : String(e) }]);
        setQueue((q) => ({ ...q, [f.name]: 'error' }));
      }
    }));
    setMessage({
      ok: rejected.length === 0 && ok === accepted.length,
      text: `${ok} of ${list.length} file(s) analysed${rejected.length ? `; ${rejected.length} rejected (see the list)` : ''}.`,
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    void handle(Array.from(e.dataTransfer.files));
  };

  const loadSamples = async () => {
    setBusySamples(true);
    setMessage(null);
    const res = await services.ruleConversion.loadSamples();
    setBusySamples(false);
    if (res.error || !res.data) { setMessage({ ok: false, text: res.error?.message ?? 'Could not load the sample procedures.' }); return; }
    addFiles(res.data);
    setMessage({ ok: true, text: `${res.data.length} sample procedure(s) loaded from public/data/latest dd output.` });
  };

  const procedures = files.filter((f) => f.procedure).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="1. Add CrisMac SQL procedures" subtitle="Each .sql file should contain one stored procedure. Nothing leaves your browser in this demo." />
        <div className="space-y-3 p-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cn('flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors', drag ? 'border-primary bg-primarybg' : 'border-border')}
          >
            <UploadCloud size={28} className={drag ? 'text-primary' : 'text-muted'} />
            <div className="text-sm font-medium">Drag and drop .sql files here</div>
            <div className="text-xs text-muted">or</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => input.current?.click()}><FileCode2 size={14} /> Browse files</Button>
              <Button variant="outline" onClick={() => void loadSamples()} disabled={busySamples} title="Load the 14 CrisMac procedures that ship with the workbook">
                {busySamples ? <Loader2 size={14} className="animate-spin" /> : null} Use the 14 sample procedures
              </Button>
            </div>
            <div className="text-[11px] text-muted">.sql only · up to {MAX_SQL_BYTES / 1024 / 1024} MB each · UTF-8 or UTF-16 (as SQL Server saves them)</div>
            <input
              ref={input} type="file" accept=".sql" multiple className="hidden" aria-label="Choose SQL files"
              onChange={(e) => { void handle(Array.from(e.target.files ?? [])); e.target.value = ''; }}
            />
          </div>
          {totalQueued > 0 && inFlight > 0 && (
            <div className="space-y-1" aria-live="polite">
              <div className="flex justify-between text-xs text-muted"><span>Reading and analysing...</span><span>{doneQueued} / {totalQueued}</span></div>
              <Progress value={(doneQueued / totalQueued) * 100} />
            </div>
          )}
          {message && (
            <div role="status" className={cn('anim-fade flex items-center gap-2 rounded-md px-3 py-2 text-sm', message.ok ? 'bg-okbg text-ok' : 'bg-warnbg text-warn')}>
              {message.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{message.text}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Files (${files.length})`}
          subtitle={`${procedures} procedure(s) ready for analysis`}
          right={files.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}><Trash2 size={13} /> Remove all</Button> : undefined}
        />
        {files.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No files yet. Add your CrisMac procedures above, or start with the 14 samples to see the whole pipeline.
          </div>
        ) : (
          <DataTable<SqlFileAnalysis>
            rows={files} rowKey={(f) => f.fileName} pageSize={15}
            columns={[
              { key: 'f', header: 'File', render: (f) => <span className="font-mono text-xs">{f.fileName}</span> },
              { key: 'p', header: 'Procedure', render: (f) => f.procedure ? <span className="font-mono text-xs">{f.procedure.name}{f.procedure.stage && <span className="ml-1 text-muted">({f.procedure.stage})</span>}</span> : <span className="text-xs text-muted">-</span> },
              { key: 's', header: 'Size', render: (f) => <span className="text-xs tabular-nums text-muted">{f.procedure ? `${f.procedure.lineCount.toLocaleString()} lines` : `${Math.ceil(f.size / 1024)} KB`}</span> },
              { key: 'n', header: 'Statements', render: (f) => <span className="text-xs tabular-nums">{f.procedure?.steps.filter((s) => !s.housekeeping).length ?? '-'}</span> },
              { key: 'st', header: 'Status', render: (f) => <FileStatus file={f} phase={queue[f.fileName]} /> },
              { key: 'a', header: '', render: (f) => (
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Preview ${f.fileName}`} title="Preview SQL" disabled={!f.content} onClick={() => setPreview(f)}><Eye size={14} /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${f.fileName}`} title="Remove" onClick={() => removeFile(f.fileName)}><Trash2 size={14} /></Button>
                </div>
              ) },
            ]}
          />
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={procedures === 0}>Next: review the analysis</Button>
      </div>

      <SqlPreviewDialog open={!!preview} onClose={() => setPreview(null)} fileName={preview?.fileName ?? ''} content={preview?.content ?? ''} />
      <ConfirmDialog
        open={confirmClear} onCancel={() => setConfirmClear(false)} onConfirm={() => { clearFiles(); setQueue({}); }}
        title="Remove all files?" confirmLabel="Remove all" tone="danger"
        body="The analysed procedures are removed from this session. Your review decisions and edits are kept and reappear if you add the same files again."
      />
    </div>
  );
}

function FileStatus({ file, phase }: { file: SqlFileAnalysis; phase?: Phase }) {
  if (phase === 'reading' || phase === 'analysing') {
    return <span className="inline-flex items-center gap-1 text-xs text-muted"><Loader2 size={12} className="animate-spin" />{phase === 'reading' ? 'Reading' : 'Analysing'}</span>;
  }
  if (file.error) return <span title={file.error}><Badge tone="bad">Rejected: {file.error.length > 50 ? `${file.error.slice(0, 50)}...` : file.error}</Badge></span>;
  if (file.warnings.length) return <span title={file.warnings.join('\n')}><Badge tone="warn">Analysed · {file.warnings.length} warning(s)</Badge></span>;
  return <Badge tone="ok">Analysed</Badge>;
}
