import { useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Select, SimulatedBadge, Tabs } from '@/components/ui';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useReviewStore } from '@/stores/reviewStore';
import type { ProcKind, ProcObject, SqlAnalysis } from '@/types';
import { SourceProcedures } from './SourceProcedures';
import { SqlFindings } from './SqlFindings';

type Tab = 'sources' | 'catalogue' | 'expressions' | 'sql';
const KIND_LABEL: Record<ProcKind, string> = {
  view: 'TRAQ view', 'traq-procedure': 'TRAQ procedure', 'di-mapping': 'DI mapping', 'di-workflow': 'DI workflow',
  'crismac-procedure': 'CrisMac procedure', 'crismac-object': 'CrisMac object',
};

export function ProceduresPage() {
  const [tab, setTab] = useState<Tab>('sources');
  return (
    <div>
      <PageHeader
        title="Agent 3 · Procedure & Business Logic Analyzer"
        description="Analyse the 14 sample CrisMac procedures' SQL, catalogue what the workbook references, and run the SQL analyzer on pasted SQL."
        right={<InfoTip title="What's SQL and what's names-only" align="right">
          <span><b>Source procedures:</b> the 14 sample procedures have real SQL, parsed by pattern matching (not AI), with columns traced to the TRAQ model.</span>
          <span><b>Everything else:</b> the workbook gives names and remarks only - no operation is asserted beyond keywords in the surrounding text.</span>
          <span><b>Summaries:</b> template text, labelled Simulated, never AI-generated unless you run the AI insight panel.</span>
        </InfoTip>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'sources', label: 'Source procedures (SQL)' }, { id: 'catalogue', label: 'Referenced objects' }, { id: 'expressions', label: 'Documented expressions' }, { id: 'sql', label: 'SQL analyzer' }]} />
      <div className="mt-3">
        {tab === 'sources' && <SourceProcedures />}
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
  const sources = useAsync(() => services.procedures.listSources(), []);
  const short = obj.name.replace(/^PRO\./i, '').toLowerCase();
  const hasSql = !!sources.data?.some((s) => s.name.toLowerCase() === short);
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title={<span className="font-mono">{obj.name}</span>} subtitle={KIND_LABEL[obj.kind]}
          right={<Button size="sm" variant={analysed ? 'outline' : 'default'} onClick={onToggle}>{analysed ? 'Unmark analysed' : 'Mark as analysed'}</Button>} />
        <div className="grid gap-3 p-3 text-xs md:grid-cols-2">
          <div><div className="mb-1 font-medium">Documented operations (keyword match)</div>{obj.operations.length ? <div className="flex flex-wrap gap-1">{obj.operations.map((o) => <Badge key={o}>{o}</Badge>)}</div> : <span className="text-muted">None stated</span>}</div>
          <div><div className="mb-1 font-medium">SQL body</div>{hasSql ? <Badge tone="ok">Provided - see Source procedures tab</Badge> : <Badge tone="warn">Not provided in workbook</Badge>}</div>
          <div><div className="mb-1 font-medium">Tables mentioned alongside</div><div className="font-mono text-muted">{obj.mentionedTables.join(', ') || '—'}</div></div>
          <div><div className="mb-1 font-medium">Related objects</div><div className="font-mono text-muted">{obj.related.join(', ') || '—'}</div></div>
        </div>
      </Card>
      <AiInsightPanel title="AI procedure explanation" resetKey={obj.id} run={(o) => services.ai.explainProcedure(obj.id, o)} />
      <Card>
        <CardHeader title="Summary" subtitle="Deterministic template (no AI)" right={<SimulatedBadge label="Simulated (template)" />} />
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
            {(a) => <SqlFindings a={a} />}
          </AsyncView>
        )}
      </Card>
    </div>
  );
}
