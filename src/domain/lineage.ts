import type {
  LineageEdge, LineageGraph, LineageNode, LineageOptions, MappingRow, TraceNode, WorkbookModel,
} from '@/types';
import { NONFEED } from './constants';
import { memo } from './memo';
import { isFeeding, mappingsBySource, mappingsByTarget, colKey, tableByName } from './selectors';

export function buildLineage(model: WorkbookModel, opts: LineageOptions): LineageGraph {
  return memo(model, `lineage:${opts.includeNotUsed}:${opts.internalOnly}`, () => {
    const tmap = tableByName(model);
    const edgeMap = new Map<string, LineageEdge>();
    for (const m of model.mappings) {
      if (!m.sourceTable || !m.targetTable || m.sourceTable === m.targetTable) continue;
      const mt = m.mapType.toUpperCase();
      const notUsed = mt === 'NOT USED';
      if (NONFEED.has(mt) && !notUsed) continue;
      if (notUsed && !opts.includeNotUsed) continue;
      if (opts.internalOnly && tmap.get(m.sourceTable)?.system !== 'TRAQ') continue;
      const id = `${m.sourceTable}=>${m.targetTable}`;
      let e = edgeMap.get(id);
      if (!e) {
        e = { id, source: m.sourceTable, target: m.targetTable, count: 0, mapTypes: {}, notUsedOnly: true };
        edgeMap.set(id, e);
      }
      e.count += 1;
      const label = m.mapType || 'UNSPECIFIED';
      e.mapTypes[label] = (e.mapTypes[label] ?? 0) + 1;
      if (!notUsed) e.notUsedOnly = false;
    }
    const edges = Array.from(edgeMap.values());
    const names = new Set<string>();
    for (const e of edges) { names.add(e.source); names.add(e.target); }
    const rank = new Map<string, number>(Array.from(names, (n) => [n, 0]));
    for (let i = 0; i < names.size + 1; i++) {
      let changed = false;
      for (const e of edges) {
        const next = Math.min(12, (rank.get(e.source) ?? 0) + 1);
        if (next > (rank.get(e.target) ?? 0)) { rank.set(e.target, next); changed = true; }
      }
      if (!changed) break;
    }
    const rowCounter = new Map<number, number>();
    const nodes: LineageNode[] = Array.from(names)
      .sort((a, b) => (rank.get(a)! - rank.get(b)!) || a.localeCompare(b))
      .map((n) => {
        const r = rank.get(n) ?? 0;
        const row = rowCounter.get(r) ?? 0;
        rowCounter.set(r, row + 1);
        const t = tmap.get(n);
        return {
          id: n, label: n, system: t?.system ?? 'CrisMac', layer: t?.layer ?? 'CRISMAC', rank: r, row,
          columnCount: t?.columns.length ?? 0,
        };
      });
    return { nodes, edges };
  });
}

/** Ids of nodes upstream and downstream of a node, and the edges between them. */
export function reachable(graph: LineageGraph, nodeId: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();
  const walk = (dir: 'up' | 'down') => {
    const stack = [nodeId];
    const seen = new Set<string>([nodeId]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of graph.edges) {
        const hit = dir === 'up' ? e.target === cur : e.source === cur;
        if (!hit) continue;
        edges.add(e.id);
        const nxt = dir === 'up' ? e.source : e.target;
        nodes.add(nxt);
        if (!seen.has(nxt)) { seen.add(nxt); stack.push(nxt); }
      }
    }
  };
  walk('up');
  walk('down');
  return { nodes, edges };
}

export function edgeMappings(model: WorkbookModel, source: string, target: string): MappingRow[] {
  return model.mappings.filter((m) => m.sourceTable === source && m.targetTable === target);
}

export function traceColumn(
  model: WorkbookModel, table: string, column: string, direction: 'upstream' | 'downstream', maxDepth = 5,
): TraceNode {
  const byTarget = mappingsByTarget(model);
  const bySource = mappingsBySource(model);
  const build = (t: string, c: string, depth: number, path: Set<string>, via?: MappingRow): TraceNode => {
    const node: TraceNode = {
      table: t, column: c, mapType: via?.mapType, remark: via?.remark, sheet: via?.sheet, rowNo: via?.rowNo, children: [],
    };
    const key = colKey(t, c);
    if (depth >= maxDepth || path.has(key)) return node;
    const next = new Set(path);
    next.add(key);
    if (direction === 'upstream') {
      for (const m of byTarget.get(key) ?? []) {
        if (!isFeeding(m) || !m.sourceTable) continue;
        if (m.sourceColumns.length === 0) {
          node.children.push({ table: m.sourceTable, column: '(no source column - constant/derived)', mapType: m.mapType, remark: m.remark, sheet: m.sheet, rowNo: m.rowNo, children: [] });
        } else {
          for (const sc of m.sourceColumns) node.children.push(build(m.sourceTable, sc, depth + 1, next, m));
        }
      }
    } else {
      for (const m of bySource.get(key) ?? []) {
        if (!isFeeding(m)) continue;
        node.children.push(build(m.targetTable, m.targetColumn, depth + 1, next, m));
      }
    }
    return node;
  };
  return build(table, column, 0, new Set());
}
