import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Select, Tabs, type Column } from '@/components/ui';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { ColumnDetail, ComparePair, CompatLevel, Layer, Relationship, SystemKind, TableComparison, TableDetail, TableSummary } from '@/types';

type Tab = 'columns' | 'relations' | 'compare' | 'scope';
const compatTone = { compatible: 'ok', warn: 'warn', incompatible: 'bad', unknown: 'neutral' } as const;

export function DataModelPage() {
  const [search, setSearch] = useState('');
  const [system, setSystem] = useState<SystemKind | ''>('');
  const [layer, setLayer] = useState<Layer | ''>('');
  const [selected, setSelected] = useState<string>('');
  const [tab, setTab] = useState<Tab>('columns');

  const list = useAsync(() => services.dataModel.listTables({ system: system || undefined, layer: layer || undefined, search }), [system, layer, search]);

  return (
    <div>
      <PageHeader
        title="Agent 1 · Data Model Understanding"
        description="Browse CrisMac (source) and TRAQ (target) tables, columns, types, keys and documented relationships, and compare a source table against a target table."
        right={<OriginBadge meta={list.meta} />}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader title="Tables" subtitle="Filter by system or layer" />
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <Input placeholder="Search tables..." value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-[9rem] flex-1" />
            <Select value={system} onChange={(e) => setSystem(e.target.value as SystemKind | '')}>
              <option value="">All systems</option><option value="TRAQ">TRAQ (target)</option><option value="CrisMac">CrisMac / feeds (source)</option>
            </Select>
            <Select value={layer} onChange={(e) => setLayer(e.target.value as Layer | '')}>
              <option value="">All layers</option>
              {['CRISMAC', 'RECEPTION', 'STAGING', 'MART', 'APP', 'DI'].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </div>
          <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
            <AsyncView state={list} isEmpty={(d) => d.length === 0} emptyMessage="No tables match the filters.">
              {(rows) => (
                <DataTable<TableSummary>
                  rows={rows} pageSize={30} rowKey={(r) => r.name} selectedKey={selected} fixedLayout
                  onRowClick={(r) => { setSelected(r.name); setTab('columns'); }}
                  columns={[
                    { key: 'name', header: 'Table', render: (r) => <span className="font-mono text-xs">{r.name}</span> },
                    { key: 'layer', header: 'Layer', className: 'w-[7.5rem]', render: (r) => <Badge tone={r.system === 'TRAQ' ? 'primary' : 'neutral'}>{r.layer}</Badge> },
                    { key: 'cols', header: 'Cols', className: 'w-14 text-right', render: (r) => r.listedColumns },
                  ]}
                />
              )}
            </AsyncView>
          </div>
        </Card>

        <div className="min-w-0 space-y-3">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'columns', label: 'Table detail' }, { id: 'relations', label: 'Relationships' }, { id: 'compare', label: 'Source vs target' }, { id: 'scope', label: 'Scope & gaps' }]} />
          {tab === 'columns' && <TableDetailPanel name={selected} />}
          {tab === 'relations' && <RelationshipsPanel name={selected} onOpen={(t) => { setSelected(t); setTab('columns'); }} />}
          {tab === 'compare' && <ComparePanel initialTarget={selected} />}
          {tab === 'scope' && <ScopePanel />}
        </div>
      </div>
    </div>
  );
}

