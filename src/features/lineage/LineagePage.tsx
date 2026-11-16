import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactFlow, { Background, Controls, MarkerType, MiniMap, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { AsyncView, Badge, Card, CardHeader, DataTable, OriginBadge, PageHeader, Select, Tabs } from '@/components/ui';
import { reachable } from '@/domain/lineage';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { LineageGraph, TraceNode } from '@/types';

const LAYER_COLOR: Record<string, string> = {
  CRISMAC: '#64748b', RECEPTION: '#0ea5e9', STAGING: '#d97706', MART: '#4f46e5', APP: '#16a34a', DI: '#db2777',
};

export function LineagePage() {
  const [internalOnly, setInternalOnly] = useState(false);
  const [includeNotUsed, setIncludeNotUsed] = useState(false);
  const [params] = useSearchParams();
  const [selectedNode, setSelectedNode] = useState(params.get('table') ?? '');
  const [selectedEdge, setSelectedEdge] = useState<{ source: string; target: string } | null>(null);
  const graph = useAsync(() => services.lineage.getGraph({ internalOnly, includeNotUsed }), [internalOnly, includeNotUsed]);

  return (
    <div>
      <PageHeader
        title="Agent 2 · Data Flow & Lineage"
        description="Table-level lineage aggregated from documented mapping rows, left to right from source feeds to FCT_PRODUCT_MASTER. Click a table to highlight its upstream and downstream path; click an edge to see column mappings."
        right={<OriginBadge meta={graph.meta} />}
      />
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={internalOnly} onChange={(e) => setInternalOnly(e.target.checked)} /> Internal TRAQ flow only (hide CrisMac sources)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeNotUsed} onChange={(e) => setIncludeNotUsed(e.target.checked)} /> Show NOT USED (dictionary-only) links</label>
        <div className="ml-auto flex flex-wrap gap-2">
          {Object.entries(LAYER_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1 text-xs text-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{k}</span>)}
        </div>
      </div>
      <AsyncView state={graph} isEmpty={(g) => g.nodes.length === 0} emptyMessage="No lineage edges found in the workbook for these options.">
        {(g) => (
          <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
            <GraphCanvas graph={g} selectedNode={selectedNode} onNode={(id) => { setSelectedNode(id); setSelectedEdge(null); }} onEdge={(s, t) => setSelectedEdge({ source: s, target: t })} />
            <DetailPanel table={selectedNode} edge={selectedEdge} />
          </div>
        )}
      </AsyncView>
    </div>
  );
}

function GraphCanvas({ graph, selectedNode, onNode, onEdge }: {
  graph: LineageGraph; selectedNode: string; onNode: (id: string) => void; onEdge: (s: string, t: string) => void;
}) {
  const focus = useMemo(() => (selectedNode ? reachable(graph, selectedNode) : null), [graph, selectedNode]);
  const nodes: Node[] = useMemo(() => graph.nodes.map((n) => {
    const dim = focus && !focus.nodes.has(n.id);
    return {
      id: n.id,
      position: { x: n.rank * 320, y: n.row * 62 },
      data: { label: `${n.label}` },
      style: {
        width: 240, fontSize: 11, padding: 6, borderRadius: 6, color: 'var(--fg)', background: 'var(--surface)',
        border: `${n.id === selectedNode ? 3 : 1.5}px solid ${LAYER_COLOR[n.layer] ?? '#64748b'}`, opacity: dim ? 0.25 : 1,
      },
    };
  }), [graph, focus, selectedNode]);
  const edges: Edge[] = useMemo(() => graph.edges.map((e) => {
    const dim = focus && !focus.edges.has(e.id);
    return {
      id: e.id, source: e.source, target: e.target, label: String(e.count),
      animated: !!focus && focus.edges.has(e.id),
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeDasharray: e.notUsedOnly ? '5 4' : undefined, opacity: dim ? 0.12 : 0.9, stroke: 'var(--muted)' },
      labelStyle: { fontSize: 10, fill: 'var(--muted)' },
    };
  }), [graph, focus]);
  return (
    <Card className="h-[72vh] overflow-hidden">
      <ReactFlow
        nodes={nodes} edges={edges} fitView minZoom={0.05} nodesDraggable nodesConnectable={false}
        onNodeClick={(_, n) => onNode(n.id)} onEdgeClick={(_, e) => onEdge(e.source, e.target)} onPaneClick={() => onNode('')}
      >
        <Background /><Controls showInteractive={false} /><MiniMap pannable zoomable />
      </ReactFlow>
    </Card>
  );
}

