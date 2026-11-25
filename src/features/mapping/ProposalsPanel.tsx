import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, DataTable, Progress } from '@/components/ui';
import { services } from '@/services';
import { useEnrichment } from '@/stores/enrichmentStore';
import { withRateLimitRecovery } from '@/stores/rateLimitStore';
import { useReviewStore } from '@/stores/reviewStore';
import type { ApiMeta } from '@/types';
import type { JobItemState, MappingJobStatus } from '@/types/jobs';
import type { AiMappingProposal, MappingProposalSet } from '@/types/mappingAi';

const pairId = (p: AiMappingProposal, s: { table: string; column: string }) => `ai:${p.targetTable}.${p.targetColumn}<-${s.table}.${s.column}`;
const CONFIG_CODES = new Set(['NOT_CONFIGURED', 'MISSING_KEY', 'INVALID_KEY', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'INCOMPATIBLE']);

/** Validated AI proposals with approve / reject. Nothing is applied until a human clicks; every decision is stored by the backend. */
export function ProposalTable({ set }: { set: MappingProposalSet }) {
  const decisions = useReviewStore((s) => s.mappingDecisions);
  const review = useReviewStore((s) => s.reviewMapping);
  const clear = useReviewStore((s) => s.clearMappingDecision);
  const status = (p: AiMappingProposal): 'approved' | 'rejected' | 'pending' => {
    const d = p.sources.map((s) => decisions[pairId(p, s)]?.decision);
    return d.every((x) => x === 'approved') ? 'approved' : d.some((x) => x === 'rejected') ? 'rejected' : 'pending';
  };
  const decide = async (p: AiMappingProposal, decision: 'approved' | 'rejected') => {
    for (const s of p.sources) {
      await review(pairId(p, s), decision, '', {
        id: pairId(p, s), targetTable: p.targetTable, targetColumn: p.targetColumn, targetType: p.targetType, sourceTable: s.table, sourceColumn: s.column, sourceType: s.type ?? '',
      }, { origin: 'ai', confidence: p.confidence ?? undefined, transformation: p.transformation?.text });
    }
  };
  const undo = (p: AiMappingProposal) => p.sources.forEach((s) => clear(pairId(p, s)));

  return (
    <div className="space-y-2">
      {set.proposals.length === 0
        ? <p className="text-muted">The model made no proposal that passed validation for {set.table}.</p>
        : <DataTable<AiMappingProposal> rows={set.proposals} rowKey={(p) => p.id} pageSize={10}
          columns={[
            { key: 't', header: 'Target', render: (p) => <div className="font-mono text-xs">{p.targetColumn}<div className="text-muted">{p.targetType || '-'}</div></div> },
            { key: 's', header: 'Proposed source(s)', render: (p) => <div className="font-mono text-xs">{p.sources.map((s) => <div key={`${s.table}.${s.column}`}>{s.table}.{s.column} <span className="text-muted">{s.type ?? ''}</span></div>)}</div> },
            { key: 'c', header: 'AI estimate', className: 'w-28', render: (p) => (p.confidence === null ? <span className="text-xs text-muted">-</span> : <div><div className="mb-1 text-xs tabular-nums">{p.confidence}%</div><Progress value={p.confidence} tone={p.confidence >= 75 ? 'ok' : p.confidence >= 50 ? 'warn' : 'bad'} /></div>) },
            { key: 'f', header: 'Why / checks', render: (p) => (
              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap gap-1"><Badge tone="info">AI_DRAFT</Badge>{p.origin === 'ai-discovered' && <Badge tone="warn">beyond heuristics</Badge>}{p.validation === 'valid_with_warnings' && <Badge tone="warn">{p.warnings.length} warning(s)</Badge>}</div>
                <div>{p.reason}</div>
                {p.transformation && <div className="rounded border border-border p-1"><b>Transformation (AI_DRAFT):</b> <span className="font-mono">{p.transformation.text}</span><ul className="mt-1 list-disc pl-4 text-muted">{p.transformation.checks.map((c) => <li key={c}>{c}</li>)}</ul></div>}
                {p.warnings.map((w) => <div key={w} className="text-warn">{w}</div>)}
              </div>) },
            { key: 'st', header: 'Status', render: (p) => <Badge tone={status(p) === 'approved' ? 'ok' : status(p) === 'rejected' ? 'bad' : 'neutral'}>{status(p)}</Badge> },
            { key: 'a', header: '', render: (p) => (
              <div className="flex gap-1">
                <Button size="icon" variant="success" aria-label="Approve proposal" title="Approve" onClick={() => void decide(p, 'approved')}><Check size={14} /></Button>
                <Button size="icon" variant="danger" aria-label="Reject proposal" title="Reject" onClick={() => void decide(p, 'rejected')}><X size={14} /></Button>
                {status(p) !== 'pending' && <Button size="sm" variant="outline" onClick={() => undo(p)}>Undo</Button>}
              </div>) },
          ]} />}
      {set.discarded.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{set.discarded.length} item(s) discarded by the validators (invalid column, type clash or unparseable transformation)</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{set.discarded.slice(0, 30).map((d, i) => <li key={i}><span className="font-mono">{d.targetColumn}{d.source ? ` <- ${d.source}` : ''}</span>: {d.reason}</li>)}</ul>
        </details>
      )}
      {set.unresolved.length > 0 && (
        <details className="text-xs"><summary className="cursor-pointer text-muted">{set.unresolved.length} column(s) the model could not map</summary>
          <ul className="mt-1 list-disc pl-5">{set.unresolved.map((u) => <li key={u.targetColumn}><span className="font-mono">{u.targetColumn}</span>: {u.reason}</li>)}</ul></details>
      )}
    </div>
  );
}

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; code: string; message: string } | { status: 'success'; set: MappingProposalSet; meta: ApiMeta };

