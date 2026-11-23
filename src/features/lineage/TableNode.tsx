import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import { TABLE_HANDLE } from '@/domain/lineageFlow';
import { cn } from '@/lib/cn';
import type { FlowRole, FlowTable } from '@/types';
import { LAYER_COLOR, LAYER_LABEL } from './flowStyle';

export type NodeEmphasis = 'none' | 'focus' | 'upstream' | 'downstream' | 'dim';

export interface TableNodeData {
  table: FlowTable;
  expanded: boolean;
  showAll: boolean;
  visibleColumns: string[];
  hiddenCount: number;
  emphasis: NodeEmphasis;
  activeColumn: string;
  onToggle: (name: string) => void;
  onShowAll: (name: string) => void;
  onColumn: (table: string, column: string) => void;
}

const ROLE_TEXT: Record<FlowRole, string> = { selected: 'Selected', upstream: 'Feeds selection', downstream: 'Fed by selection' };
const RING: Record<NodeEmphasis, string> = {
  none: '', dim: 'opacity-30',
  focus: 'ring-2 ring-primary shadow-lg', upstream: 'ring-2 ring-sky-500', downstream: 'ring-2 ring-green-600',
};

export const handleId = (kind: 's' | 't', column: string) => `${kind}:${column}`;

function TableNodeView({ id, data }: NodeProps<TableNodeData>) {
  const { table, expanded, showAll, visibleColumns, hiddenCount, emphasis, activeColumn, onToggle, onShowAll, onColumn } = data;
  const update = useUpdateNodeInternals();
  // Rows appear/disappear when the node expands or shows all columns: tell React Flow to re-measure the handles.
  useEffect(() => { update(id); }, [id, expanded, showAll, visibleColumns.length, update]);
  const color = LAYER_COLOR[table.layer] ?? '#64748b';
  return (
    <div
      className={cn('w-[280px] rounded-lg border border-border bg-surface text-fg shadow-sm transition-[opacity,box-shadow] duration-200', RING[emphasis])}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="relative flex h-[46px] items-center gap-2 px-2.5">
        <Handle type="target" position={Position.Left} id={handleId('t', TABLE_HANDLE)} />
        <button
          type="button"
          className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface2"
          aria-label={expanded ? `Collapse ${table.name}` : `Expand ${table.name}`}
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); onToggle(table.name); }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] font-semibold" title={table.name}>{table.name}</div>
          <div className="truncate text-[10px] text-muted">
            {LAYER_LABEL[table.layer] ?? table.layer} · {table.columns.length} of {table.columnCount || '?'} columns shown
          </div>
        </div>
        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', table.role === 'selected' ? 'bg-primarybg text-primary' : 'bg-surface2 text-muted')}>
          {ROLE_TEXT[table.role]}
        </span>
        <Handle type="source" position={Position.Right} id={handleId('s', TABLE_HANDLE)} />
      </div>
      {expanded && (visibleColumns.length > 0 || hiddenCount > 0) && (
        <div className="border-t border-border pb-1.5">
          {visibleColumns.map((c) => (
            <div
              key={c}
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onColumn(table.name, c); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onColumn(table.name, c); } }}
              className={cn(
                'nodrag relative flex h-6 cursor-pointer items-center px-3 font-mono text-[11px] transition-colors hover:bg-surface2',
                activeColumn === c && 'bg-primarybg text-primary',
              )}
              title={c}
            >
              <Handle type="target" position={Position.Left} id={handleId('t', c)} />
              <span className="truncate">{c}</span>
              <Handle type="source" position={Position.Right} id={handleId('s', c)} />
            </div>
          ))}
          {(hiddenCount > 0 || showAll) && (
            <button
              type="button"
              className="nodrag mx-2 mt-1 h-[22px] rounded px-2 text-[11px] text-primary hover:bg-surface2"
              onClick={(e) => { e.stopPropagation(); onShowAll(table.name); }}
            >
              {showAll ? 'Show fewer columns' : `+${hiddenCount} more columns · show all`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeView);
