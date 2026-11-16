import { useState } from 'react';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Select, SimulatedBadge, Tabs } from '@/components/ui';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useReviewStore } from '@/stores/reviewStore';
import type { ProcKind, ProcObject, SqlAnalysis } from '@/types';

type Tab = 'catalogue' | 'expressions' | 'sql';
const KIND_LABEL: Record<ProcKind, string> = {
  view: 'TRAQ view', 'traq-procedure': 'TRAQ procedure', 'di-mapping': 'DI mapping', 'di-workflow': 'DI workflow',
  'crismac-procedure': 'CrisMac procedure', 'crismac-object': 'CrisMac object',
};

export function ProceduresPage() {
  const [tab, setTab] = useState<Tab>('catalogue');
  return (
    <div>
      <PageHeader
        title="Agent 3 · Procedure & Business Logic Analyzer"
        description="The workbook does not contain any SQL bodies. This agent catalogues procedures, views and DI mappings that the workbook references, shows the logic that IS documented (expressions in remarks), and offers a client-side analyzer for pasted SQL."
      />
      <div className="mb-3 rounded-md border border-border bg-warnbg p-3 text-xs text-warn">
        Procedure bodies for INSERT / UPDATE / MERGE are not provided in the workbook, so no operation is asserted beyond keywords found in the surrounding text. Template summaries are labelled Simulated.
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'catalogue', label: 'Referenced objects' }, { id: 'expressions', label: 'Documented expressions' }, { id: 'sql', label: 'SQL analyzer' }]} />
      <div className="mt-3">
        {tab === 'catalogue' && <Catalogue />}
        {tab === 'expressions' && <Expressions />}
        {tab === 'sql' && <SqlAnalyzer />}
      </div>
    </div>
  );
}

