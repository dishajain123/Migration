import { ChevronDown, ChevronUp, GitBranch, Plus, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import type { ExportDoc } from '@/domain/exporters';
import { lineageExportDoc } from '@/domain/lineageExport';
import { AsyncView, Badge, Button, Card, OriginBadge, PageHeader, Select } from '@/components/ui';
import { groupEdges, visibleColumnMap, type EdgeGroup } from '@/domain/lineageFlow';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { useAsync } from '@/hooks/useAsync';
import { useFullscreen } from '@/hooks/useFullscreen';
import { services } from '@/services';
import type { CatalogEntry, FlowRequest, LineageFlow } from '@/types';
import { FlowCanvas } from './FlowCanvas';
import { FlowDetails, type Pick } from './FlowDetails';
import { EDGE_COLOR, KIND_HINT, LAYER_COLOR, LAYER_LABEL, ROW_CAP } from './flowStyle';
import { TablePicker } from './TablePicker';

const DEFAULT_TABLE = 'FCT_PRODUCT_MASTER';
const DEFAULT_DEPTH = 2;
const GUIDE_KEY = 'lineage.guide.open';

function readGuideOpen(): boolean {
  try { return window.localStorage.getItem(GUIDE_KEY) !== 'false'; } catch { return true; }
}

export function LineagePage() {
  const [params] = useSearchParams();
  const urlTable = params.get('table');
  const [internalOnly, setInternalOnly] = useState(false);
  const [includeNotUsed, setIncludeNotUsed] = useState(false);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [upstream, setUpstream] = useState(true);
  const [downstream, setDownstream] = useState(true);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<Pick>({ kind: 'none' });
  const [arrangeTick, setArrangeTick] = useState(0);
  const [guideOpen, setGuideOpen] = useState(readGuideOpen);

  const fs = useFullscreen<HTMLElement>();
  // Re-fit the graph once the container has resized for fullscreen on/off.
  const [fitTick, setFitTick] = useState(0);
  useEffect(() => { setFitTick((t) => t + 1); }, [fs.active]);

  const catalog = useAsync(() => services.lineage.getCatalog({ internalOnly, includeNotUsed }), [internalOnly, includeNotUsed]);

  const tables = useMemo(() => {
    if (selection) return selection;
    const names = catalog.data?.map((c) => c.name) ?? [];
    if (urlTable && names.includes(urlTable)) return [urlTable];
    if (!urlTable && names.includes(DEFAULT_TABLE)) return [DEFAULT_TABLE];
    return [];
  }, [selection, catalog.data, urlTable]);

  const req: FlowRequest = useMemo(
    () => ({ tables, upstream, downstream, depth, internalOnly, includeNotUsed }),
    // tables is a fresh array only when its content changes (selection state or catalog load)
    [tables, upstream, downstream, depth, internalOnly, includeNotUsed],
  );
  const reqKey = JSON.stringify(req);
  const flow = useAsync(() => services.lineage.getFlow(req), [reqKey]);

  const visible = useMemo(
    () => (flow.data ? visibleColumnMap(flow.data.tables, collapsed, showAll, ROW_CAP) : new Map<string, string[]>()),
    [flow.data, collapsed, showAll],
  );
  const groups = useMemo(() => (flow.data ? groupEdges(flow.data.columnEdges, visible) : []), [flow.data, visible]);

  // A new request invalidates whatever was selected inside the old graph.
  useEffect(() => { setPick({ kind: 'none' }); setCollapsed(new Set()); setShowAll(new Set()); }, [reqKey]);

  const toggleGuide = () => {
    setGuideOpen((o) => {
      try { window.localStorage.setItem(GUIDE_KEY, String(!o)); } catch { /* storage unavailable: keep in memory */ }
      return !o;
    });
  };

  const flip = (name: string) => (prev: Set<string>) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  };
  const onToggle = useCallback((n: string) => setCollapsed(flip(n)), []);
  const onShowAll = useCallback((n: string) => setShowAll(flip(n)), []);
  const onTable = useCallback((n: string) => setPick({ kind: 'table', table: n }), []);
  const onColumn = useCallback((t: string, c: string) => setPick({ kind: 'column', table: t, column: c }), []);
  const onEdge = useCallback((id: string) => setPick({ kind: 'edge', id }), []);
  const onPane = useCallback(() => setPick({ kind: 'none' }), []);

  const reset = () => {
    setSelection(null);
    setUpstream(true); setDownstream(true); setDepth(DEFAULT_DEPTH);
    setInternalOnly(false); setIncludeNotUsed(false);
    setPick({ kind: 'none' });
    setArrangeTick((t) => t + 1);
  };

  return (
    <div>
      <PageHeader
        title="Agent 2 · Data Flow & Lineage"
        description="See where a table's data comes from, how each column is transformed on the way, and where it goes next. Pick tables first; the graph below traces them for you."
        right={
          <div className="flex items-center gap-2">
            <OriginBadge meta={flow.meta ?? catalog.meta} />
            <InfoTip title="About Data Flow & Lineage" align="right">
              <span><b>What it does:</b> draws every documented mapping between tables as an arrow, down to individual columns.</span>
              <span><b>Why it matters:</b> before moving data from CrisMac to TRAQ you need to know which source feeds which target, and what changes in between.</span>
              <span><b>How to use it:</b> pick tables, choose how far to trace, then click tables, columns and arrows for details.</span>
            </InfoTip>
          </div>
        }
      />

      <Card className="mb-3">
        <button type="button" onClick={toggleGuide} aria-expanded={guideOpen} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium">
          <span className="flex items-center gap-2"><GitBranch size={15} className="text-primary" /> How to explore lineage</span>
          {guideOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {guideOpen && (
          <ol className="anim-fade grid gap-3 border-t border-border px-4 py-3 text-xs text-muted sm:grid-cols-2 xl:grid-cols-4">
            <Step n={1} title="Pick tables">Tick one or more tables in the list. Search or filter by layer to find them. We start with {DEFAULT_TABLE}, the end point of this project.</Step>
            <Step n={2} title="Choose a direction">Upstream shows where data originates, downstream shows where it ends up. Raise the depth, or choose All levels, to follow it further.</Step>
            <Step n={3} title="Read the graph">Left to right is the direction of data. A solid grey arrow is a direct copy; a dashed purple arrow is a transformation. Collapse tables you do not need.</Step>
            <Step n={4} title="Inspect">Click a table to highlight its path (blue is upstream, green is downstream). Click a column or an arrow to read its mapping and transformation logic.</Step>
          </ol>
        )}
      </Card>

      <AsyncView state={catalog} isEmpty={(c) => c.length === 0} emptyMessage="No lineage found in the workbook for these options. Try turning off 'Internal TRAQ flow only'.">
        {(entries) => (
          <div className="space-y-4">
            {/* Step 1: choose tables (full width, compact) */}
            <TablePicker catalog={entries} selected={tables} onChange={setSelection} />

            {/* Steps 2 and 3: the diagram is the main focus. This whole section goes fullscreen, so options,
                graph, legend and the details panel all stay available and state is preserved. */}
            <section
              ref={fs.ref}
              aria-label="Data flow diagram"
              className={fs.active ? 'fixed inset-0 z-50 flex flex-col gap-3 p-3' : 'space-y-3'}
              style={fs.active ? { background: 'var(--bg)' } : undefined}
            >
              <Controls
                upstream={upstream} downstream={downstream} depth={depth} internalOnly={internalOnly} includeNotUsed={includeNotUsed}
                onUpstream={setUpstream} onDownstream={setDownstream} onDepth={setDepth}
                onInternal={setInternalOnly} onNotUsed={setIncludeNotUsed} onReset={reset} canDeepen={depth > 0 && tables.length > 0}
                getExportDoc={() => (flow.data ? lineageExportDoc(flow.data) : null)}
                canExport={!!flow.data && flow.data.tables.length > 0}
              />
              <div className={fs.active ? 'flex min-h-0 flex-1 flex-col gap-3 md:flex-row' : 'flex flex-col gap-3 xl:flex-row'}>
                <Card className={fs.active ? 'relative min-h-[16rem] min-w-0 flex-1 overflow-hidden' : 'relative h-[82vh] min-h-[36rem] min-w-0 flex-1 overflow-hidden'}>
                  <FlowView
                    flow={flow.data} visible={visible} groups={groups} status={flow.status} error={flow.error} reload={flow.reload} tables={tables} entries={entries}
                    collapsed={collapsed} showAll={showAll} pick={pick} arrangeTick={arrangeTick}
                    fitTick={fitTick} fullscreen={fs.active} onToggleFullscreen={fs.toggle}
                    onToggle={onToggle} onShowAll={onShowAll} onTable={onTable} onColumn={onColumn} onEdge={onEdge} onPane={onPane}
                    onCollapseAll={(names) => setCollapsed(new Set(names))} onExpandAll={() => { setCollapsed(new Set()); }}
                    onArrange={() => setArrangeTick((t) => t + 1)}
                  />
                </Card>
                <div className={fs.active ? 'min-h-0 w-full shrink-0 md:w-[24rem]' : 'w-full shrink-0 xl:w-[24rem]'}>
                  <DetailsColumn
                    flow={flow.data} groups={groups} pick={pick} selected={tables}
                    className={fs.active ? 'h-full max-h-[40vh] md:max-h-none' : 'h-[82vh] min-h-[36rem]'}
                    onTable={onTable} onTrace={setSelection} onAdd={(n) => setSelection([...tables, n])}
                  />
                </div>
              </div>
              <Legend />
            </section>
            {tables.length > 0 && <AiInsightPanel title="AI flow explanation" resetKey={reqKey} run={(o) => services.ai.explainFlow(req, o)} actionLabel="Explain this flow with AI" />}
          </div>
        )}
      </AsyncView>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primarybg text-[11px] font-semibold text-primary">{n}</span>
      <span><span className="block font-medium text-fg">{title}</span>{children}</span>
    </li>
  );
}

function Controls(p: {
  upstream: boolean; downstream: boolean; depth: number; internalOnly: boolean; includeNotUsed: boolean; canDeepen: boolean;
  onUpstream: (v: boolean) => void; onDownstream: (v: boolean) => void; onDepth: (v: number) => void;
  onInternal: (v: boolean) => void; onNotUsed: (v: boolean) => void; onReset: () => void;
  getExportDoc: () => ExportDoc | null; canExport: boolean;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium">2. Trace <InfoTip title="Trace options">
        <span>Upstream = tables that feed your selection. Downstream = tables your selection feeds.</span>
        <span>Depth is how many table-to-table hops to follow from each selected table.</span>
      </InfoTip></span>
      <label className="flex items-center gap-1.5" title="Show where the selected tables get their data"><input type="checkbox" checked={p.upstream} onChange={(e) => p.onUpstream(e.target.checked)} /> Upstream</label>
      <label className="flex items-center gap-1.5" title="Show which tables the selected tables feed"><input type="checkbox" checked={p.downstream} onChange={(e) => p.onDownstream(e.target.checked)} /> Downstream</label>
      <label className="flex items-center gap-1.5">Depth
        <Select value={String(p.depth)} onChange={(e) => p.onDepth(Number(e.target.value))} aria-label="Trace depth" className="h-8">
          <option value="1">1 level</option><option value="2">2 levels</option><option value="3">3 levels</option><option value="4">4 levels</option><option value="0">All levels</option>
        </Select>
      </label>
      <Button variant="outline" size="sm" disabled={!p.canDeepen} onClick={() => p.onDepth(p.depth + 1)} title="Follow the lineage one more hop"><Plus size={13} /> One more level</Button>
      <label className="flex items-center gap-1.5" title="Hide CrisMac source tables and show only flow between TRAQ tables"><input type="checkbox" checked={p.internalOnly} onChange={(e) => p.onInternal(e.target.checked)} /> TRAQ tables only</label>
      <label className="flex items-center gap-1.5" title="Include links the workbook marks NOT USED (documented but not loaded)"><input type="checkbox" checked={p.includeNotUsed} onChange={(e) => p.onNotUsed(e.target.checked)} /> Include NOT USED links</label>
      <div className="ml-auto flex items-center gap-2">
        <ExportMenu getDoc={p.getExportDoc} baseName="lineage" disabled={!p.canExport} />
        <Button variant="ghost" size="sm" onClick={p.onReset} title="Back to the default table, depth and options"><RotateCcw size={13} /> Reset</Button>
      </div>
    </Card>
  );
}

interface FlowViewProps {
  flow: LineageFlow | null; status: 'loading' | 'success' | 'error'; error: string | null; reload: () => void;
  tables: string[]; entries: CatalogEntry[];
  collapsed: Set<string>; showAll: Set<string>; pick: Pick; arrangeTick: number;
  fitTick: number; fullscreen: boolean; onToggleFullscreen: () => void;
  onToggle: (n: string) => void; onShowAll: (n: string) => void; onTable: (n: string) => void;
  onColumn: (t: string, c: string) => void; onEdge: (id: string) => void; onPane: () => void;
  onCollapseAll: (names: string[]) => void; onExpandAll: () => void; onArrange: () => void;
}

function FlowView(p: FlowViewProps & { visible: Map<string, string[]>; groups: EdgeGroup[] }) {
  const { flow, collapsed, showAll, visible, groups } = p;
  if (p.tables.length === 0) {
    return <CenterMessage title="No table selected" body="Tick a table in the list above to see where its data comes from and where it goes." />;
  }
  if (p.status === 'error' && !flow) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-bad">
        <div className="font-medium">The graph could not be built</div>
        <div className="text-muted">{p.error}</div>
        <Button variant="outline" size="sm" onClick={p.reload}>Retry</Button>
      </div>
    );
  }
  if (!flow) return <CenterMessage title="Tracing lineage..." body="Following the documented mappings." busy />;
  if (flow.tables.length === 0) {
    return <CenterMessage title="No documented lineage" body={`${flow.untraceable.join(', ')} has no mapping rows under the current options. Try including NOT USED links, or pick another table.`} />;
  }
  const focus = p.pick.kind === 'table' ? p.pick.table : p.pick.kind === 'column' ? p.pick.table : '';
  return (
    <>
      <FlowCanvas
        flow={flow} groups={groups} visible={visible} collapsed={collapsed} showAll={showAll}
        focus={focus} activeColumn={p.pick.kind === 'column' ? { table: p.pick.table, column: p.pick.column } : null}
        selectedEdge={p.pick.kind === 'edge' ? p.pick.id : ''} arrangeTick={p.arrangeTick}
        fitTick={p.fitTick} fullscreen={p.fullscreen} onToggleFullscreen={p.onToggleFullscreen}
        onToggle={p.onToggle} onShowAll={p.onShowAll} onTable={p.onTable} onColumn={p.onColumn} onEdge={p.onEdge} onPane={p.onPane}
        onCollapseAll={() => p.onCollapseAll(flow.tables.map((t) => t.name))} onExpandAll={p.onExpandAll} onArrange={p.onArrange}
      />
      {p.status === 'loading' && <div className="anim-fade pointer-events-none absolute right-3 top-3 rounded bg-surface2 px-2 py-1 text-xs text-muted">Updating...</div>}
      {flow.untraceable.length > 0 && (
        <div className="absolute bottom-3 left-3 max-w-xs rounded border border-border bg-surface p-2 text-xs text-muted shadow">
          No documented lineage for: <span className="font-mono">{flow.untraceable.join(', ')}</span>
        </div>
      )}
    </>
  );
}