/** AI proposals for one target table: the model sees the full candidate schema; the validators check the result. */
export function ProposalsPanel({ table }: { table: string }) {
  const enrich = useEnrichment(table);
  const [state, setState] = useState<State>({ status: 'idle' });
  useEffect(() => { setState({ status: 'idle' }); }, [table]);
  const go = async () => {
    setState({ status: 'loading' });
    const r = await withRateLimitRecovery((o) => services.ai.proposeMappings(table, o, enrich));
    setState(r.data ? { status: 'success', set: r.data, meta: r.meta } : { status: 'error', code: r.error?.code ?? 'ERROR', message: r.error?.message ?? 'The AI request failed.' });
  };
  return (
    <>
      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-primary" /> AI mapping proposals</span>}
          subtitle="The model sees the full candidate source schema and may find matches the heuristics missed. Every proposal is validated against the schema; none is applied until you approve it."
          right={<div className="flex items-center gap-2">
            {state.status === 'success' && state.meta.provider && <Badge tone="primary">AI · {state.meta.provider} · {state.meta.model}</Badge>}
            <Button size="sm" variant={state.status === 'success' ? 'outline' : 'default'} onClick={() => void go()} disabled={state.status === 'loading'}>
              {state.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {state.status === 'loading' ? 'Working...' : state.status === 'success' ? 'Regenerate' : 'Propose mappings with AI'}
            </Button>
          </div>}
        />
        <div aria-live="polite" className="p-3 text-sm">
          {state.status === 'idle' && <p className="text-muted">Nothing is sent until you click. {enrich?.profile ? 'Your loaded profile (descriptions and statistics) is included.' : 'Workbook data only.'}</p>}
          {state.status === 'loading' && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Waiting for the model, then validating its answer...</p>}
          {state.status === 'error' && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-bad bg-badbg p-2 text-bad">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>{state.message}{CONFIG_CODES.has(state.code) && <> <Link to="/ai-settings" className="font-medium underline">Open AI Settings</Link></>}</div>
            </div>
          )}
          {state.status === 'success' && <><ProposalTable set={state.set} /><p className="mt-2 text-[11px] text-muted">{state.meta.note} Latency {state.meta.latencyMs} ms.</p></></>}
        </div>
      </Card>
      <BulkRun />
    </>
  );
}

const TONE: Record<JobItemState, 'ok' | 'bad' | 'warn' | 'neutral' | 'info'> = { queued: 'neutral', running: 'info', succeeded: 'ok', failed: 'bad', cancelled: 'warn' };
const MAX_TABLES = 50;