function Catalogue() {
  const state = useAsync(() => services.procedures.listObjects(), []);
  const [kind, setKind] = useState<ProcKind | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const analysed = useReviewStore((s) => s.proceduresAnalysed);
  const toggle = useReviewStore((s) => s.toggleProcedure);
  return (
    <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No procedure/view/mapping names were found in the workbook text.">
      {(all) => {
        const rows = all.filter((o) => (!kind || o.kind === kind) && o.name.toLowerCase().includes(search.toLowerCase()));
        const sel = all.find((o) => o.id === selected);
        return (
          <div className="grid gap-4 xl:grid-cols-[28rem_1fr]">
            <Card>
              <CardHeader title={`Objects (${rows.length})`} right={<OriginBadge meta={state.meta} />} />
              <div className="flex gap-2 border-b border-border p-3">
                <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1" />
                <Select value={kind} onChange={(e) => setKind(e.target.value as ProcKind | '')}>
                  <option value="">All kinds</option>
                  {(Object.keys(KIND_LABEL) as ProcKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              </div>
              <DataTable<ProcObject> rows={rows} rowKey={(o) => o.id} selectedKey={selected} onRowClick={(o) => setSelected(o.id)} pageSize={20}
                columns={[
                  { key: 'n', header: 'Object', render: (o) => <span className="font-mono text-xs">{o.name}</span> },
                  { key: 'k', header: 'Kind', render: (o) => <Badge tone="info">{KIND_LABEL[o.kind]}</Badge> },
                  { key: 'a', header: '✓', render: (o) => (analysed[o.id] ? <Badge tone="ok">done</Badge> : null) },
                ]} />
            </Card>
            {sel ? <ObjectDetail obj={sel} analysed={!!analysed[sel.id]} onToggle={() => toggle(sel.id)} /> : <Card className="p-8 text-center text-sm text-muted">Select an object to see where it is referenced and what the workbook says about it.</Card>}
          </div>
        );
      }}
    </AsyncView>
  );
}

function ObjectDetail({ obj, analysed, onToggle }: { obj: ProcObject; analysed: boolean; onToggle: () => void }) {
  const explain = useAsync(() => services.procedures.explain(obj.id), [obj.id]);
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title={<span className="font-mono">{obj.name}</span>} subtitle={KIND_LABEL[obj.kind]}
          right={<Button size="sm" variant={analysed ? 'outline' : 'default'} onClick={onToggle}>{analysed ? 'Unmark analysed' : 'Mark as analysed'}</Button>} />
        <div className="grid gap-3 p-3 text-xs md:grid-cols-2">
          <div><div className="mb-1 font-medium">Documented operations (keyword match)</div>{obj.operations.length ? <div className="flex flex-wrap gap-1">{obj.operations.map((o) => <Badge key={o}>{o}</Badge>)}</div> : <span className="text-muted">None stated</span>}</div>
          <div><div className="mb-1 font-medium">SQL body</div><Badge tone="warn">Not provided in workbook</Badge></div>
          <div><div className="mb-1 font-medium">Tables mentioned alongside</div><div className="font-mono text-muted">{obj.mentionedTables.join(', ') || '—'}</div></div>
          <div><div className="mb-1 font-medium">Related objects</div><div className="font-mono text-muted">{obj.related.join(', ') || '—'}</div></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Summary" right={<SimulatedBadge label="Simulated (template)" />} />
        <AsyncView state={explain}>{(e) => <ul className="space-y-1 p-3 text-sm">{e.summary.map((l) => <li key={l}>• {l}</li>)}</ul>}</AsyncView>
      </Card>
      <Card>
        <CardHeader title={`Workbook references (${obj.references.length})`} subtitle="Verbatim excerpts" />
        <div className="divide-y divide-border">
          {obj.references.map((r, i) => (
            <div key={i} className="p-3 text-xs"><div className="mb-1 text-muted">{r.sheet} · row {r.rowNo}</div><p className="whitespace-pre-wrap">{r.snippet}</p></div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Expressions() {
  const state = useAsync(() => services.procedures.listExpressions(), []);
  const [q, setQ] = useState('');
  return (
    <Card>
      <CardHeader title="Expressions documented in the workbook" subtitle="CASE / DATEDIFF / COALESCE / GREATEST ... verbatim from remark cells" right={<OriginBadge meta={state.meta} />} />
      <div className="border-b border-border p-3"><Input placeholder="Filter by table or column..." value={q} onChange={(e) => setQ(e.target.value)} className="w-80" /></div>
      <AsyncView state={state} isEmpty={(d) => d.length === 0}>
        {(rows) => (
          <DataTable rows={rows.filter((r) => `${r.targetTable}.${r.targetColumn}`.toLowerCase().includes(q.toLowerCase()))} rowKey={(r) => r.id} pageSize={10}
            columns={[
              { key: 't', header: 'Target', render: (r) => <span className="font-mono text-xs">{r.targetTable}.{r.targetColumn}</span> },
              { key: 'e', header: 'Documented logic', render: (r) => <p className="max-w-3xl whitespace-pre-wrap font-mono text-[11px]">{r.expression}</p> },
              { key: 's', header: 'Source', render: (r) => <span className="text-xs text-muted">{r.sheet} · {r.rowNo}</span> },
            ]} />
        )}
      </AsyncView>
    </Card>
  );
}

function SqlAnalyzer() {
  const [sql, setSql] = useState('');
  const [submitted, setSubmitted] = useState('');
  const state = useAsync(() => (submitted ? services.procedures.analyzeSql(submitted) : noResult<SqlAnalysis>('Paste SQL and click Analyze.')), [submitted]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Paste SQL" subtitle="Analysed in the browser with regular expressions - not AI. Nothing leaves your machine." />
        <div className="space-y-2 p-3">
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={16} placeholder="INSERT INTO FCT_PRODUCT_MASTER (...) SELECT ... FROM STG_ASSET_BASE ..."
            className="w-full rounded-md border border-border bg-surface p-2 font-mono text-xs outline-none focus:ring-2 focus:ring-primary" />
          <Button onClick={() => setSubmitted(sql)} disabled={!sql.trim()}>Analyze</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Findings" />
        {!submitted ? <div className="p-6 text-center text-sm text-muted">Paste SQL and click Analyze.</div> : (
          <AsyncView state={state}>
            {(a) => (
              <div className="space-y-3 p-3 text-xs">
                <div><div className="mb-1 font-medium">Write targets</div>{a.statements.length ? a.statements.map((s, i) => <div key={i}><Badge tone="primary">{s.type}</Badge> <span className="font-mono">{s.table}</span></div>) : <span className="text-muted">None detected</span>}</div>
                <div><div className="mb-1 font-medium">Source tables</div>{a.sourceTables.length ? a.sourceTables.map((s) => <div key={s.name}><span className="font-mono">{s.name}</span> <Badge tone={s.knownInWorkbook ? 'ok' : 'warn'}>{s.knownInWorkbook ? 'in workbook' : 'not in workbook'}</Badge></div>) : <span className="text-muted">None detected</span>}</div>
                <div><div className="mb-1 font-medium">Functions</div><div className="flex flex-wrap gap-1">{a.functions.map((f) => <Badge key={f}>{f}</Badge>)}{a.functions.length === 0 && <span className="text-muted">None</span>}</div></div>
                <div><div className="mb-1 font-medium">Clauses</div><div className="flex flex-wrap gap-1">{a.clauses.map((f) => <Badge key={f}>{f}</Badge>)}{a.clauses.length === 0 && <span className="text-muted">None</span>}</div></div>
                {a.warnings.length > 0 && <div><div className="mb-1 font-medium">Warnings</div><ul className="space-y-1 text-warn">{a.warnings.map((w) => <li key={w}>• {w}</li>)}</ul></div>}
              </div>
            )}
          </AsyncView>
        )}
      </Card>
    </div>
  );
}
