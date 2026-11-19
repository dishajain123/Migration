import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { AsyncView, Badge, Card, CardHeader, DataTable, Input, OriginBadge, Select, Stat, Tabs } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { DdExport, ProcSource, ProcTrace, SqlStep, SqlStepType } from '@/types';

type Sub = 'overview' | 'steps' | 'traq' | 'changes' | 'dd';
const mono = 'font-mono text-xs';
const stepNo = (id: string) => `#${id.slice(id.lastIndexOf(':') + 1)}`;

export function SourceProcedures() {
  const sources = useAsync(() => services.procedures.listSources(), []);
  const traces = useAsync(() => services.procedures.listTraces(), []);
  const [selected, setSelected] = useState('');
  return (
    <AsyncView state={sources} isEmpty={(d) => d.length === 0} emptyMessage="No procedure SQL files are listed in manifest.json.">
      {(list) => (
        <AsyncView state={traces}>
          {(tr) => {
            const traceOf = (n: string) => tr.find((t) => t.proc === n);
            const sel = list.find((p) => p.id === selected);
            const traceable = tr.filter((t) => t.status === 'traceable').length;
            const stmts = list.reduce((n, p) => n + p.steps.filter((s) => !s.housekeeping).length, 0);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Source procedures" value={list.length} hint="Sample SQL files, execution order S00 → S13" />
                  <Stat label="Statements analysed" value={stmts.toLocaleString()} hint="Excluding status bookkeeping" />
                  <Stat label="Traceable to TRAQ" value={`${traceable}/${list.length}`} hint="A written column or FPM_DA_RULES row matches" />
                  <Stat label="FPM_DA_RULES links" value={tr.reduce((n, t) => n + t.daRules.length, 0)} hint="Workbook rows relating to these procedures" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primarybg px-4 py-2.5 text-sm">
                  <span>Ready to migrate this logic? Agent 5 converts these procedures into TRAQ rules using the Agent 4 mappings, with review and Excel/CSV export.</span>
                  <Link to="/rules?tab=convert" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primaryfg hover:opacity-90">Convert to TRAQ rules</Link>
                </div>
                <div className="grid gap-4 xl:grid-cols-[26rem_1fr]">
                  <Card>
                    <CardHeader title="Execution order" right={<OriginBadge meta={sources.meta} />} />
                    <DataTable<ProcSource> rows={list} rowKey={(p) => p.id} selectedKey={selected} onRowClick={(p) => setSelected(p.id)} pageSize={20}
                      columns={[
                        { key: 's', header: 'Stage', render: (p) => <span className={mono}>{p.stage || '-'}</span> },
                        { key: 'n', header: 'Procedure', render: (p) => <span className={`${mono} break-all`}>{p.name}</span> },
                        { key: 't', header: 'TRAQ', render: (p) => (traceOf(p.name)?.status === 'traceable' ? <Badge tone="ok">linked</Badge> : <Badge tone="warn">no link</Badge>) },
                      ]} />
                  </Card>
                  {sel ? <Detail proc={sel} trace={traceOf(sel.name)} /> : <Card className="p-8 text-center text-sm text-muted">Select a procedure to see its statements, the columns it assigns, and how they relate to the TRAQ model.</Card>}
                </div>
              </div>
            );
          }}
        </AsyncView>
      )}
    </AsyncView>
  );
}

function Detail({ proc, trace }: { proc: ProcSource; trace: ProcTrace | undefined }) {
  const [sub, setSub] = useState<Sub>('overview');
  return (
    <div className="min-w-0 space-y-3">
      <Card>
        <CardHeader title={<span className="font-mono">PRO.{proc.name}</span>} subtitle={`${proc.stage} · ${proc.file} · ${proc.lineCount.toLocaleString()} lines`}
          right={<Badge tone="info">Source SQL (verbatim)</Badge>} />
        <div className="px-4">
          <Tabs<Sub> value={sub} onChange={setSub} tabs={[
            { id: 'overview', label: 'Overview' }, { id: 'steps', label: `Statements (${proc.steps.filter((s) => !s.housekeeping).length})` },
            { id: 'traq', label: 'TRAQ traceability' }, { id: 'changes', label: `Change comments (${proc.changeLog.length})` }, { id: 'dd', label: 'DD export' },
          ]} />
        </div>
      </Card>
      {sub === 'overview' && <AiInsightPanel title="AI procedure explanation" resetKey={proc.name} run={(o) => services.ai.explainSourceProcedure(proc.name, o)} />}
      {sub === 'overview' && <Overview proc={proc} trace={trace} />}
      {sub === 'steps' && <Steps proc={proc} />}
      {sub === 'traq' && <Traq proc={proc} trace={trace} />}
      {sub === 'changes' && <Changes proc={proc} />}
      {sub === 'dd' && <Dd name={proc.name} />}
    </div>
  );
}

