import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, DataTable } from '@/components/ui';
import { summarizeProcedure } from '@/domain/ruleConversion/views';
import { useConversionStore } from '@/stores/conversionStore';
import type { ProcDependency, SqlFileAnalysis, SqlStep } from '@/types';
import { SqlPreviewDialog } from './parts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function AnalysisStep({ dependencies, onNext }: { dependencies: ProcDependency[]; onNext: () => void }) {
  const files = useConversionStore((s) => s.files);
  const analysed = useMemo(() => files.filter((f) => f.procedure).sort((a, b) => (a.procedure?.order ?? 0) - (b.procedure?.order ?? 0)), [files]);
  const [open, setOpen] = useState<string>(analysed[0]?.fileName ?? '');
  const [preview, setPreview] = useState<{ file: SqlFileAnalysis; lines?: [number, number] } | null>(null);
  const totals = useMemo(() => analysed.reduce((acc, f) => {
    const s = summarizeProcedure(f.procedure!);
    acc.statements += Object.values(s.statements).reduce((a, b) => a + b, 0);
    acc.joins += s.joins; acc.cases += s.cases; acc.wheres += s.wheres;
    return acc;
  }, { statements: 0, joins: 0, cases: 0, wheres: 0 }), [analysed]);

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm">
        <div className="font-semibold">2. What the parser found</div>
        <p className="mt-1 text-xs text-muted">
          Extracted by pattern matching (Agent 3's SQL parser), not by AI: {analysed.length} procedure(s), {totals.statements} data statements,
          {' '}{totals.joins} JOINs, {totals.wheres} WHERE clauses and {totals.cases} CASE expressions. Dynamic SQL and cursors are listed as warnings, not analysed.
        </p>
      </Card>

      {dependencies.length > 0 && (
        <Card>
          <CardHeader title="Dependencies between procedures" subtitle="A procedure that writes a table another one reads must run first. In TRAQ this becomes rule order (PRIORITY)." />
          <ul className="grid gap-1 p-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
            {dependencies.slice(0, 60).map((d) => (
              <li key={`${d.from}-${d.to}-${d.via}`} className="rounded border border-border px-2 py-1">
                <span className="font-mono">{d.from}</span> <span className="text-muted">{d.kind === 'call' ? 'calls' : `writes ${d.via}, read by`}</span> <span className="font-mono">{d.to}</span>
              </li>
            ))}
          </ul>
          {dependencies.length > 60 && <p className="px-3 pb-3 text-xs text-muted">and {dependencies.length - 60} more (all are in the conversion report).</p>}
        </Card>
      )}

      <div className="space-y-2">
        {analysed.map((f) => {
          const p = f.procedure!;
          const s = summarizeProcedure(p);
          const isOpen = open === f.fileName;
          return (
            <Card key={f.fileName}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? '' : f.fileName)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left">
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="font-mono text-sm font-semibold">{p.name}</span>
                {p.stage && <Badge>{p.stage}</Badge>}
                <span className="ml-auto flex flex-wrap gap-1">
                  {Object.entries(s.statements).map(([t, n]) => <Badge key={t} tone={t === 'UPDATE' || t === 'INSERT' || t === 'MERGE' ? 'primary' : 'neutral'}>{t} {n}</Badge>)}
                  <Badge tone="info">JOIN {s.joins}</Badge><Badge tone="info">CASE {s.cases}</Badge>
                  {f.warnings.length > 0 && <Badge tone="warn">{f.warnings.length} warning(s)</Badge>}
                </span>
              </button>
              {isOpen && (
                <div className="anim-fade space-y-3 border-t border-border p-4">
                  {p.descriptions.length > 0 && <p className="text-xs text-muted">{p.descriptions.join(' ')}</p>}
                  {f.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-warn">{f.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                  <dl className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                    <Facts label="Parameters" items={s.params} />
                    <Facts label="Reads tables" items={s.tablesRead} />
                    <Facts label="Writes tables" items={s.tablesWritten} />
                    <Facts label="Calls" items={s.calls} />
                  </dl>
                  <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setPreview({ file: f })}><Eye size={13} /> View full SQL</Button></div>
                  <DataTable<SqlStep>
                    rows={p.steps.filter((x) => !x.housekeeping && x.type !== 'TRUNCATE')} rowKey={(x) => x.id} pageSize={10}
                    columns={[
                      { key: 'i', header: '#', render: (x) => <span className="text-xs tabular-nums text-muted">{x.index}</span> },
                      { key: 't', header: 'Operation', render: (x) => <Badge tone={x.type === 'EXEC' ? 'neutral' : 'primary'}>{x.type}</Badge> },
                      { key: 'g', header: 'Target', render: (x) => <span className="font-mono text-xs">{x.type === 'EXEC' ? x.callee : x.table}{x.tableKind !== 'table' && x.type !== 'EXEC' && <span className="ml-1 text-muted">({x.tableKind})</span>}</span> },
                      { key: 'c', header: 'Columns set', render: (x) => <span className="text-xs" title={x.columns.map((c) => c.name).join(', ')}>{x.columns.length ? clip(x.columns.map((c) => c.name).join(', '), 60) : '-'}</span> },
                      { key: 'j', header: 'Joins', render: (x) => {
                        const full = (x.joins ?? []).map((j) => `${j.kind} ${j.table} ON ${j.on}`).join('\n');
                        return <span className={`text-xs${full ? ' cursor-help underline decoration-dotted underline-offset-2' : ''}`} title={full}>{(x.joins ?? []).map((j) => `${j.kind} ${j.table}`).join(', ') || '-'}</span>;
                      } },
                      { key: 'w', header: 'Conditions', render: (x) => {
                        const full = [x.guard && `IF: ${x.guard}`, x.where && `WHERE: ${x.where}`].filter(Boolean).join('\n');
                        return <span className={`text-xs text-muted${full ? ' cursor-help underline decoration-dotted underline-offset-2' : ''}`} title={full}>{clip([x.guard && `IF ${x.guard}`, x.where && `WHERE ${x.where}`].filter(Boolean).join(' · '), 80) || '-'}</span>;
                      } },
                      { key: 'l', header: 'Lines', render: (x) => <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPreview({ file: f, lines: [x.lineStart, x.lineEnd] })}>{x.lineStart}-{x.lineEnd}</button> },
                    ]}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end"><Button onClick={onNext}>Next: map to TRAQ</Button></div>
      <SqlPreviewDialog open={!!preview} onClose={() => setPreview(null)} fileName={preview?.file.fileName ?? ''} content={preview?.file.content ?? ''} highlight={preview?.lines} />
    </div>
  );
}

function Facts({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="mb-1 font-medium text-muted">{label} ({items.length})</dt>
      <dd className="font-mono text-[11px] leading-relaxed">{items.length ? items.join(', ') : <span className="text-muted">none</span>}</dd>
    </div>
  );
}
