import { Check, Trash2, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/Dialog';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Progress, Select, SimulatedBadge, Tabs } from '@/components/ui';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { clearMappingDecisionAndRevalidate, removeMappingAndRevalidate } from '@/stores/approvalWorkflow';
import { useEnrichment } from '@/stores/enrichmentStore';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import { EnrichmentPanel } from './EnrichmentPanel';
import { ProposalsPanel } from './ProposalsPanel';
import type { ColumnAnalysis, MappingIssueSummary, MappingRow, ColumnMappingStatus, Suggestion } from '@/types';

type Tab = 'suggestions' | 'documented' | 'unfed' | 'manual';

export function MappingPage() {
  const targets = useAsync(() => services.mapping.listTargets(), []);
  const [params] = useSearchParams();
  const [table, setTable] = useState(params.get('table') ?? '');
  const [tab, setTab] = useState<Tab>('suggestions');
  const lastError = useReviewStore((s) => s.lastError);
  const syncNote = useReviewStore((s) => s.syncNote);
  return (
    <div>
      <PageHeader
        title="Agent 4 · Migration Mapping Engine"
        description="Review mappings, see unfed columns, and approve, reject or manually add mappings."
        right={<span className="flex items-center gap-2">
          <InfoTip title="About Agent 4" align="right">
            <span><b>Documented mappings:</b> source/target pairs stated in the workbook, used as-is.</span>
            <span><b>Suggestions:</b> a deterministic heuristic scores candidate columns by name-token overlap and type compatibility - never an AI guess, never auto-approved.</span>
            <span><b>Manual mapping:</b> your own confirmed pairing, stored here and reused by every agent.</span>
          </InfoTip>
          <OriginBadge meta={targets.meta} />
        </span>}
      />
      {lastError && <div className="mb-3 rounded-md border border-bad bg-badbg p-2 text-xs text-bad">{lastError}</div>}
      {syncNote && <div role="status" className="mb-3 rounded-md border border-border p-2 text-xs text-warn">{syncNote}</div>}
      <AutoSaved onOpen={setTable} />
      <Card className="mb-4">
        <CardHeader title="Target table" subtitle="Tables that have at least one column no mapping feeds" />
        <div className="p-3">
          <AsyncView state={targets} isEmpty={(d) => d.length === 0} emptyMessage="Every load-path column is fed by a documented mapping.">
            {(rows) => (
              <Select value={table} onChange={(e) => setTable(e.target.value)} className="w-full max-w-xl">
                <option value="">Select a target table...</option>
                {rows.map((t) => <option key={t.table} value={t.table}>{t.table} — {t.unfed} unfed of {t.columns} · {t.suggestions} suggestions</option>)}
              </Select>
            )}
          </AsyncView>
        </div>
      </Card>
      {!table ? <Card className="p-8 text-center text-sm text-muted">Select a target table to begin.</Card> : (
        <div className="space-y-3">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: 'suggestions', label: <span className="flex items-center gap-1.5">Suggestions <SimulatedBadge /></span> },
            { id: 'documented', label: 'Documented mappings' }, { id: 'unfed', label: 'Unmapped & ambiguous' }, { id: 'manual', label: 'Manual mapping' },
          ]} />
          {tab === 'suggestions' && <EnrichmentPanel table={table} />}
          {tab === 'suggestions' && <ProposalsPanel table={table} />}
          {tab === 'suggestions' && <Suggestions table={table} />}
          {tab === 'documented' && <Documented table={table} />}
          {tab === 'unfed' && <Unfed table={table} />}
          {tab === 'manual' && <Manual table={table} />}
        </div>
      )}
    </div>
  );
}

