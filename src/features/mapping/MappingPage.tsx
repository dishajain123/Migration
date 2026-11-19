import { Check, Trash2, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Progress, Select, SimulatedBadge, Tabs } from '@/components/ui';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useReviewStore } from '@/stores/reviewStore';
import type { MappingIssueSummary, MappingRow, Suggestion, UnfedColumn } from '@/types';

type Tab = 'suggestions' | 'documented' | 'unfed' | 'manual';

export function MappingPage() {
  const targets = useAsync(() => services.mapping.listTargets(), []);
  const [params] = useSearchParams();
  const [table, setTable] = useState(params.get('table') ?? '');
  const [tab, setTab] = useState<Tab>('suggestions');
  const lastError = useReviewStore((s) => s.lastError);
  return (
    <div>
      <PageHeader
        title="Agent 4 · Migration Mapping Engine"
        description="Review documented mappings, see columns that no mapping feeds, and approve / reject / manually add mappings. Suggestions and their confidence are a deterministic heuristic over column names and types."
        right={<OriginBadge meta={targets.meta} />}
      />
      {lastError && <div className="mb-3 rounded-md border border-bad bg-badbg p-2 text-xs text-bad">{lastError}</div>}
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
          {tab === 'suggestions' && <AiInsightPanel title="AI mapping recommendations" resetKey={table} run={(o) => services.ai.rankMappings(table, o)} actionLabel="Rank candidates with AI" />}
          {tab === 'suggestions' && <Suggestions table={table} />}
          {tab === 'documented' && <Documented table={table} />}
          {tab === 'unfed' && <Unfed table={table} />}
          {tab === 'manual' && <Manual table={table} />}
        </div>
      )}
    </div>
  );
}

function Suggestions({ table }: { table: string }) {
  const state = useAsync(() => services.mapping.getSuggestions(table), [table]);
  const decisions = useReviewStore((s) => s.mappingDecisions);
  const review = useReviewStore((s) => s.reviewMapping);
  const clear = useReviewStore((s) => s.clearMappingDecision);
  const [min, setMin] = useState(0);
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  return (
    <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No candidate source columns scored above the heuristic threshold for this table.">
      {(all) => {
        const stat = (s: Suggestion) => decisions[s.id]?.decision ?? 'pending';
        const rows = all.filter((s) => s.confidence >= min && (status === 'all' || stat(s) === status));
        const mk = (s: Suggestion) => ({ id: s.id, targetTable: s.targetTable, targetColumn: s.targetColumn, targetType: s.targetType, sourceTable: s.sourceTable, sourceColumn: s.sourceColumn, sourceType: s.sourceType });
        const bulk = async () => { for (const s of rows) if (stat(s) === 'pending') await review(s.id, 'approved', `Bulk approve >= ${min}%`, mk(s)); };
        return (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-sm">
              <label className="flex items-center gap-2">Min confidence <input type="range" min={0} max={95} step={5} value={min} onChange={(e) => setMin(Number(e.target.value))} /> <span className="w-10 tabular-nums">{min}%</span></label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
              </Select>
              <Button size="sm" variant="outline" onClick={bulk} disabled={min < 50}>Approve all pending shown{min < 50 ? ' (set min ≥ 50%)' : ''}</Button>
              <span className="ml-auto text-xs text-muted">{rows.length} of {all.length} shown</span>
            </div>
            <DataTable<Suggestion> rows={rows} rowKey={(s) => s.id} pageSize={15}
              columns={[
                { key: 'tgt', header: 'Target', render: (s) => <div className="font-mono text-xs">{s.targetColumn}<div className="text-muted">{s.targetType || '-'}</div></div> },
                { key: 'src', header: 'Suggested source', render: (s) => <div className="font-mono text-xs">{s.sourceTable}.{s.sourceColumn}<div className="text-muted">{s.sourceType || '-'}</div></div> },
                { key: 'c', header: 'Confidence', className: 'w-36', render: (s) => <div><div className="mb-1 text-xs tabular-nums">{s.confidence}%</div><Progress value={s.confidence} tone={s.confidence >= 75 ? 'ok' : s.confidence >= 50 ? 'warn' : 'bad'} /></div> },
                { key: 'i', header: 'Flags', render: (s) => <div className="space-y-1 text-xs">{s.ambiguous && <Badge tone="warn">ambiguous</Badge>}{s.compat !== 'compatible' && s.compat !== 'unknown' && <Badge tone={s.compat === 'incompatible' ? 'bad' : 'warn'}>{s.compat}</Badge>}{s.issues.map((i) => <div key={i} className="text-muted">{i}</div>)}</div> },
                { key: 'st', header: 'Status', render: (s) => <Badge tone={stat(s) === 'approved' ? 'ok' : stat(s) === 'rejected' ? 'bad' : 'neutral'}>{stat(s)}</Badge> },
                { key: 'a', header: '', render: (s) => (
                  <div className="flex gap-1">
                    <Button size="icon" variant="success" aria-label="Approve" title="Approve" onClick={() => review(s.id, 'approved', '', mk(s))}><Check size={14} /></Button>
                    <Button size="icon" variant="danger" aria-label="Reject" title="Reject" onClick={() => review(s.id, 'rejected', '', mk(s))}><X size={14} /></Button>
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

function Unfed({ table }: { table: string }) {
  const state = useAsync(() => services.mapping.getUnfed(table), [table]);
  return (
    <Card>
      <CardHeader title="Columns with no feeding mapping" subtitle="Includes columns marked NOT FED / NOT MAPPED / NOT USED in the workbook" />
      <AsyncView state={state} isEmpty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable<UnfedColumn> rows={rows} rowKey={(r) => r.targetColumn} pageSize={20}
            columns={[
              { key: 'c', header: 'Column', render: (r) => <span className="font-mono text-xs">{r.targetColumn} <span className="text-muted">{r.targetType}</span></span> },
              { key: 'n', header: 'Null', render: (r) => (r.nullable === false ? <Badge tone="warn">NOT NULL</Badge> : r.nullable === null ? '-' : 'NULL') },
              { key: 'r', header: 'Workbook status', render: (r) => <span className="text-xs text-muted">{r.reason}</span> },
              { key: 'a', header: 'Agent', render: (r) => (r.ambiguous ? <Badge tone="warn">ambiguous</Badge> : r.hasSuggestion ? <Badge tone="info">has suggestion</Badge> : <Badge>no candidate</Badge>) },
            ]} />
        )}
      </AsyncView>
    </Card>
  );
}

function Manual({ table }: { table: string }) {
  const tables = useAsync(() => services.mapping.listAllTables(), []);
  const unfed = useAsync(() => services.mapping.getUnfed(table), [table]);
  const all = useReviewStore((s) => s.manualMappings);
  const add = useReviewStore((s) => s.addManualMapping);
  const remove = useReviewStore((s) => s.removeManualMapping);
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
                <div><span className="font-mono">{m.targetColumn}</span> ← <span className="font-mono">{m.sourceTable}.{m.sourceColumn}</span>{m.note && <div className="text-muted">{m.note}</div>}</div>
                <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => remove(m.id)}><Trash2 size={14} /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