/** Bulk AI run over many target tables as an async gateway job: start, watch progress, open results, cancel or retry failures. */
function BulkRun() {
  const enrich = useEnrichment('');
  const [targets, setTargets] = useState<string[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<MappingJobStatus | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ table: string; set: MappingProposalSet } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let live = true;
    void services.mapping.listTargets().then((r) => { if (live && r.data) setTargets(r.data.filter((t) => t.suggestions > 0 || t.unfed > 0).map((t) => t.table).slice(0, MAX_TABLES)); });
    return () => { live = false; };
  }, []);

  const finished = job && ['succeeded', 'partial', 'failed', 'cancelled'].includes(job.state);
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!jobId || finished) return undefined;
    const poll = async () => {
      const r = await services.jobs.status(jobId);
      if (r.data) { setJob(r.data); setError(''); } else setError(r.error?.message ?? 'Could not read the job status.');
    };
    void poll();
    timer.current = setInterval(() => void poll(), 2000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobId, finished]);

  const start = async (tables: string[]) => {
    setBusy(true); setError(''); setOpen(null);
    const r = await services.jobs.start(tables, undefined, enrich);
    setBusy(false);
    if (r.data) { setJob(null); setJobId(r.data.jobId); } else setError(r.error?.message ?? 'The job could not be started.');
  };
  const cancel = async () => { if (jobId) { const r = await services.jobs.cancel(jobId); if (r.data) setJob(r.data); else setError(r.error?.message ?? 'Could not cancel.'); } };
  const view = async (table: string) => {
    if (!jobId) return;
    const r = await services.jobs.result(jobId, table);
    if (r.data) setOpen({ table, set: r.data }); else setError(r.error?.message ?? 'Could not open the result.');
  };
  const failedTables = job?.items.filter((i) => i.state === 'failed' || i.state === 'cancelled').map((i) => i.table) ?? [];

  return (
    <Card>
      <CardHeader title="Bulk AI run (background job)" subtitle={`Runs the proposal step for up to ${MAX_TABLES} target tables on the gateway while you keep working. Uses your active model.`}
        right={<div className="flex gap-2">
          {job && !finished && <Button size="sm" variant="outline" onClick={() => void cancel()}>Cancel job</Button>}
          {finished && failedTables.length > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => void start(failedTables)}>Retry {failedTables.length} unfinished</Button>}
          <Button size="sm" disabled={busy || !targets?.length || (!!job && !finished)} onClick={() => void start(targets ?? [])}>{busy ? 'Starting…' : `Run on ${targets?.length ?? 0} table(s)`}</Button>
        </div>} />
      <div aria-live="polite" className="space-y-2 p-3 text-xs">
        {!job && !error && <p className="text-muted">Not started. Results are validated per table when they arrive; nothing is applied without your approval.</p>}
        {error && <p role="alert" className="rounded-md border border-bad bg-badbg p-2 text-bad">{error}</p>}
        {job && (
          <>
            <div className="flex items-center gap-3"><Badge tone={job.state === 'succeeded' ? 'ok' : job.state === 'failed' ? 'bad' : job.state === 'partial' || job.state === 'cancelled' ? 'warn' : 'info'}>{job.state}</Badge><span>{job.done} of {job.total} table(s) finished{job.failed ? `, ${job.failed} failed` : ''}</span><div className="w-40"><Progress value={job.total ? Math.round((job.done / job.total) * 100) : 0} /></div></div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {job.items.map((i) => (
                <li key={i.table} className="flex flex-wrap items-center gap-2 px-2 py-1">
                  <span className="font-mono">{i.table}</span><Badge tone={TONE[i.state]}>{i.state}</Badge>
                  {i.state === 'succeeded' && <span className="text-muted">{i.proposalCount ?? 0} proposal(s), {i.discardedCount ?? 0} discarded</span>}
                  {i.error && <span className="text-bad">{i.error.message}</span>}
                  {i.state === 'succeeded' && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void view(i.table)}>View</Button>}
                </li>
              ))}
            </ul>
          </>
        )}
        {open && <div className="space-y-1 border-t border-border pt-2"><div className="flex items-center justify-between"><b>{open.table}</b><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button></div><ProposalTable set={open.set} /></div>}
      </div>
    </Card>
  );
}
