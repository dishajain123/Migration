import type {
  CatalogEntry, FlowColumnEdge, FlowKind, FlowRequest, FlowRole, FlowTable, FlowTableEdge, LineageEdge, LineageFlow,
  LineageGraph, LineageOptions, MappingRow, WorkbookModel,
} from '@/types';
import { NONFEED } from './constants';
import { buildLineage } from './lineage';
import { memo } from './memo';
import { buildCatalogue } from './procedures';
import { tableByName } from './selectors';

/*
 * Pure logic for the Agent 2 flow explorer: which tables to show for a selection, which column mappings connect them,
 * and where to place them. Nothing here touches React. Everything is derived from workbook mapping rows.
 */

// ---------- traversal ----------
interface Adjacency { up: Map<string, LineageEdge[]>; down: Map<string, LineageEdge[]> }

function adjacency(graph: LineageGraph): Adjacency {
  const up = new Map<string, LineageEdge[]>();
  const down = new Map<string, LineageEdge[]>();
  for (const e of graph.edges) {
    up.set(e.target, [...(up.get(e.target) ?? []), e]);
    down.set(e.source, [...(down.get(e.source) ?? []), e]);
  }
  return { up, down };
}

interface Walk { nodes: Set<string>; edges: Set<string> }

/** Breadth-first walk from `start`. depth 0 = unlimited. Start nodes are not in the returned node set. */
function walk(start: string[], dir: 'up' | 'down', depth: number, adj: Adjacency): Walk {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const seen = new Set<string>(start);
  let frontier = start;
  for (let d = 1; (depth === 0 || d <= depth) && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of (dir === 'up' ? adj.up : adj.down).get(cur) ?? []) {
        edges.add(e.id);
        const other = dir === 'up' ? e.source : e.target;
        if (seen.has(other)) continue;
        seen.add(other);
        nodes.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return { nodes, edges };
}

export interface TableTrace { selected: string[]; upstream: Set<string>; downstream: Set<string>; edges: Set<string>; untraceable: string[] }

export function traceTables(
  graph: LineageGraph, tables: string[], upstream: boolean, downstream: boolean, depth: number,
): TableTrace {
  const present = new Set(graph.nodes.map((n) => n.id));
  const selected = tables.filter((t) => present.has(t));
  const untraceable = tables.filter((t) => !present.has(t));
  const adj = adjacency(graph);
  const up = upstream ? walk(selected, 'up', depth, adj) : { nodes: new Set<string>(), edges: new Set<string>() };
  const down = downstream ? walk(selected, 'down', depth, adj) : { nodes: new Set<string>(), edges: new Set<string>() };
  const sel = new Set(selected);
  const upstreamOnly = new Set(Array.from(up.nodes).filter((n) => !sel.has(n)));
  const downstreamOnly = new Set(Array.from(down.nodes).filter((n) => !sel.has(n) && !upstreamOnly.has(n)));
  return { selected, upstream: upstreamOnly, downstream: downstreamOnly, edges: new Set([...up.edges, ...down.edges]), untraceable };
}

/** Tables in the lineage graph with how much sits upstream and downstream of each (for the picker). */
export function tableCatalog(model: WorkbookModel, opts: LineageOptions): CatalogEntry[] {
  return memo(model, `flowCatalog:${opts.includeNotUsed}:${opts.internalOnly}`, () => {
    const graph = buildLineage(model, opts);
    const adj = adjacency(graph);
    return graph.nodes.map((n) => ({
      name: n.id, system: n.system, layer: n.layer, columnCount: n.columnCount,
      upstreamCount: walk([n.id], 'up', 0, adj).nodes.size,
      downstreamCount: walk([n.id], 'down', 0, adj).nodes.size,
      directSources: adj.up.get(n.id)?.length ?? 0,
    })).sort((a, b) => a.name.localeCompare(b.name));
  });
}

// ---------- column edges ----------
export function flowKind(mapType: string): FlowKind {
  const t = mapType.trim().toUpperCase();
  if (!t) return 'unspecified';
  return t === 'DIRECT' || t === 'RENAME' ? 'direct' : 'transformed';
}

function columnEdges(model: WorkbookModel, visibleEdges: Set<string>, opts: LineageOptions): FlowColumnEdge[] {
  const out: FlowColumnEdge[] = [];
  for (const m of model.mappings) {
    if (!m.sourceTable || !m.targetTable || !m.targetColumn || m.sourceTable === m.targetTable) continue;
    if (!visibleEdges.has(`${m.sourceTable}=>${m.targetTable}`)) continue;
    const mt = m.mapType.toUpperCase();
    const notUsed = mt === 'NOT USED';
    if (NONFEED.has(mt) && !(notUsed && opts.includeNotUsed)) continue;
    const sources = m.sourceColumns.length > 0 ? m.sourceColumns : [''];
    for (const sc of sources) out.push(toColumnEdge(m, sc));
  }
  return out;
}

function toColumnEdge(m: MappingRow, sourceColumn: string): FlowColumnEdge {
  return {
    id: `${m.id}|${sourceColumn}`,
    sourceTable: m.sourceTable, sourceColumn, targetTable: m.targetTable, targetColumn: m.targetColumn,
    mapType: m.mapType, kind: flowKind(m.mapType), transformation: m.remark.trim(),
    sheet: m.sheet, rowNo: m.rowNo,
  };
}

// ---------- ranks ----------
/** Longest-path layering restricted to the visible sub-graph, so the picture reads left (origin) to right (destination). */
function rankTables(names: string[], edges: LineageEdge[]): Map<string, number> {
  const rank = new Map<string, number>(names.map((n) => [n, 0]));
  for (let i = 0; i <= names.length; i++) {
    let changed = false;
    for (const e of edges) {
      const next = Math.min(names.length, (rank.get(e.source) ?? 0) + 1);
      if (next > (rank.get(e.target) ?? 0)) { rank.set(e.target, next); changed = true; }
    }
    if (!changed) break;
  }
  // Close gaps (possible after the cycle guard) so no empty layers appear.
  const used = Array.from(new Set(rank.values())).sort((a, b) => a - b);
  const compact = new Map(used.map((r, i) => [r, i]));
  for (const [n, r] of rank) rank.set(n, compact.get(r) ?? 0);
  return rank;
}

// ---------- main builder ----------
export function buildFlow(model: WorkbookModel, req: FlowRequest): LineageFlow {
  const opts: LineageOptions = { includeNotUsed: req.includeNotUsed, internalOnly: req.internalOnly };
  const graph = buildLineage(model, opts);
  const trace = traceTables(graph, req.tables, req.upstream, req.downstream, req.depth);
  const names = [...trace.selected, ...trace.upstream, ...trace.downstream];
  const nameSet = new Set(names);
  const edges = graph.edges.filter((e) => trace.edges.has(e.id) && nameSet.has(e.source) && nameSet.has(e.target));
  const cEdges = columnEdges(model, new Set(edges.map((e) => e.id)), opts);
  const rank = rankTables(names, edges);
  const tmap = tableByName(model);

  const involved = new Map<string, Set<string>>();
  const touch = (t: string, c: string) => {
    if (!c) return;
    const s = involved.get(t) ?? new Set<string>();
    s.add(c);
    involved.set(t, s);
  };
  for (const e of cEdges) { touch(e.sourceTable, e.sourceColumn); touch(e.targetTable, e.targetColumn); }

  const selectedSet = new Set(trace.selected);
  const tables: FlowTable[] = names.map((name) => {
    const def = tmap.get(name);
    const node = graph.nodes.find((n) => n.id === name);
    const want = involved.get(name) ?? new Set<string>();
    const ordered = (def?.columns ?? []).map((c) => c.name).filter((c) => want.has(c));
    const known = new Set(ordered);
    const extra = Array.from(want).filter((c) => !known.has(c)).sort();
    const role: FlowRole = selectedSet.has(name) ? 'selected' : trace.upstream.has(name) ? 'upstream' : 'downstream';
    return {
      name, system: node?.system ?? def?.system ?? 'CrisMac', layer: node?.layer ?? def?.layer ?? 'CRISMAC',
      role, rank: rank.get(name) ?? 0, columnCount: def?.columns.length ?? 0, columns: [...ordered, ...extra],
    };
  });

  const procs = buildCatalogue(model);
  const tableEdges: FlowTableEdge[] = edges.map((e) => {
    const s = e.source.toLowerCase();
    const t = e.target.toLowerCase();
    const hits = procs.filter((p) => {
      const ml = p.mentionedTables.map((x) => x.toLowerCase());
      return ml.includes(s) && ml.includes(t);
    });
    return { ...e, procedures: hits.map((p) => ({ name: p.name, kind: p.kind })) };
  });

  const count = (k: FlowKind) => cEdges.filter((e) => e.kind === k).length;
  return {
    request: req, tables, tableEdges, columnEdges: cEdges, untraceable: trace.untraceable,
    stats: {
      upstream: trace.upstream.size, downstream: trace.downstream.size,
      direct: count('direct'), transformed: count('transformed'), unspecified: count('unspecified'),
    },
  };
}

// ---------- visible rows ----------
/** Columns actually drawn per table: none when collapsed, the first `cap` when expanded, all when "show all" is on. */
export function visibleColumnMap(
  tables: FlowTable[], collapsed: Set<string>, showAll: Set<string>, cap: number,
): Map<string, string[]> {
  return new Map(tables.map((t) => [
    t.name,
    collapsed.has(t.name) ? [] : showAll.has(t.name) ? t.columns : t.columns.slice(0, cap),
  ]));
}

// ---------- edge grouping ----------
/** Handle id used when a column is not drawn (table collapsed, row hidden or no source column). */
export const TABLE_HANDLE = '*';

export interface EdgeGroup {
  id: string;
  sourceTable: string;
  /** Drawn column name, or TABLE_HANDLE. */
  sourceHandle: string;
  targetTable: string;
  targetHandle: string;
  items: FlowColumnEdge[];
  kind: FlowKind;
}

/**
 * Merge column mappings that would be drawn between the same two handles into one line, so collapsed tables
 * show one arrow per table pair and expanded tables one arrow per column pair.
 */
export function groupEdges(edges: FlowColumnEdge[], visible: Map<string, string[]>): EdgeGroup[] {
  const sets = new Map(Array.from(visible, ([k, v]) => [k, new Set(v)]));
  const groups = new Map<string, EdgeGroup>();
  for (const e of edges) {
    const sh = e.sourceColumn && sets.get(e.sourceTable)?.has(e.sourceColumn) ? e.sourceColumn : TABLE_HANDLE;
    const th = sets.get(e.targetTable)?.has(e.targetColumn) ? e.targetColumn : TABLE_HANDLE;
    const id = `${e.sourceTable}|${sh}=>${e.targetTable}|${th}`;
    const g = groups.get(id);
    if (g) g.items.push(e);
    else groups.set(id, { id, sourceTable: e.sourceTable, sourceHandle: sh, targetTable: e.targetTable, targetHandle: th, items: [e], kind: e.kind });
  }
  for (const g of groups.values()) {
    g.kind = g.items.some((i) => i.kind === 'transformed') ? 'transformed' : g.items.some((i) => i.kind === 'direct') ? 'direct' : 'unspecified';
  }
  return Array.from(groups.values());
}

// ---------- layout ----------
export const FLOW_LAYOUT = { nodeWidth: 280, xGap: 190, yGap: 36, headerHeight: 46, rowHeight: 24, footerHeight: 26 } as const;

export function nodeHeight(visibleRows: number, hasMoreRow: boolean): number {
  if (visibleRows === 0 && !hasMoreRow) return FLOW_LAYOUT.headerHeight;
  return FLOW_LAYOUT.headerHeight + visibleRows * FLOW_LAYOUT.rowHeight + (hasMoreRow ? FLOW_LAYOUT.footerHeight : 0) + 6;
}

export interface Placed { x: number; y: number }

/** Layered left-to-right layout; within a layer, tables are ordered by the average position of their neighbours to reduce crossings. */
export function layoutFlow(
  tables: FlowTable[], edges: { source: string; target: string }[], heightOf: (name: string) => number,
): Map<string, Placed> {
  const layers = new Map<number, string[]>();
  for (const t of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    layers.set(t.rank, [...(layers.get(t.rank) ?? []), t.name]);
  }
  const order = new Map<string, number>();
  const sortedRanks = Array.from(layers.keys()).sort((a, b) => a - b);
  const neighbours = (n: string) => edges.flatMap((e) => (e.source === n ? [e.target] : e.target === n ? [e.source] : []));
  const index = (names: string[]) => names.forEach((n, i) => order.set(n, i));
  for (const r of sortedRanks) index(layers.get(r) ?? []);
  for (let pass = 0; pass < 2; pass++) {
    const seq = pass === 0 ? sortedRanks : [...sortedRanks].reverse();
    for (const r of seq) {
      const names = layers.get(r) ?? [];
      const score = (n: string) => {
        const ns = neighbours(n).filter((x) => (tables.find((t) => t.name === x)?.rank ?? r) !== r);
        if (ns.length === 0) return order.get(n) ?? 0;
        return ns.reduce((a, x) => a + (order.get(x) ?? 0), 0) / ns.length;
      };
      names.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
      index(names);
    }
  }
  const colHeights = sortedRanks.map((r) => (layers.get(r) ?? []).reduce((a, n) => a + heightOf(n) + FLOW_LAYOUT.yGap, -FLOW_LAYOUT.yGap));
  const tallest = Math.max(0, ...colHeights);
  const out = new Map<string, Placed>();
  sortedRanks.forEach((r, ci) => {
    let y = (tallest - colHeights[ci]) / 2;
    for (const n of layers.get(r) ?? []) {
      out.set(n, { x: ci * (FLOW_LAYOUT.nodeWidth + FLOW_LAYOUT.xGap), y });
      y += heightOf(n) + FLOW_LAYOUT.yGap;
    }
  });
  return out;
}

/** Tables reachable from `focus` inside an already-built flow (used for click-to-highlight). */
export function focusPath(edges: { id: string; source: string; target: string }[], focus: string): {
  upstream: Set<string>; downstream: Set<string>; edges: Set<string>;
} {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const hit = new Set<string>();
  const go = (dir: 'up' | 'down') => {
    const stack = [focus];
    const seen = new Set<string>([focus]);
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const e of edges) {
        if ((dir === 'up' ? e.target : e.source) !== cur) continue;
        hit.add(e.id);
        const next = dir === 'up' ? e.source : e.target;
        (dir === 'up' ? upstream : downstream).add(next);
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
  };
  go('up');
  go('down');
  return { upstream, downstream, edges: hit };
}