type PanelTab = 'columns' | 'edge';

function DetailPanel({ table, edge }: { table: string; edge: { source: string; target: string } | null }) {
  const [tab, setTab] = useState<PanelTab>('columns');
  const showEdge = !!edge;
  const active: PanelTab = showEdge ? 'edge' : tab;
  return (
    <Card className="h-[72vh] overflow-auto">
      <CardHeader title={showEdge ? 'Edge detail' : table ? <span className="font-mono">{table}</span> : 'Details'} subtitle={showEdge ? `${edge!.source} → ${edge!.target}` : 'Select a table or an edge'} />
      {showEdge ? <EdgePanel source={edge!.source} target={edge!.target} /> : table ? (
        <div>
          <Tabs<PanelTab> value={active} onChange={setTab} tabs={[{ id: 'columns', label: 'Column lineage' }]} />
          <ColumnTrace table={table} />
        </div>
      ) : <div className="p-6 text-center text-sm text-muted">Click a table node to trace a column, or an edge to inspect its mappings.</div>}
    </Card>
  );
}

function EdgePanel({ source, target }: { source: string; target: string }) {
  const state = useAsync(() => services.lineage.getEdgeMappings(source, target), [source, target]);
  return (
    <AsyncView state={state} isEmpty={(d) => d.length === 0}>
      {(rows) => (
        <DataTable rows={rows} rowKey={(m) => m.id} pageSize={12}
          columns={[
            { key: 's', header: 'Source', render: (m) => <span className="font-mono text-xs">{m.sourceColumn || '(none)'}</span> },
            { key: 't', header: 'Target', render: (m) => <span className="font-mono text-xs">{m.targetColumn || '(none)'}</span> },
            { key: 'm', header: 'Type', render: (m) => <Badge>{m.mapType || '—'}</Badge> },
            { key: 'r', header: 'Transformation / remark', render: (m) => <span className="text-xs text-muted" title={`${m.sheet} row ${m.rowNo}`}>{m.remark.length > 140 ? `${m.remark.slice(0, 140)}...` : m.remark || '—'}</span> },
          ]} />
      )}
    </AsyncView>
  );
}

function ColumnTrace({ table }: { table: string }) {
  const cols = useAsync(() => services.lineage.listColumns(table), [table]);
  const [column, setColumn] = useState('');
  const [direction, setDirection] = useState<'upstream' | 'downstream'>('upstream');
  const trace = useAsync(() => (column ? services.lineage.traceColumn(table, column, direction) : noResult<TraceNode>('Pick a column.')), [table, column, direction]);
  return (
    <div className="space-y-3 p-3">
      <div className="flex gap-2">
        <AsyncView state={cols} isEmpty={(c) => c.length === 0} emptyMessage="No column list for this table in the workbook.">
          {(c) => (
            <Select value={column} onChange={(e) => setColumn(e.target.value)} className="min-w-0 flex-1">
              <option value="">Select a column...</option>
              {c.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          )}
        </AsyncView>
        <Select value={direction} onChange={(e) => setDirection(e.target.value as 'upstream' | 'downstream')}>
          <option value="upstream">Upstream</option><option value="downstream">Downstream</option>
        </Select>
      </div>
      {column && (
        <AsyncView state={trace}>
          {(t) => (t.children.length === 0
            ? <div className="text-xs text-muted">No documented {direction} mapping for this column in the workbook.</div>
            : <TraceTree node={t} depth={0} />)}
        </AsyncView>
      )}
    </div>
  );
}

function TraceTree({ node, depth }: { node: TraceNode; depth: number }) {
  return (
    <div className={depth ? 'ml-4 border-l border-border pl-3' : ''}>
      <div className="py-1 text-xs">
        <span className="font-mono">{node.table}.{node.column}</span>{' '}
        {node.mapType !== undefined && <Badge>{node.mapType || '—'}</Badge>}
        {node.remark && <div className="mt-0.5 text-[11px] text-muted" title={`${node.sheet} row ${node.rowNo}`}>{node.remark.length > 160 ? `${node.remark.slice(0, 160)}...` : node.remark}</div>}
      </div>
      {node.children.map((c, i) => <TraceTree key={`${c.table}.${c.column}.${i}`} node={c} depth={depth + 1} />)}
    </div>
  );
}
