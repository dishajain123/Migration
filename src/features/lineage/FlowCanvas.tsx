import { Expand, LayoutGrid, Maximize2, Minimize2, Shrink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background, Controls, MarkerType, MiniMap, Panel, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Edge, type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from '@/components/ui';
import { focusPath, layoutFlow, nodeHeight, type EdgeGroup } from '@/domain/lineageFlow';
import type { LineageFlow } from '@/types';
import { EDGE_COLOR, LAYER_COLOR, ROW_CAP } from './flowStyle';
import { handleId, TableNode, type NodeEmphasis, type TableNodeData } from './TableNode';

const nodeTypes = { table: TableNode };
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export interface CanvasProps {
  flow: LineageFlow;
  groups: EdgeGroup[];
  visible: Map<string, string[]>;
  collapsed: Set<string>;
  showAll: Set<string>;
  focus: string;
  activeColumn: { table: string; column: string } | null;
  selectedEdge: string;
  arrangeTick: number;
  /** Bumped when the container size changes (fullscreen on/off) so the graph is re-fitted without losing positions. */
  fitTick: number;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggle: (name: string) => void;
  onShowAll: (name: string) => void;
  onTable: (name: string) => void;
  onColumn: (table: string, column: string) => void;
  onEdge: (id: string) => void;
  onPane: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onArrange: () => void;
}

export function FlowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

function Inner(p: CanvasProps) {
  const { flow, groups, visible, collapsed, showAll, focus, activeColumn, selectedEdge, arrangeTick } = p;
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { fitView } = useReactFlow();
  const dragged = useRef(new Map<string, { x: number; y: number }>());

  // Manual drag positions are forgotten whenever the structure changes or the user asks for auto-arrange.
  useEffect(() => { dragged.current.clear(); }, [flow, collapsed, showAll, arrangeTick]);

  const heights = useMemo(() => {
    const h = new Map<string, number>();
    for (const t of flow.tables) {
      const rows = visible.get(t.name)?.length ?? 0;
      const expanded = !collapsed.has(t.name);
      const more = expanded && (t.columns.length > rows || (showAll.has(t.name) && t.columns.length > ROW_CAP));
      h.set(t.name, nodeHeight(rows, more));
    }
    return h;
  }, [flow, visible, collapsed, showAll]);

  const layout = useMemo(() => layoutFlow(flow.tables, flow.tableEdges, (n) => heights.get(n) ?? 46), [flow, heights]);
  const path = useMemo(() => (focus && flow.tables.some((t) => t.name === focus) ? focusPath(flow.tableEdges, focus) : null), [flow, focus]);

  useEffect(() => {
    setNodes(flow.tables.map((t): Node<TableNodeData> => {
      const emphasis: NodeEmphasis = !path ? 'none' : t.name === focus ? 'focus' : path.upstream.has(t.name) ? 'upstream' : path.downstream.has(t.name) ? 'downstream' : 'dim';
      const cols = visible.get(t.name) ?? [];
      return {
        id: t.name,
        type: 'table',
        position: dragged.current.get(t.name) ?? layout.get(t.name) ?? { x: 0, y: 0 },
        data: {
          table: t, expanded: !collapsed.has(t.name), showAll: showAll.has(t.name), visibleColumns: cols,
          hiddenCount: Math.max(0, t.columns.length - cols.length), emphasis,
          activeColumn: activeColumn?.table === t.name ? activeColumn.column : '',
          onToggle: p.onToggle, onShowAll: p.onShowAll, onColumn: p.onColumn,
        },
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, layout, visible, collapsed, showAll, path, focus, activeColumn, p.onToggle, p.onShowAll, p.onColumn, setNodes]);

  useEffect(() => {
    const labelTransforms = flow.columnEdges.length <= 40;
    setEdges(groups.map((g): Edge => {
      const tableEdge = `${g.sourceTable}=>${g.targetTable}`;
      const inPath = !path || path.edges.has(tableEdge);
      const isSelected = g.id === selectedEdge;
      let color: string = EDGE_COLOR[g.kind];
      if (path && inPath) {
        const upstreamSide = g.targetTable === focus || path.upstream.has(g.targetTable);
        color = upstreamSide ? EDGE_COLOR.upstream : EDGE_COLOR.downstream;
      }
      if (isSelected) color = EDGE_COLOR.selected;
      const label = g.items.length > 1 ? `${g.items.length} columns` : g.kind === 'transformed' && labelTransforms ? g.items[0].mapType : undefined;
      return {
        id: g.id,
        source: g.sourceTable, sourceHandle: handleId('s', g.sourceHandle),
        target: g.targetTable, targetHandle: handleId('t', g.targetHandle),
        label,
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: {
          stroke: color, strokeWidth: isSelected ? 3 : path && inPath ? 2 : 1.4,
          strokeDasharray: g.kind === 'transformed' ? '6 4' : g.kind === 'unspecified' ? '2 3' : undefined,
          opacity: inPath ? 1 : 0.08, transition: 'opacity 200ms, stroke-width 200ms',
        },
        labelStyle: { fontSize: 10, fill: 'var(--muted)' },
        labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        zIndex: isSelected ? 10 : inPath ? 2 : 0,
      };
    }));
  }, [groups, flow.columnEdges.length, path, focus, selectedEdge, setEdges]);

  // Re-frame the picture after the structure (not the highlight) changes.
  useEffect(() => {
    const id = window.setTimeout(() => { void fitView({ padding: 0.15, duration: reducedMotion() ? 0 : 300, maxZoom: 1.1 }); }, 150);
    return () => window.clearTimeout(id);
  }, [flow, collapsed, showAll, arrangeTick, p.fitTick, fitView]);

  const onDragStop = useCallback((_: unknown, n: Node) => { dragged.current.set(n.id, n.position); }, []);

  return (
    <div className="absolute inset-0" aria-label="Column-level data flow graph">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        fitView minZoom={0.05} maxZoom={1.6} nodesConnectable={false} elevateEdgesOnSelect
        onNodeDragStop={onDragStop}
        onNodeClick={(_, n) => p.onTable(n.id)}
        onEdgeClick={(_, e) => p.onEdge(e.id)}
        onPaneClick={p.onPane}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable zoomable
          nodeColor={(n) => LAYER_COLOR[(n.data as TableNodeData | undefined)?.table.layer ?? ''] ?? '#64748b'}
        />
        <Panel position="top-left" className="flex max-w-[calc(100%-7rem)] flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={p.onArrange} title="Re-run the automatic layout and fit the graph to the screen"><LayoutGrid size={13} /> Auto-arrange</Button>
          <Button variant="outline" size="sm" onClick={p.onCollapseAll} title="Hide all column rows so only table names remain"><Minimize2 size={13} /> Collapse all</Button>
          <Button variant="outline" size="sm" onClick={p.onExpandAll} title="Show the columns that take part in the flow"><Maximize2 size={13} /> Expand all</Button>
        </Panel>
        <Panel position="top-right">
          <Button
            variant={p.fullscreen ? 'default' : 'outline'} size="sm" onClick={p.onToggleFullscreen}
            aria-pressed={p.fullscreen} title={p.fullscreen ? 'Leave fullscreen (Esc)' : 'Show the diagram fullscreen'}
          >
            {p.fullscreen ? <><Shrink size={13} /> Exit fullscreen</> : <><Expand size={13} /> Fullscreen</>}
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
