import { Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { InfoTip } from '@/components/InfoTip';
import { Button, Card, CardHeader, DataTable, Input, Select } from '@/components/ui';
import { mappingRows, type MappingRow } from '@/domain/ruleConversion/views';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { useReviewStore } from '@/stores/reviewStore';
import type { ConvertedRule, MappingStatus } from '@/types';
import { MappingBadge } from './parts';

export function MappingStep({ rules, onNext }: { rules: ConvertedRule[]; onNext: () => void }) {
  const rows = useMemo(() => mappingRows(rules), [rules]);
  const [status, setStatus] = useState<MappingStatus | ''>('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string>('');
  const shown = rows.filter((r) => (!status || r.resolution.status === status) && (!q || r.key.toLowerCase().includes(q.toLowerCase()) || `${r.resolution.chosen?.table}.${r.resolution.chosen?.column}`.toLowerCase().includes(q.toLowerCase())));
  const count = (s: MappingStatus) => rows.filter((r) => r.resolution.status === s).length;

  return (
    <div className="space-y-4">
      <Settings rules={rules} />
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-1.5">3. CrisMac columns mapped to TRAQ <InfoTip title="How columns are mapped">
            <span><b>Lookup order:</b> Agent 4 manual mapping → approved suggestion → documented workbook mapping → same-name TRAQ column → Agent 4's heuristic (Simulated, lowest confidence).</span>
            <span><b>Suggested:</b> shows the guessed column in the expression, but still blocks export until you confirm it with Map.</span>
            <span><b>Not mapped:</b> stays as a <code>[[UNMAPPED ...]]</code> placeholder and also blocks export.</span>
          </InfoTip></span>}
          subtitle={`${rows.length} distinct columns · ${count('approved') + count('documented')} mapped · ${count('name-match')} name match · ${count('suggested')} Simulated suggestion · ${count('ambiguous')} ambiguous · ${count('missing')} not mapped`}
        />
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Input placeholder="Search CrisMac or TRAQ column..." value={q} onChange={(e) => setQ(e.target.value)} className="w-72" aria-label="Search columns" />
          <Select value={status} onChange={(e) => setStatus(e.target.value as MappingStatus | '')} aria-label="Filter by mapping status">
            <option value="">All statuses</option>
            <option value="missing">Not mapped</option><option value="suggested">Simulated suggestion</option><option value="ambiguous">Ambiguous</option><option value="name-match">Name match only</option>
            <option value="documented">Documented (workbook)</option><option value="approved">Approved in Agent 4</option>
          </Select>
        </div>
        <DataTable<MappingRow>
          rows={shown} rowKey={(r) => r.key} pageSize={15} empty="No column matches these filters."
          columns={[
            { key: 'c', header: 'CrisMac column', render: (r) => <span className="font-mono text-xs">{r.key}</span> },
            { key: 'u', header: 'Used by', render: (r) => <span className="text-xs text-muted" title={r.rules.join('\n')}>{r.writtenBy ? `written by ${r.writtenBy}` : ''}{r.writtenBy && r.readBy ? ', ' : ''}{r.readBy ? `read by ${r.readBy}` : ''} rule(s)</span> },
            { key: 's', header: 'Status', render: (r) => <MappingBadge status={r.resolution.status} note={r.resolution.note} /> },
            { key: 't', header: 'TRAQ column', render: (r) => r.resolution.chosen
              ? <span className="font-mono text-xs" title={r.resolution.candidates.length > 1 ? `Candidates:\n${r.resolution.candidates.map((c) => `${c.table}.${c.column} (${c.basis})`).join('\n')}` : r.resolution.note}>
                  {r.resolution.chosen.table}.{r.resolution.chosen.column}
                  {r.resolution.candidates.length > 1 && <span className="ml-1 text-muted">+{r.resolution.candidates.length - 1}</span>}
                  {r.resolution.status === 'suggested' && <span className="ml-1 text-muted">({r.resolution.chosen.confidence ?? '?'}% Simulated)</span>}
                </span>
              : <span className="text-xs text-muted">Not provided in workbook or Agent 4</span> },
            { key: 'a', header: '', render: (r) => (
              <div className="flex justify-end gap-1">
                {r.resolution.chosen && <Link to={`/mapping?table=${encodeURIComponent(r.resolution.chosen.table)}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-surface2" title="Review this table's mappings in Agent 4"><Link2 size={12} /> Agent 4</Link>}
                {r.resolution.status !== 'approved' && <Button size="sm" variant="outline" onClick={() => setEditing(editing === r.key ? '' : r.key)}><Plus size={12} /> Map</Button>}
              </div>
            ) },
          ]}
        />
        {editing && <ManualMapForm row={rows.find((r) => r.key === editing) as MappingRow} onDone={() => setEditing('')} />}
      </Card>
      <div className="flex justify-end"><Button onClick={onNext}>Next: review the rules</Button></div>
    </div>
  );
}

/** Records the correction as an Agent 4 manual mapping, so every agent (and every rule) uses the same mapping. */
function ManualMapForm({ row, onDone }: { row: MappingRow; onDone: () => void }) {
  const tables = useAsync(() => services.mapping.listAllTables(), []);
  const traqNames = useAsync(() => services.dataModel.listTables({ system: 'TRAQ' }), []);
  const add = useReviewStore((s) => s.addManualMapping);
  const [table, setTable] = useState(row.resolution.chosen?.table ?? '');
  const [column, setColumn] = useState(row.resolution.chosen?.column ?? '');
  const [note, setNote] = useState('');
  const allowed = new Set((traqNames.data ?? []).map((t) => t.name));
  const traq = (tables.data ?? []).filter((t) => allowed.has(t.name));
  const loading = tables.status === 'loading' || traqNames.status === 'loading';
  const cols = traq.find((t) => t.name === table)?.columns ?? [];
  const save = () => {
    const c = cols.find((x) => x.name === column);
    add({
      targetTable: table, targetColumn: column, targetType: c?.dataType ?? '',
      sourceTable: row.resolution.crismacTable, sourceColumn: row.resolution.crismacColumn, sourceType: '',
      note: note || 'Entered from Agent 5 rule conversion',
    });
    onDone();
  };
  return (
    <div className="anim-slide-up space-y-2 border-t border-border bg-surface2/50 p-4">
      <div className="text-sm font-medium">Map <span className="font-mono">{row.key}</span> to a TRAQ column</div>
      <p className="text-xs text-muted">Saved as a manual mapping in Agent 4 (Mapping Engine), so it is shared with every agent and all rules are re-converted.</p>
      <div className="flex flex-wrap gap-2">
        <Select value={table} onChange={(e) => { setTable(e.target.value); setColumn(''); }} aria-label="TRAQ table" className="min-w-[14rem]" disabled={loading}>
          <option value="">{loading ? 'Loading tables...' : 'TRAQ table...'}</option>
          {traq.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </Select>
        <Select value={column} onChange={(e) => setColumn(e.target.value)} aria-label="TRAQ column" disabled={!table} className="min-w-[14rem]">
          <option value="">TRAQ column...</option>
          {cols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.dataType || '?'})</option>)}
        </Select>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className="w-64" aria-label="Reason" />
        <Button onClick={save} disabled={!table || !column}>Save mapping</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function Settings({ rules }: { rules: ConvertedRule[] }) {
  const settings = useConversionStore((s) => s.settings);
  const setSettings = useConversionStore((s) => s.setSettings);
  const params = useMemo(() => {
    const names = new Set<string>(Object.keys(settings.paramValues).map((k) => k.toUpperCase()));
    Object.keys(settings.paramMappings).forEach((k) => names.add(k.toUpperCase()));
    const used = new Map<string, number>();
    for (const r of rules) for (const p of r.params) used.set(p.name, (used.get(p.name) ?? 0) + 1);
    used.forEach((_, k) => names.add(k));
    return Array.from(names).sort().map((name) => ({ name, used: used.get(name) ?? 0 }));
  }, [rules, settings]);
  const val = (rec: Record<string, string>, k: string) => rec[k] ?? rec[Object.keys(rec).find((x) => x.toUpperCase() === k) ?? ''] ?? '';
  const put = (which: 'paramValues' | 'paramMappings', k: string, v: string) => setSettings({ [which]: { ...settings[which], [k]: v } });

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-1.5">Conversion settings <InfoTip title="Why settings are needed">
          <span>CrisMac procedures take run-time parameters (@TIMEKEY, @ProcessDate). TRAQ rules have no parameters: they read columns and rule variables.</span>
          <span>Give a parameter a value to evaluate the branches that depend on it (for example the @TIMEKEY cut-offs), or a TRAQ expression to substitute. Unset parameters stay as [[PARAM ...]] and block export.</span>
        </InfoTip></span>}
        subtitle="Applied to every rule; changing them re-runs the conversion."
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[16rem_1fr]">
        <label className="space-y-1 text-xs">
          <span className="block font-medium">Effective start date (all rules)</span>
          <Input type="date" value={settings.effectiveStartDate} onChange={(e) => setSettings({ effectiveStartDate: e.target.value })} className="w-full" />
          <span className="block text-muted">Effective Start Date / IN FORCE FROM. Mandatory; a rule can override it.</span>
        </label>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted"><tr><th className="py-1 pr-2 font-medium">Parameter</th><th className="py-1 pr-2 font-medium">Used by</th><th className="py-1 pr-2 font-medium">Known value (evaluate branches)</th><th className="py-1 font-medium">or TRAQ expression</th></tr></thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.name} className="border-t border-border">
                  <td className="py-1.5 pr-2 font-mono">{p.name}</td>
                  <td className="py-1.5 pr-2 text-muted">{p.used} rule(s)</td>
                  <td className="py-1.5 pr-2"><Input value={val(settings.paramValues, p.name)} onChange={(e) => put('paramValues', p.name, e.target.value)} placeholder="e.g. 26400" className="h-8 w-36" aria-label={`Value of ${p.name}`} /></td>
                  <td className="py-1.5"><Input value={val(settings.paramMappings, p.name)} onChange={(e) => put('paramMappings', p.name, e.target.value)} placeholder='e.g. "{ENTITY}"."var"."BUSINESS_DATE"' className="h-8 w-full min-w-[16rem] font-mono" aria-label={`TRAQ expression for ${p.name}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] text-muted">{'{ENTITY}'} is replaced by the rule's TRAQ table. The default for @ProcessDate is the run-date variable BUSINESS_DATE from FPM_DA_RULES; it is flagged on every rule until you confirm it.</p>
        </div>
      </div>
    </Card>
  );
}