function TableDetailPanel({ name }: { name: string }) {
  const state = useAsync(() => (name ? services.dataModel.getTable(name) : noResult<TableDetail>('Select a table from the list.')), [name]);
  if (!name) return <Card className="p-8 text-center text-sm text-muted">Select a table from the list to see its columns, types and mappings.</Card>;
  return (
    <AsyncView state={state}>
      {(d) => (
        <div className="space-y-3">
        <AiInsightPanel title="AI table briefing" resetKey={name} run={(o) => services.ai.briefTable(name, o)} />
        <Card>
          <CardHeader
            title={<span className="font-mono">{d.table.name}</span>}
            subtitle={`${d.table.system === 'TRAQ' ? 'TRAQ (target)' : 'CrisMac / source feed'} · layer ${d.table.layer}${d.table.structureFrom ? ` · structure from ${d.table.structureFrom}` : ''}`}
            right={(
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <Badge tone="info">{d.table.listedColumns} listed cols</Badge>
                {d.table.declaredColumns !== undefined && <Badge>{d.table.declaredColumns} declared</Badge>}
                <Link to={`/lineage?table=${encodeURIComponent(d.table.name)}`} className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-surface2">Lineage</Link>
                <Link to={`/mapping?table=${encodeURIComponent(d.table.name)}`} className="rounded border border-border px-2 py-0.5 text-[11px] text-primary hover:bg-surface2">Mapping</Link>
              </div>
            )}
          />
          <div className="space-y-2 border-b border-border p-3 text-xs text-muted">
            <div><span className="font-medium text-fg">Primary key:</span> {d.primaryKey.length ? d.primaryKey.join(', ') : 'Not stated in workbook'}</div>
            {d.notes.map((n) => <div key={n}>• {n}</div>)}
            {d.banner && <details><summary className="cursor-pointer">Sheet banner (verbatim)</summary><p className="mt-1 whitespace-pre-wrap">{d.banner}</p></details>}
          </div>
          <DataTable<ColumnDetail>
            rows={d.columns} pageSize={20} rowKey={(r) => r.name} empty="No column list is provided in the workbook for this table."
            columns={([
              { key: 'n', header: 'Column', render: (r) => <span className="font-mono text-xs">{r.name}</span> },
              { key: 't', header: 'Type', render: (r) => <span className="font-mono text-xs">{r.dataType || '-'}</span> },
              { key: 'nl', header: 'Null', render: (r) => (r.nullable === null ? '-' : r.nullable ? 'NULL' : <Badge tone="warn">NOT NULL</Badge>) },
              { key: 'f', header: 'Fed by', render: (r) => (r.traqOnly ? <Badge>no CrisMac source</Badge> : r.feeds.length ? <div className="space-y-0.5 text-xs">{r.feeds.slice(0, 3).map((f, i) => <div key={i}><span className="font-mono">{f.sourceTable || '(constant)'}{f.sourceColumn ? `.${f.sourceColumn}` : ''}</span> <Badge>{f.mapType || '—'}</Badge></div>)}</div> : <Badge tone={r.isFed ? 'ok' : 'bad'}>{r.isFed ? 'fed' : 'unfed'}</Badge>) },
              { key: 'u', header: 'Used by', render: (r) => <span className="text-xs">{r.usedBy.slice(0, 3).map((u) => `${u.targetTable}.${u.targetColumn}`).join(', ')}</span> },
            ] as Column<ColumnDetail>[])}
          />
        </Card>
        </div>
      )}
    </AsyncView>
  );
}

function RelationshipsPanel({ name, onOpen }: { name: string; onOpen: (t: string) => void }) {
  const state = useAsync(() => (name ? services.dataModel.getRelationships(name) : noResult<Relationship[]>('Select a table.')), [name]);
  if (!name) return <Card className="p-8 text-center text-sm text-muted">Select a table from the list to see its documented relationships.</Card>;
  return (
    <Card>
      <CardHeader
        title={<>Relationships of <span className="font-mono">{name}</span></>}
        subtitle="Derived from LOOKUP / JOIN mapping rows. The workbook states no physical foreign keys."
        right={<OriginBadge meta={state.meta} />}
      />
      <AsyncView state={state} isEmpty={(d) => d.length === 0} emptyMessage="No LOOKUP/JOIN mappings reference this table in the workbook.">
        {(rows) => (
          <DataTable<Relationship>
            rows={rows} rowKey={(r) => r.id} pageSize={15}
            columns={[
              { key: 'f', header: 'From (column)', render: (r) => <button className="font-mono text-xs text-primary hover:underline" onClick={() => onOpen(r.fromTable)}>{r.fromTable}.{r.fromColumn}</button> },
              { key: 't', header: 'Resolves via', render: (r) => <button className="font-mono text-xs text-primary hover:underline" onClick={() => onOpen(r.toTable)}>{r.toTable}.{r.toColumn}</button> },
              { key: 'k', header: 'Kind', render: (r) => <Badge>{r.kind}</Badge> },
              { key: 'r', header: 'Remark', render: (r) => <span className={`text-xs text-muted${r.remark.length > 140 ? ' cursor-help underline decoration-dotted underline-offset-2' : ''}`} title={r.remark ? `${r.remark} (${r.sheet} row ${r.rowNo})` : `${r.sheet} row ${r.rowNo}`}>{r.remark.length > 140 ? `${r.remark.slice(0, 140)}...` : r.remark}</span> },
            ]}
          />
        )}
      </AsyncView>
    </Card>
  );
}