/** Mappings saved automatically when rules were approved in Agent 5 (no need to enter them here). */
function AutoSaved({ onOpen }: { onOpen: (table: string) => void }) {
  const all = useReviewStore((s) => s.manualMappings);
  const [note, setNote] = useState('');
  const mine = all.filter((m) => m.origin === 'rule-approval');
  if (mine.length === 0) return null;
  return (
    <Card className="mb-4">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
          Saved automatically from approved rules <Badge tone="ok">{mine.length}</Badge>
          <span className="text-xs font-normal text-muted">Created when you approved rules in Agent 5. Removing one sends the rules that rely on it back to review.</span>
        </summary>
        {note && <p role="status" className="px-4 pb-2 text-xs text-warn">{note}</p>}
        <ul className="divide-y divide-border border-t border-border">
          {mine.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2 px-4 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-mono">{m.sourceTable}.{m.sourceColumn} → {m.targetTable}.{m.targetColumn}</div>
                <div className="text-muted">{m.evidence}{m.ruleIds && m.ruleIds.length > 0 ? ` · ${m.ruleIds.length} rule(s): ${m.ruleIds.slice(0, 3).join(', ')}${m.ruleIds.length > 3 ? ', ...' : ''}` : ''}</div>
                <button type="button" className="text-primary hover:underline" onClick={() => onOpen(m.targetTable)}>Open {m.targetTable}</button>
              </div>
              <Button size="icon" variant="ghost" aria-label="Remove mapping" onClick={() => { const r = removeMappingAndRevalidate(m.id); setNote(r.revalidated.length ? `${r.revalidated.length} approved rule(s) relied on that mapping and are back in review.` : ''); }}><Trash2 size={14} /></Button>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function Suggestions({ table }: { table: string }) {
  const enrich = useEnrichment(table);
  const state = useAsync(() => services.mapping.getSuggestions(table, enrich), [table, enrich?.profile?.id, enrich?.embeddings?.id]);
  const decisions = useReviewStore((s) => s.mappingDecisions);
  const review = useReviewStore((s) => s.reviewMapping);
  const clear = clearMappingDecisionAndRevalidate;
  const [min, setMin] = useState(0);
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [confirmBulk, setConfirmBulk] = useState(false);
  return (
    <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No candidate source columns scored above the heuristic threshold for this table.">
      {(all) => {
        const stat = (s: Suggestion) => decisions[s.id]?.decision ?? 'pending';
        const rows = all.filter((s) => s.confidence >= min && (status === 'all' || stat(s) === status));
        const pendingCount = rows.filter((s) => stat(s) === 'pending').length;
        const mk = (s: Suggestion) => ({ id: s.id, targetTable: s.targetTable, targetColumn: s.targetColumn, targetType: s.targetType, sourceTable: s.sourceTable, sourceColumn: s.sourceColumn, sourceType: s.sourceType });
        const meta = (s: Suggestion) => ({ origin: 'heuristic' as const, provenance: s.provenance, confidence: s.confidence, transformation: s.transformation });
        const bulk = async () => { for (const s of rows) if (stat(s) === 'pending') await review(s.id, 'approved', `Bulk approve >= ${min}%`, mk(s), meta(s)); };
        return (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-sm">
              <label className="flex items-center gap-2">Min confidence <input type="range" min={0} max={95} step={5} value={min} onChange={(e) => setMin(Number(e.target.value))} /> <span className="w-10 tabular-nums">{min}%</span></label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </Select>
              <Button size="sm" variant="outline" onClick={() => setConfirmBulk(true)} disabled={min < 50 || pendingCount === 0}>Approve all pending shown{min < 50 ? ' (set min ≥ 50%)' : ''}</Button>
              <span className="ml-auto text-xs text-muted">{rows.length} of {all.length} shown</span>
            </div>
            <ConfirmDialog
              open={confirmBulk} onCancel={() => setConfirmBulk(false)} onConfirm={() => { setConfirmBulk(false); void bulk(); }}
              title={`Approve ${pendingCount} suggestion(s)?`} confirmLabel="Approve all" tone="default"
              body={`Every pending suggestion scoring ${min}% or higher in the current filter is approved as a mapping. This still a Simulated heuristic result - review it in Agent 4 or the Suggestions tab afterward if anything looks wrong.`}
            />
            <DataTable<Suggestion> rows={rows} rowKey={(s) => s.id} pageSize={15}
              columns={[
                { key: 'tgt', header: 'Target', render: (s) => <div className="font-mono text-xs">{s.targetColumn}<div className="text-muted">{s.targetType || '-'}</div></div> },
                { key: 'src', header: 'Suggested source', render: (s) => <div className="font-mono text-xs">{s.sourceTable}.{s.sourceColumn}<div className="text-muted">{s.sourceType || '-'}</div></div> },
                { key: 'c', header: 'Confidence', className: 'w-36', render: (s) => <div><div className="mb-1 text-xs tabular-nums">{s.confidence}%</div><Progress value={s.confidence} tone={s.confidence >= 75 ? 'ok' : s.confidence >= 50 ? 'warn' : 'bad'} /></div> },
                { key: 'i', header: 'Flags', render: (s) => <div className="space-y-1 text-xs">{s.provenance && s.provenance !== 'workbook' && <Badge tone="info">{s.provenance}</Badge>}{s.ambiguous && <Badge tone="warn">ambiguous</Badge>}{s.compat !== 'compatible' && s.compat !== 'unknown' && <Badge tone={s.compat === 'incompatible' ? 'bad' : 'warn'}>{s.compat}</Badge>}{s.issues.map((i) => <div key={i} className="text-muted">{i}</div>)}{s.transformation && <div className="rounded border border-border p-1"><b>Transformation:</b> {s.transformation}</div>}{s.reasons.filter((r) => r.startsWith('Semantic:') || r.startsWith('Context:')).map((r) => <div key={r} className="text-muted">{r}</div>)}</div> },
                { key: 'st', header: 'Status', render: (s) => <Badge tone={stat(s) === 'approved' ? 'ok' : stat(s) === 'rejected' ? 'bad' : 'neutral'}>{stat(s)}</Badge> },
                { key: 'a', header: '', render: (s) => (
                  <div className="flex gap-1">
                    <Button size="icon" variant="success" aria-label="Approve" title="Approve" onClick={() => review(s.id, 'approved', '', mk(s), meta(s))}><Check size={14} /></Button>
                    <Button size="icon" variant="danger" aria-label="Reject" title="Reject" onClick={() => review(s.id, 'rejected', '', mk(s), meta(s))}><X size={14} /></Button>
                    {decisions[s.id] && <Button size="icon" variant="outline" aria-label="Undo" title="Reset to pending" onClick={() => clear(s.id)}><Undo2 size={14} /></Button>}
                  </div>) },
              ]} />
          </Card>
        );
      }}
    </AsyncView>
  );
}

function Documented({ table }: { table: string }) {
  const state = useAsync(() => services.mapping.getDocumented(table), [table]);
  const issues = useAsync(() => services.mapping.getIssues(table), [table]);
  return (
    <div className="space-y-3">
      <AsyncView state={issues}>{(i: MappingIssueSummary) => (
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="p-3 text-xs"><div className="font-medium">Target collisions</div><div className="text-lg font-semibold">{i.collisions.length}</div></Card>
          <Card className="p-3 text-xs"><div className="font-medium">Awaiting confirmation</div><div className="text-lg font-semibold">{i.confirmationRequired.length}</div></Card>
          <Card className="p-3 text-xs"><div className="font-medium">Type warnings (direct mappings)</div><div className="text-lg font-semibold">{i.typeWarnings.length}</div></Card>
        </div>
      )}</AsyncView>
      <Card>
        <CardHeader title="Documented mappings" subtitle="From the workbook; workbook-derived" />
        <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No mapping rows target this table in the workbook.">
          {(rows) => (
            <DataTable<MappingRow> rows={rows} rowKey={(m) => m.id} pageSize={15}
              columns={[
                { key: 't', header: 'Target', render: (m) => <span className="font-mono text-xs">{m.targetColumn || '(none)'} <span className="text-muted">{m.targetType}</span></span> },
                { key: 's', header: 'Source', render: (m) => <span className="font-mono text-xs">{m.sourceTable || '(constant)'}{m.sourceColumn ? `.${m.sourceColumn}` : ''} <span className="text-muted">{m.sourceType}</span></span> },
                { key: 'm', header: 'Type', render: (m) => <Badge>{m.mapType || '—'}</Badge> },
                { key: 'r', header: 'Remark', render: (m) => <span className="text-xs text-muted" title={`${m.sheet} row ${m.rowNo}`}>{m.remark.length > 120 ? `${m.remark.slice(0, 120)}...` : m.remark || '—'}</span> },
              ]} />
          )}
        </AsyncView>
      </Card>
    </div>
  );
}

const STATUS: Record<ColumnMappingStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; help: string }> = {
  resolved: { label: 'Resolved', tone: 'ok', help: 'A reviewer approved a suggestion or entered a manual mapping.' },
  suggested: { label: 'Suggested', tone: 'info', help: 'An acceptable candidate exists; waiting for human approval.' },
  ambiguous: { label: 'Ambiguous', tone: 'warn', help: 'Two or more near-equal candidates; a human must choose.' },
  'below-threshold': { label: 'Found, rejected', tone: 'warn', help: 'A plausible candidate was found but failed the score or type check.' },
  'no-match': { label: 'No match', tone: 'neutral', help: 'Candidates were compared and none resembles the column.' },
  'insufficient-context': { label: 'Insufficient context', tone: 'bad', help: 'There were no source columns to compare. More context is needed.' },
  'declared-unmapped': { label: 'Declared unmapped', tone: 'neutral', help: 'The workbook itself marks the column as not fed / not used.' },
};

function Unfed({ table }: { table: string }) {
  const decisions = useReviewStore((s) => s.mappingDecisions);
  const manual = useReviewStore((s) => s.manualMappings);
  const reviewed = useMemo(() => selectReviewedMappings({ mappingDecisions: decisions, manualMappings: manual }), [decisions, manual]);
  const enrich = useEnrichment(table);
  const state = useAsync(() => services.mapping.getAnalysis(table, reviewed, enrich), [table, reviewed, enrich?.profile?.id, enrich?.embeddings?.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<ColumnMappingStatus | 'all'>('all');
  return (
    <AsyncView state={state} isEmpty={(d) => d.columns.length === 0} emptyMessage="Every column of this table is fed by a documented mapping.">
      {(a) => {
        const rows = a.columns.filter((c) => filter === 'all' || c.status === filter);
        const sel = a.columns.find((c) => c.targetColumn === open);
        return (
          <div className="space-y-3">
            <Card className="p-3 text-xs">
              <div className="mb-2 font-medium">Context the engine used for {a.table}</div>
              <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                <div>Feeding source tables (lineage): <span className="font-mono">{a.context.sourceTables.join(', ') || 'none documented'}</span></div>
                <div>Candidate source columns compared: <b>{a.context.poolSize}</b></div>
                <div>Workbook remarks / FPM_DA_RULES rows for this table: <b>{a.context.remarkRows}</b> / <b>{a.context.daRules}</b></div>
                <div>Procedure SQL: {a.context.procedureSqlLoaded ? <>loaded; writers of this table: <b>{a.context.procedureWriters.join(', ') || 'none'}</b></> : 'not loaded'}</div>
                <div>Name aliases learned from documented mappings: <b>{a.context.learnedAliases.length}</b>{a.context.learnedAliases.length > 0 && <span className="text-muted"> (e.g. {a.context.learnedAliases.slice(0, 3).map((x) => `${x.from}→${x.to}`).join(', ')})</span>}</div>
                <div>Column descriptions: <span className="text-muted">{a.context.columnDescriptions}</span></div>
              </div>
              <div className="mt-2 text-muted">Skill files under .claude/skills guide the developers and the coding assistant; they are not loaded by this app at run time.</div>
            </Card>
            <Card>
              <CardHeader title="Columns with no feeding mapping" subtitle="Each column has one explicit outcome; click a row for the candidate trace" right={<SimulatedBadge />} />
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 text-xs">
                <button type="button" onClick={() => setFilter('all')} className={filter === 'all' ? 'font-semibold' : 'text-muted'}>All ({a.columns.length})</button>
                {(Object.keys(STATUS) as ColumnMappingStatus[]).filter((k) => a.counts[k] > 0).map((k) => (
                  <button key={k} type="button" title={STATUS[k].help} onClick={() => setFilter(k)} className={filter === k ? 'font-semibold' : 'text-muted'}>
                    <Badge tone={STATUS[k].tone}>{STATUS[k].label} {a.counts[k]}</Badge>
                  </button>
                ))}
              </div>
              <DataTable<ColumnAnalysis> rows={rows} rowKey={(r) => r.targetColumn} pageSize={20} onRowClick={(r) => setOpen(r.targetColumn === open ? null : r.targetColumn)} selectedKey={open ?? undefined}
                columns={[
                  { key: 'c', header: 'Column', render: (r) => <span className="font-mono text-xs">{r.targetColumn} <span className="text-muted">{r.targetType}</span></span> },
                  { key: 'n', header: 'Null', render: (r) => (r.nullable === false ? <Badge tone="warn">NOT NULL</Badge> : r.nullable === null ? '-' : 'NULL') },
                  { key: 'r', header: 'Workbook status', render: (r) => <span className="text-xs text-muted">{r.workbookStatus}</span> },
                  { key: 'a', header: 'Outcome', render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
                  { key: 'b', header: 'Best candidate', render: (r) => (r.best ? <span className="font-mono text-xs">{r.best.table}.{r.best.column} <span className="text-muted">{Math.round(r.best.score * 100)}%</span></span> : <span className="text-xs text-muted">-</span>) },
                ]} />
            </Card>
            {sel && <ColumnTrace col={sel} threshold={a.context.threshold} />}
          </div>
        );
      }}
    </AsyncView>
  );
}

function ColumnTrace({ col, threshold }: { col: ColumnAnalysis; threshold: number }) {
  return (
    <Card>
      <CardHeader title={`Why: ${col.targetColumn}`} subtitle={`${STATUS[col.status].label} · accept at ≥ ${Math.round(threshold * 100)}% (Simulated heuristic)`} />
      <div className="space-y-2 p-3 text-xs">
        <p>{col.explanation}</p>
        {col.resolvedBy && <p className="text-muted">{col.resolvedBy}</p>}
        {col.candidates.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted"><tr><th className="py-1 pr-3">Candidate</th><th className="pr-3">Name</th><th className="pr-3">Type</th><th className="pr-3">Context</th><th className="pr-3">Score</th><th>Decision</th></tr></thead>
              <tbody>
                {col.candidates.map((c) => (
                  <tr key={`${c.table}.${c.column}`} className="border-t border-border align-top">
                    <td className="py-1 pr-3 font-mono">{c.table}.{c.column}<div className="text-muted">{c.type || '-'} · {c.pool}</div>{c.matchedTokens.length > 0 && <div className="text-muted">shared: {c.matchedTokens.join(', ')}</div>}{c.semanticNote && <div className="font-sans text-muted">{c.semanticNote}</div>}{c.transformation && <div className="font-sans"><b>Transformation:</b> {c.transformation}</div>}</td>
                    <td className="pr-3 tabular-nums">{Math.round(c.nameScore * 100)}%</td>
                    <td className="pr-3 tabular-nums">{Math.round(c.typeScore * 100)}%</td>
                    <td className="pr-3">{c.evidence.length ? c.evidence.map((e) => <div key={e}>{e}</div>) : <span className="text-muted">none</span>}</td>
                    <td className="pr-3 tabular-nums">{Math.round(c.score * 100)}%</td>
                    <td>{c.accepted ? <Badge tone="ok">accepted</Badge> : <span className="text-muted">{c.rejection}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted">Console trace for every column: run <span className="font-mono">localStorage.mappingTrace = '1'</span> and reload.</p>
      </div>
    </Card>
  );
}

function Manual({ table }: { table: string }) {
  const tables = useAsync(() => services.mapping.listAllTables(), []);
  const unfed = useAsync(() => services.mapping.getUnfed(table), [table]);
  const all = useReviewStore((s) => s.manualMappings);
  const add = useReviewStore((s) => s.addManualMapping);
  const remove = removeMappingAndRevalidate;
  const [col, setCol] = useState('');
  const [srcTable, setSrcTable] = useState('');
  const [srcCol, setSrcCol] = useState('');
  const [note, setNote] = useState('');
  const mine = all.filter((m) => m.targetTable === table);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Add a manual mapping" subtitle="Human-entered mapping for review (stored in this browser)" />
        <div className="space-y-2 p-3">
          <AsyncView state={unfed}>
            {(u) => (
              <Select value={col} onChange={(e) => setCol(e.target.value)} className="w-full">
                <option value="">Target column (unfed)...</option>
                {u.map((x) => <option key={x.targetColumn} value={x.targetColumn}>{x.targetColumn}</option>)}
              </Select>
            )}
          </AsyncView>
          <AsyncView state={tables}>
            {(t) => {
              const cols = t.find((x) => x.name === srcTable)?.columns ?? [];
              const tgtType = unfed.data?.find((x) => x.targetColumn === col)?.targetType ?? '';
              return (
                <>
                  <Select value={srcTable} onChange={(e) => { setSrcTable(e.target.value); setSrcCol(''); }} className="w-full">
                    <option value="">Source table...</option>
                    {t.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                  </Select>
                  <Select value={srcCol} onChange={(e) => setSrcCol(e.target.value)} className="w-full" disabled={!srcTable}>
                    <option value="">Source column...</option>
                    {cols.map((c) => <option key={c.name} value={c.name}>{c.name} {c.dataType ? `(${c.dataType})` : ''}</option>)}
                  </Select>
                  <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
                  <Button disabled={!col || !srcTable || !srcCol} onClick={() => {
                    add({ targetTable: table, targetColumn: col, targetType: tgtType, sourceTable: srcTable, sourceColumn: srcCol, sourceType: cols.find((c) => c.name === srcCol)?.dataType ?? '', note });
                    setCol(''); setSrcCol(''); setNote('');
                  }}>Add mapping</Button>
                </>
              );
            }}
          </AsyncView>
        </div>
      </Card>
      <Card>
        <CardHeader title={`Manual mappings for ${table}`} />
        {mine.length === 0 ? <div className="p-6 text-center text-sm text-muted">None yet.</div> : (
          <ul className="divide-y divide-border">
            {mine.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 p-3 text-xs">
                <div>
                  <span className="font-mono">{m.targetColumn}</span> ← <span className="font-mono">{m.sourceTable}.{m.sourceColumn}</span>
                  {m.origin === 'rule-approval' && <> <Badge tone="ok">Saved from rule approval</Badge></>}
                  {m.note && <div className="text-muted">{m.note}</div>}
                  {m.ruleIds && m.ruleIds.length > 0 && <div className="text-muted">Rule{m.ruleIds.length > 1 ? 's' : ''}: <span className="font-mono">{m.ruleIds.join(', ')}</span></div>}
                </div>
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => remove(m.id)}><Trash2 size={14} /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
