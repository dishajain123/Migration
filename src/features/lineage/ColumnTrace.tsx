import { useState } from 'react';
import { AsyncView, Badge, Select } from '@/components/ui';
import { noResult, useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import type { TraceNode } from '@/types';

/** Full multi-hop trace of one column through the mapping rows (not limited to the tables currently drawn). */
export function ColumnTrace({ table, initialColumn = '' }: { table: string; initialColumn?: string }) {
  const cols = useAsync(() => services.lineage.listColumns(table), [table]);
  const [column, setColumn] = useState(initialColumn);
  const [direction, setDirection] = useState<'upstream' | 'downstream'>('upstream');
  const trace = useAsync(
    () => (column ? services.lineage.traceColumn(table, column, direction) : noResult<TraceNode>('Pick a column.')),
    [table, column, direction],
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <AsyncView state={cols} isEmpty={(c) => c.length === 0} emptyMessage="No column list for this table in the workbook.">
          {(c) => (
            <Select value={column} onChange={(e) => setColumn(e.target.value)} className="min-w-0 flex-1" aria-label="Column to trace">
              <option value="">Select a column...</option>
              {c.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          )}
        </AsyncView>
        <Select value={direction} onChange={(e) => setDirection(e.target.value as 'upstream' | 'downstream')} aria-label="Trace direction">
          <option value="upstream">Where it comes from</option>
          <option value="downstream">Where it goes</option>
        </Select>
      </div>
      {!column && <p className="text-xs text-muted">Choose a column to see every mapping step behind it, hop by hop.</p>}
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

const MAX_INDENT_DEPTH = 4;

function TraceTree({ node, depth }: { node: TraceNode; depth: number }) {
  return (
    <div className={depth === 0 ? '' : depth <= MAX_INDENT_DEPTH ? 'ml-4 border-l border-border pl-3' : 'border-l border-border pl-1'}>
      <div className="py-1 text-xs">
        <span className="font-mono">{node.table}.{node.column}</span>{' '}
        {node.mapType !== undefined && <Badge>{node.mapType || '—'}</Badge>}
        {node.remark && <div className="mt-0.5 text-[11px] text-muted" title={`${node.sheet} row ${node.rowNo}`}>{node.remark.length > 160 ? `${node.remark.slice(0, 160)}...` : node.remark}</div>}
      </div>
      {node.children.map((c, i) => <TraceTree key={`${c.table}.${c.column}.${i}`} node={c} depth={depth + 1} />)}
    </div>
  );
}