function ComparePanel({ initialTarget }: { initialTarget: string }) {
  const tables = useAsync(() => services.dataModel.listTables(), []);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState(initialTarget);
  const ready = !!source && !!target;
  const cmp = useAsync(() => (ready ? services.dataModel.compare(source, target) : noResult<TableComparison>('Choose a source and a target table.')), [source, target]);
  return (
    <Card>
      <CardHeader title="Compare source and target" subtitle="Shows documented mappings between the two tables, with type compatibility" />
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <AsyncView state={tables}>
          {(rows) => (
            <>
              <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-64">
                <option value="">Source table...</option>
                {rows.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
              <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-64">
                <option value="">Target table...</option>
                {rows.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </Select>
            </>
          )}
        </AsyncView>
      </div>
      {!ready ? <div className="p-6 text-center text-sm text-muted">Choose a source and a target table.</div> : (
        <AsyncView state={cmp}>
          {(d) => (
            <div>
              <div className="grid grid-cols-2 gap-3 p-3 text-xs">
                <div><span className="font-mono font-medium">{d.source.name}</span><div className="text-muted">{d.source.listedColumns} columns</div></div>
                <div><span className="font-mono font-medium">{d.target.name}</span><div className="text-muted">{d.target.listedColumns} columns</div></div>
              </div>
              <DataTable<ComparePair>
                rows={d.pairs} rowKey={(r) => `${r.sourceColumn}>${r.targetColumn}`} empty="The workbook documents no mapping between these two tables."
                columns={[
                  { key: 's', header: 'Source column', render: (r) => <span className="font-mono text-xs">{r.sourceColumn || '(none)'} <span className="text-muted">{r.sourceType}</span></span> },
                  { key: 't', header: 'Target column', render: (r) => <span className="font-mono text-xs">{r.targetColumn} <span className="text-muted">{r.targetType}</span></span> },
                  { key: 'm', header: 'Map type', render: (r) => <Badge>{r.mapType || '—'}</Badge> },
                  { key: 'c', header: 'Compatibility', render: (r) => <span className={r.note ? 'cursor-help' : ''} title={r.note}><Badge tone={compatTone[r.compat as CompatLevel]}>{r.compat}</Badge></span> },
                ]}
              />
              <div className="grid gap-3 border-t border-border p-3 text-xs md:grid-cols-2">
                <div><div className="mb-1 font-medium">Source columns not used ({d.unusedSourceColumns.length})</div><div className="max-h-32 overflow-auto font-mono text-muted">{d.unusedSourceColumns.join(', ') || '—'}</div></div>
                <div><div className="mb-1 font-medium">Target columns not fed by this source ({d.unfedTargetColumns.length})</div><div className="max-h-32 overflow-auto font-mono text-muted">{d.unfedTargetColumns.join(', ') || '—'}</div></div>
              </div>
            </div>
          )}
        </AsyncView>
      )}
    </Card>
  );
}

function ScopePanel() {
  const state = useAsync(() => services.dataModel.getScope(), []);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  async function download() {
    setExporting(true);
    setExportError('');
    const res = await services.dataModel.exportMetadata();
    setExporting(false);
    if (res.error || !res.data) { setExportError(res.error?.message ?? 'Export failed'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crismac-traq-metadata.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <AsyncView state={state}>
      {(d) => (
        <div className="space-y-3">
          <Card>
            <CardHeader
              title="Parsed from workbook"
              subtitle="The structured metadata every agent uses"
              right={<Button size="sm" variant="outline" onClick={download} disabled={exporting}><Download size={13} /> {exporting ? 'Preparing...' : 'Download metadata JSON'}</Button>}
            />
            {exportError && <div className="px-3 pt-2 text-xs text-bad">{exportError}</div>}
            <div className="grid grid-cols-2 gap-3 p-3 text-sm md:grid-cols-4">
              <div><div className="text-muted text-xs">TRAQ tables</div><div className="text-lg font-semibold">{d.counts.traqTables}</div></div>
              <div><div className="text-muted text-xs">Source tables/feeds</div><div className="text-lg font-semibold">{d.counts.sourceTables}</div></div>
              <div><div className="text-muted text-xs">Distinct columns</div><div className="text-lg font-semibold">{d.counts.columns.toLocaleString()}</div></div>
              <div><div className="text-muted text-xs">Mapping rows</div><div className="text-lg font-semibold">{d.counts.mappings.toLocaleString()}</div></div>
            </div>
            <div className="border-t border-border p-3 text-xs"><span className="font-medium">Out of scope (downstream of FCT_PRODUCT_MASTER):</span> <span className="font-mono text-muted">{d.outOfScope.join(', ')}</span></div>
          </Card>
          <Card>
            <CardHeader title="Known gaps in the workbook" subtitle="Never filled in by the application" />
            <ul className="space-y-1.5 p-3 text-xs">{d.gaps.map((g) => <li key={g}>• {g}</li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Sheets in scope" />
            <DataTable rows={d.inScopeSheets} rowKey={(s) => s.name} pageSize={12}
              columns={[
                { key: 'n', header: 'Sheet', render: (s) => <span className="font-mono text-xs">{s.name}</span> },
                { key: 'k', header: 'Shape', render: (s) => <Badge>{s.kind}</Badge> },
                { key: 'r', header: 'Rows', className: 'text-right', render: (s) => s.rowCount },
              ]} />
          </Card>
        </div>
      )}
    </AsyncView>
  );
}
