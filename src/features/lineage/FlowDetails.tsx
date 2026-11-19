import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import type { EdgeGroup } from '@/domain/lineageFlow';
import type { FlowColumnEdge, FlowKind, LineageFlow } from '@/types';
import { ColumnTrace } from './ColumnTrace';
import { KIND_HINT, KIND_LABEL } from './flowStyle';

export type Pick =
  | { kind: 'none' }
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; column: string }
  | { kind: 'edge'; id: string };

const kindTone: Record<FlowKind, 'neutral' | 'primary' | 'info'> = { direct: 'neutral', transformed: 'primary', unspecified: 'info' };

export function KindBadge({ kind }: { kind: FlowKind }) {
  return <span title={KIND_HINT[kind]}><Badge tone={kindTone[kind]}>{KIND_LABEL[kind]}</Badge></span>;
}

export function FlowDetails({ flow, groups, pick, selected, onTable, onTrace, onAdd, className = 'max-h-[72vh] min-h-[22rem]' }: {
  flow: LineageFlow; groups: EdgeGroup[]; pick: Pick; selected: string[]; className?: string;
  onTable: (name: string) => void; onTrace: (tables: string[]) => void; onAdd: (name: string) => void;
}) {
  let body: ReactNode;
  let title: ReactNode = 'Details';
  let subtitle: ReactNode = 'Click anything in the graph';
  if (pick.kind === 'table') {
    title = <span className="font-mono">{pick.table}</span>;
    subtitle = 'Table';
    body = <TableBody flow={flow} table={pick.table} selected={selected} onTable={onTable} onTrace={onTrace} onAdd={onAdd} />;
  } else if (pick.kind === 'column') {
    title = <span className="font-mono">{pick.table}.{pick.column}</span>;
    subtitle = 'Column';
    body = <ColumnBody flow={flow} table={pick.table} column={pick.column} />;
  } else if (pick.kind === 'edge') {
    const g = groups.find((x) => x.id === pick.id);
    title = 'Connection';
    subtitle = g ? <span className="font-mono">{g.sourceTable} → {g.targetTable}</span> : undefined;
    body = g ? <EdgeBody flow={flow} group={g} /> : <p className="p-4 text-sm text-muted">This connection is no longer in the graph.</p>;
  } else {
    body = <Overview flow={flow} />;
  }
  return (
    <Card className={`flex flex-col overflow-hidden ${className}`}>
      <CardHeader title={title} subtitle={subtitle} />
      <div key={`${pick.kind}:${'table' in pick ? pick.table : ''}:${'column' in pick ? pick.column : ''}:${'id' in pick ? pick.id : ''}`} className="anim-fade min-h-0 flex-1 overflow-auto">{body}</div>
    </Card>
  );
}

function Overview({ flow }: { flow: LineageFlow }) {
  const s = flow.stats;
  const total = s.direct + s.transformed + s.unspecified;
  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">What you are looking at</div>
        <p className="text-muted">{flow.tables.length} tables, {flow.tableEdges.length} table-to-table links and {total} column mappings. Data flows left to right: origins on the left, destinations on the right.</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Fact label="Upstream tables" value={s.upstream} hint="Tables that feed your selection" />
        <Fact label="Downstream tables" value={s.downstream} hint="Tables your selection feeds" />
        <Fact label="Direct copies" value={s.direct} hint={KIND_HINT.direct} />
        <Fact label="Transformed" value={s.transformed} hint={KIND_HINT.transformed} />
      </dl>
      {s.unspecified > 0 && <p className="text-xs text-muted">{s.unspecified} mappings have a blank MAP TYPE in the workbook, so they are not classed as direct or transformed.</p>}
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Next</div>
        <ul className="list-disc space-y-1 pl-4 text-muted">
          <li>Click a table to light up everything upstream (blue) and downstream (green) of it.</li>
          <li>Click a column row to trace it hop by hop.</li>
          <li>Click an arrow to read the transformation behind it.</li>
        </ul>
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-md border border-border p-2" title={hint}>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      <dt className="text-muted">{label}</dt>
    </div>
  );
}

