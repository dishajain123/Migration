import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { cn } from '@/lib/cn';
import type { CatalogEntry } from '@/types';
import { LAYER_COLOR, LAYER_LABEL } from './flowStyle';

/** Searchable, filterable multi-select of every table that has lineage. Selection is owned by the page. */
export function TablePicker({ catalog, selected, onChange }: {
  catalog: CatalogEntry[]; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState('');
  const [system, setSystem] = useState('');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const layers = useMemo(() => Array.from(new Set(catalog.map((c) => c.layer))).sort(), [catalog]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!layer || c.layer === layer) && (!system || c.system === system));
  }, [catalog, query, layer, system]);

  const toggle = (name: string) => onChange(chosen.has(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  const filtered = !!(query || layer || system);

  return (
    <Card className="flex max-h-[20rem] min-h-[14rem] flex-col overflow-hidden">
      <CardHeader
        title={<span className="flex items-center gap-1.5">1. Pick tables <InfoTip title="Table picker">
          <span>Choose one or more tables to follow. The graph then shows where each table's data comes from (upstream) and where it goes (downstream).</span>
          <span>Only tables that appear in at least one documented mapping are listed.</span>
        </InfoTip></span>}
        subtitle={`${selected.length} selected · ${shown.length} of ${catalog.length} tables shown`}
        right={selected.length > 0 ? <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear</Button> : undefined}
      />
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tables..." aria-label="Search tables" className="w-full pl-8" />
        </div>
        <div className="flex gap-2">
          <Select value={layer} onChange={(e) => setLayer(e.target.value)} aria-label="Filter by layer" className="min-w-0 flex-1">
            <option value="">All layers</option>
            {layers.map((l) => <option key={l} value={l}>{LAYER_LABEL[l] ?? l}</option>)}
          </Select>
          <Select value={system} onChange={(e) => setSystem(e.target.value)} aria-label="Filter by system" className="min-w-0 flex-1">
            <option value="">CrisMac and TRAQ</option>
            <option value="CrisMac">CrisMac only</option>
            <option value="TRAQ">TRAQ only</option>
          </Select>
        </div>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                aria-label={`Remove ${s} from selection`}
                className="anim-fade inline-flex items-center gap-1 rounded-full bg-primarybg px-2 py-0.5 font-mono text-[11px] text-primary hover:opacity-80"
              >
                {s}<X size={11} />
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="grid min-h-0 flex-1 content-start overflow-auto sm:grid-cols-2 xl:grid-cols-3" role="listbox" aria-multiselectable="true" aria-label="Tables">
        {shown.length === 0 && (
          <li className="col-span-full p-6 text-center text-sm text-muted">
            {filtered ? 'No table matches these filters.' : 'No tables with lineage.'}
            {filtered && <div><Button variant="outline" size="sm" className="mt-2" onClick={() => { setQuery(''); setLayer(''); setSystem(''); }}>Clear filters</Button></div>}
          </li>
        )}
        {shown.map((c) => {
          const on = chosen.has(c.name);
          return (
            <li key={c.name} role="option" aria-selected={on}>
              <label className={cn('flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 text-sm transition-colors hover:bg-surface2', on && 'bg-primarybg')}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.name)} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: LAYER_COLOR[c.layer] ?? '#64748b' }} />
                    <span className="truncate font-mono text-xs font-medium" title={c.name}>{c.name}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted">
                    <span>{c.system}</span>
                    <span title="Tables that feed this one, directly or through others">↑ {c.upstreamCount} upstream</span>
                    <span title="Tables this one feeds, directly or through others">↓ {c.downstreamCount} downstream</span>
                  </span>
                </span>
                {c.upstreamCount === 0 && <Badge tone="info" className="shrink-0">Origin</Badge>}
              </label>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