function CenterMessage({ title, body, busy }: { title: string; body: string; busy?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-6 text-center">
      <GitBranch size={22} className={busy ? 'animate-pulse text-primary' : 'text-muted'} />
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-sm text-xs text-muted">{body}</div>
    </div>
  );
}

function DetailsColumn(p: {
  flow: LineageFlow | null; groups: EdgeGroup[]; pick: Pick; selected: string[]; className: string;
  onTable: (n: string) => void; onTrace: (t: string[]) => void; onAdd: (n: string) => void;
}) {
  const { groups } = p;
  if (!p.flow || p.flow.tables.length === 0) {
    return (
      <Card className={`p-4 text-sm text-muted ${p.className}`}>
        <div className="mb-1 font-medium text-fg">3. Inspect</div>
        Details for the table, column or arrow you click will appear here: source and target, MAP TYPE and the transformation text from the workbook.
      </Card>
    );
  }
  return <FlowDetails flow={p.flow} groups={groups} pick={p.pick} selected={p.selected} className={p.className} onTable={p.onTable} onTrace={p.onTrace} onAdd={p.onAdd} />;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted" aria-label="Legend">
      <LegendLine label="Direct copy" hint={KIND_HINT.direct} color={EDGE_COLOR.direct} />
      <LegendLine label="Transformed" hint={KIND_HINT.transformed} color={EDGE_COLOR.transformed} dash="6 4" />
      <LegendLine label="Type not stated" hint={KIND_HINT.unspecified} color={EDGE_COLOR.unspecified} dash="2 3" />
      <LegendLine label="Upstream of clicked table" hint="Highlighted when you click a table" color={EDGE_COLOR.upstream} />
      <LegendLine label="Downstream of clicked table" hint="Highlighted when you click a table" color={EDGE_COLOR.downstream} />
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {Object.entries(LAYER_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{LAYER_LABEL[k] ?? k}</span>)}
        <Badge tone="ok">Workbook-derived</Badge>
      </span>
    </div>
  );
}

function LegendLine({ label, hint, color, dash }: { label: string; hint: string; color: string; dash?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={hint}>
      <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} /><polygon points="20,0 26,4 20,8" fill={color} /></svg>
      {label}
    </span>
  );
}