function TableBody({ flow, table, selected, onTable, onTrace, onAdd }: {
  flow: LineageFlow; table: string; selected: string[];
  onTable: (n: string) => void; onTrace: (t: string[]) => void; onAdd: (n: string) => void;
}) {
  const t = flow.tables.find((x) => x.name === table);
  const incoming = flow.tableEdges.filter((e) => e.target === table);
  const outgoing = flow.tableEdges.filter((e) => e.source === table);
  return (
    <div className="space-y-4 p-4 text-sm">
      {t && (
        <p className="text-xs text-muted">
          {t.system} · {t.layer} layer · {t.columnCount || 'unknown number of'} columns · {t.columns.length} take part in this flow
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onTrace([table])} title="Replace the selection with just this table">Trace only this table</Button>
        {!selected.includes(table) && <Button size="sm" variant="outline" onClick={() => onAdd(table)} title="Add this table to the picker selection">Add to selection</Button>}
        <Link to={`/mapping?table=${encodeURIComponent(table)}`} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-surface2">Open in Mapping</Link>
      </div>
      <LinkList heading="Comes from" empty="Nothing upstream is documented: this is an origin." edges={incoming} pick={(e) => e.source} onTable={onTable} />
      <LinkList heading="Goes to" empty="Nothing downstream is documented in this view." edges={outgoing} pick={(e) => e.target} onTable={onTable} />
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Trace a column</div>
        <ColumnTrace key={table} table={table} />
      </div>
    </div>
  );
}

function LinkList({ heading, empty, edges, pick, onTable }: {
  heading: string; empty: string; edges: LineageFlow['tableEdges']; pick: (e: LineageFlow['tableEdges'][number]) => string; onTable: (n: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{heading}</div>
      {edges.length === 0 ? <p className="text-xs text-muted">{empty}</p> : (
        <ul className="space-y-1">
          {edges.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onTable(pick(e))} className="w-full rounded-md border border-border px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface2">
                <span className="font-mono font-medium">{pick(e)}</span>
                <span className="ml-2 text-muted">{e.count} column mapping{e.count === 1 ? '' : 's'}</span>
                {e.procedures.length > 0 && <span className="mt-0.5 block text-[11px] text-muted">Mentioned with: {e.procedures.map((p) => p.name).join(', ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnBody({ flow, table, column }: { flow: LineageFlow; table: string; column: string }) {
  const touching = flow.columnEdges.filter((e) =>
    (e.sourceTable === table && e.sourceColumn === column) || (e.targetTable === table && e.targetColumn === column));
  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Mappings in this view</div>
        {touching.length === 0 ? <p className="text-xs text-muted">No mapping in the current view touches this column.</p> : <MappingList items={touching} />}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Full trace</div>
        <ColumnTrace key={`${table}.${column}`} table={table} initialColumn={column} />
      </div>
    </div>
  );
}

function EdgeBody({ flow, group }: { flow: LineageFlow; group: EdgeGroup }) {
  const te = flow.tableEdges.find((e) => e.source === group.sourceTable && e.target === group.targetTable);
  return (
    <div className="space-y-3 p-4 text-sm">
      <p className="text-xs text-muted">{group.items.length} column mapping{group.items.length === 1 ? '' : 's'} on this arrow. Data moves from {group.sourceTable} into {group.targetTable}.</p>
      {te && te.procedures.length > 0 && (
        <p className="text-xs text-muted" title="The workbook text mentions these objects together with both tables. This is a name match, not a documented link.">
          Mentioned together with these tables: {te.procedures.map((p) => p.name).join(', ')}
        </p>
      )}
      <MappingList items={group.items} />
    </div>
  );
}

function MappingList({ items }: { items: FlowColumnEdge[] }) {
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.id} className="rounded-md border border-border p-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono">
            <span title="Source table and column"><span className="text-muted">{m.sourceTable}.</span>{m.sourceColumn || <em className="not-italic text-muted">(no source column)</em>}</span>
            <ArrowRight size={12} className="shrink-0 text-muted" aria-label="flows into" />
            <span title="Target table and column"><span className="text-muted">{m.targetTable}.</span>{m.targetColumn}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <KindBadge kind={m.kind} />
            {m.mapType && <Badge>{m.mapType}</Badge>}
          </div>
          <div className="mt-1.5">
            <div className="text-[11px] font-medium text-muted">Transformation logic</div>
            <div className="whitespace-pre-wrap break-words">{m.transformation || (m.kind === 'direct' ? 'Copied as is (no remark in the workbook).' : 'Not provided in workbook')}</div>
          </div>
          <div className="mt-1.5 text-[11px] text-muted">Source: sheet {m.sheet}, row {m.rowNo}</div>
        </li>
      ))}
    </ul>
  );
}