function Chips({ items, empty = 'None' }: { items: string[]; empty?: string }) {
  if (!items.length) return <span className="text-muted">{empty}</span>;
  return <div className="flex flex-wrap gap-1">{items.map((i) => <span key={i} className={`${mono} rounded bg-surface2 px-1.5 py-0.5`}>{i}</span>)}</div>;
}

function Overview({ proc, trace }: { proc: ProcSource; trace: ProcTrace | undefined }) {
  const inWb = new Map((trace?.readTables ?? []).map((t) => [t.name, t.inWorkbook]));
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader title="Header" subtitle="As written in the comment block" />
        <div className="grid gap-3 p-3 text-xs md:grid-cols-2">
          <div><div className="mb-1 font-medium">Author / dates</div><div className="text-muted">{proc.author || 'Not stated'} · created {proc.created || '-'} · modified {proc.modified || '-'}</div></div>
          <div><div className="mb-1 font-medium">Parameters</div>{proc.params.length ? <ul className={mono}>{proc.params.map((p) => <li key={p.name}>{p.name} {p.type}{p.defaultValue ? ` = ${p.defaultValue}` : ''}</li>)}</ul> : <span className="text-muted">None</span>}</div>
          <div className="md:col-span-2"><div className="mb-1 font-medium">Description</div>{proc.descriptions.length ? <ul className="space-y-0.5">{proc.descriptions.map((d, i) => <li key={i}>• {d}</li>)}</ul> : <span className="text-muted">Not provided in source</span>}</div>
          <div className="md:col-span-2"><div className="mb-1 font-medium">Calls other procedures</div><Chips items={proc.calls} /></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Tables" subtitle="Working tables ##X and PRO.X are shown under one logical name" />
        <div className="grid gap-3 p-3 text-xs md:grid-cols-2">
          <div>
            <div className="mb-1 font-medium">Reads ({proc.tablesRead.length})</div>
            <div className="flex flex-wrap gap-1">
              {proc.tablesRead.map((t) => <span key={t} className={`${mono} inline-flex items-center gap-1 rounded bg-surface2 px-1.5 py-0.5`}>{t}{inWb.get(t) && <Badge tone="ok">in workbook</Badge>}</span>)}
              {proc.tablesRead.length === 0 && <span className="text-muted">None</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 font-medium">Writes ({proc.tablesWritten.length})</div>
            {proc.tablesWritten.length ? <ul className="space-y-0.5">{proc.tablesWritten.map((w) => <li key={w.table}><span className={mono}>{w.table}</span> <span className="text-muted">{w.columns.length} column(s) assigned</span></li>)}</ul> : <span className="text-muted">None</span>}
          </div>
        </div>
      </Card>
      {proc.thresholds.length > 0 && (
        <Card>
          <CardHeader title="Configured parameters read" subtitle="Names only: the values live in database tables that are not provided" />
          <div className="p-3 text-xs"><Chips items={proc.thresholds} /></div>
        </Card>
      )}
      {proc.testCases.length > 0 && (
        <Card>
          <CardHeader title={`Test scenarios named in the header (${proc.testCases.length})`} subtitle="RefCustomerID → scenario, verbatim" />
          <ul className="divide-y divide-border text-xs">{proc.testCases.map((t) => <li key={t.id} className="flex gap-3 px-3 py-1.5"><span className={`${mono} w-10 shrink-0 text-muted`}>{t.id}</span>{t.text}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}

const TYPES: SqlStepType[] = ['INSERT', 'UPDATE', 'MERGE', 'DELETE', 'TRUNCATE', 'SELECT_INTO', 'EXEC'];

function Steps({ proc }: { proc: ProcSource }) {
  const [type, setType] = useState<SqlStepType | ''>('');
  const [q, setQ] = useState('');
  const [book, setBook] = useState(false);
  const rows = useMemo(() => proc.steps.filter((s) => (book || !s.housekeeping) && (!type || s.type === type)
    && `${s.table} ${s.callee} ${s.columns.map((c) => c.name).join(' ')} ${s.guard}`.toLowerCase().includes(q.toLowerCase())), [proc, type, q, book]);
  return (
    <Card>
      <CardHeader title={`Statements (${rows.length})`} subtitle="Every write in the procedure, with the IF/ELSE conditions around it and the expression assigned to each column" />
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Input placeholder="Filter by table, column, condition..." value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <Select value={type} onChange={(e) => setType(e.target.value as SqlStepType | '')}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
        <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} /> Show status bookkeeping</label>
      </div>
      <DataTable<SqlStep> rows={rows} rowKey={(s) => s.id} pageSize={12} empty="No statements match."
        columns={[
          { key: 'i', header: '#', render: (s) => <span className={mono}>{s.index}</span> },
          { key: 'l', header: 'Lines', render: (s) => <span className="whitespace-nowrap text-xs text-muted">{s.lineStart}–{s.lineEnd}</span> },
          { key: 't', header: 'Statement', render: (s) => (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1"><Badge tone="primary">{s.type}</Badge><span className={`${mono} break-all`}>{s.type === 'EXEC' ? s.callee : s.table}</span>{s.tableKind === 'local-temp' && <Badge>temp</Badge>}{s.housekeeping && <Badge>bookkeeping</Badge>}</div>
              {s.columns.length > 0 && <div className="text-[11px] text-muted">{s.columns.slice(0, 6).map((c) => c.name).join(', ')}{s.columns.length > 6 ? ` +${s.columns.length - 6} more` : ''}</div>}
            </div>) },
          { key: 'g', header: 'Applies when', render: (s) => <span className="max-w-xs text-xs">{s.guard || <span className="text-muted">always</span>}</span> },
          { key: 'd', header: 'Detail', render: (s) => (
            <details className="max-w-2xl text-xs">
              <summary className="cursor-pointer text-primary">Logic and SQL</summary>
              {s.note && <p className="mt-1 text-muted">Comment above: {s.note}</p>}
              {s.reads.length > 0 && <p className="mt-1">Reads: <span className={mono}>{s.reads.join(', ')}</span></p>}
              {s.functions.length > 0 && <p className="mt-1">Functions: <span className={mono}>{s.functions.join(', ')}</span></p>}
              {s.columns.some((c) => c.expression) && (
                <table className="mt-2 w-full text-left"><tbody>
                  {s.columns.filter((c) => c.expression).slice(0, 40).map((c) => <tr key={c.name} className="border-t border-border align-top"><td className={`${mono} py-1 pr-2`}>{c.name}</td><td className={`${mono} py-1 break-words`}>{c.expression}</td></tr>)}
                </tbody></table>
              )}
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface2 p-2 font-mono text-[11px]">{s.sql}</pre>
            </details>) },
        ]} />
    </Card>
  );
}

function Traq({ proc, trace }: { proc: ProcSource; trace: ProcTrace | undefined }) {
  if (!trace) return <Card className="p-6 text-sm text-muted">No trace available.</Card>;
  const ok = trace.status === 'traceable';
  return (
    <div className="space-y-3">
      <div className={`rounded-md border p-3 text-xs ${ok ? 'border-ok bg-okbg text-ok' : 'border-warn bg-warnbg text-warn'}`}>
        <div className="mb-0.5 font-medium">{ok ? 'Traceable to the TRAQ model' : 'No documented TRAQ link'}</div>{trace.note}
      </div>
      <Card>
        <CardHeader title={`Written columns with a TRAQ counterpart (${trace.links.length})`} subtitle={`Of ${trace.writtenColumns} column assignment(s) in this procedure. Derived by name match.`} />
        <DataTable rows={trace.links} rowKey={(l) => `${l.procTable}.${l.procColumn}>${l.traqTable}.${l.traqColumn}`} pageSize={10} empty="No written column name matches a TRAQ column."
          columns={[
            { key: 'p', header: 'Procedure writes', render: (l) => <span className={mono}>{l.procTable}.{l.procColumn}</span> },
            { key: 't', header: 'TRAQ column', render: (l) => <span className={mono}>{l.traqTable}.{l.traqColumn}</span> },
            { key: 's', header: 'Statements', render: (l) => <span className="text-xs text-muted">{l.stepIds.slice(0, 6).map((id) => stepNo(id)).join(', ')}{l.stepIds.length > 6 ? ' …' : ''}</span> },
            { key: 'a', header: 'Open', render: (l) => <span className="flex gap-2 text-xs"><Link className="text-primary hover:underline" to={`/lineage?table=${encodeURIComponent(l.traqTable)}`}>Lineage</Link><Link className="text-primary hover:underline" to={`/mapping?table=${encodeURIComponent(l.traqTable)}`}>Mapping</Link></span> },
          ]} />
      </Card>
      <Card>
        <CardHeader title={`FPM_DA_RULES rows related to this procedure (${trace.daRules.length})`} subtitle="From the workbook: rows that name this procedure or a column it writes" />
        <DataTable rows={trace.daRules} rowKey={(d) => String(d.rowNo)} pageSize={8} empty="No FPM_DA_RULES row relates to this procedure."
          columns={[
            { key: 'c', header: 'TRAQ column', render: (d) => <span className={mono}>FCT_PRODUCT_MASTER.{d.column}</span> },
            { key: 'k', header: 'Rule', render: (d) => <span className="text-xs">run {d.run || '?'} · {d.ruleType || d.kind}</span> },
            { key: 'l', header: 'Documented logic', render: (d) => <p className="max-w-xl whitespace-pre-wrap text-xs">{d.logic.length > 260 ? `${d.logic.slice(0, 260)}...` : d.logic}</p> },
            { key: 'r', header: 'Source', render: (d) => <span className="text-xs text-muted">FPM_DA_RULES · {d.rowNo}</span> },
          ]} />
      </Card>
      <Card>
        <CardHeader title="Where the procedure's inputs sit in the workbook" subtitle={`Tables read by ${proc.name}`} />
        <div className="flex flex-wrap gap-1.5 p-3 text-xs">
          {trace.readTables.map((t) => <span key={t.name} className="inline-flex items-center gap-1"><span className={mono}>{t.name}</span><Badge tone={t.inWorkbook ? 'ok' : 'neutral'}>{t.inWorkbook ? 'in workbook' : 'not in workbook'}</Badge></span>)}
          {trace.readTables.length === 0 && <span className="text-muted">None</span>}
        </div>
      </Card>
    </div>
  );
}

function Changes({ proc }: { proc: ProcSource }) {
  return (
    <Card>
      <CardHeader title="Dated change comments" subtitle="Comment lines containing a date and a change keyword, verbatim: evidence of business-rule changes over time" />
      {proc.changeLog.length === 0 ? <div className="p-6 text-center text-sm text-muted">No dated change comments found.</div> : (
        <ul className="divide-y divide-border text-xs">{proc.changeLog.map((c) => <li key={`${c.line}-${c.text}`} className="flex gap-3 px-3 py-1.5"><span className={`${mono} w-12 shrink-0 text-muted`}>L{c.line}</span><span>{c.text}</span></li>)}</ul>
      )}
    </Card>
  );
}

function Dd({ name }: { name: string }) {
  const state = useAsync(() => services.procedures.getDdExport(name), [name]);
  const [q, setQ] = useState('');
  return (
    <Card>
      <CardHeader title="Data-dictionary export" subtitle="dd_export.csv beside the procedure" right={<OriginBadge meta={state.meta} />} />
      <AsyncView state={state}>
        {(d: DdExport) => {
          if (!d.available) return <div className="p-4 text-sm"><Badge tone="warn">Not available</Badge><p className="mt-2 text-muted">{d.note}</p><p className="mt-1 font-mono text-xs text-muted">{d.file}</p></div>;
          const rows = d.rows.map((cells, i) => ({ i, cells })).filter((r) => r.cells.join(' ').toLowerCase().includes(q.toLowerCase()));
          return (
            <div>
              <div className="flex items-center gap-3 border-b border-border p-3"><Input placeholder="Filter rows..." value={q} onChange={(e) => setQ(e.target.value)} className="w-72" /><span className="text-xs text-muted">{d.note}</span></div>
              <DataTable rows={rows} rowKey={(r) => String(r.i)} pageSize={15}
                columns={d.header.map((h, ci) => ({ key: `c${ci}`, header: h || `Column ${ci + 1}`, render: (r: { cells: string[] }) => <span className="text-xs">{r.cells[ci] ?? ''}</span> }))} />
            </div>
          );
        }}
      </AsyncView>
    </Card>
  );
}
