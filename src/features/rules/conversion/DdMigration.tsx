import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Card, CardHeader, DataTable, Input, Progress, Select, Stat } from '@/components/ui';
import { blockingColumns, coverageByProcedure, needsMappingDoc, readyDoc } from '@/domain/ruleConversion/ddMigrate';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import type { DdMigratedRule } from '@/types';

/**
 * The project's corrected rules (dd_export.csv) with CrisMac names replaced by confirmed TRAQ columns. Format and logic are
 * untouched. Rules with any unconfirmed column are listed apart, with their original text, and never exported as "unmapped".
 */
export function DdMigration() {
  const decisions = useReviewStore((s) => s.mappingDecisions);
  const manual = useReviewStore((s) => s.manualMappings);
  const reviewed = useMemo(() => selectReviewedMappings({ mappingDecisions: decisions, manualMappings: manual }), [decisions, manual]);
  const settings = useConversionStore((s) => s.settings);
  const setSettings = useConversionStore((s) => s.setSettings);
  const namesOnly = settings.namesOnly === true;
  const state = useAsync(() => services.ruleConversion.migrateDd({ reviewed, settings }), [reviewed, JSON.stringify([settings.paramValues, settings.paramMappings, namesOnly])]);
  const [proc, setProc] = useState('');
  const now = () => new Date().toISOString();
  return (
    <AsyncView state={state} isEmpty={(d) => d.rules.length === 0} emptyMessage="No dd_export.csv rules were found beside the sample procedures.">
      {(r) => {
        const mine = r.rules.filter((x) => !proc || x.procedure === proc);
        const ready = mine.filter((x) => x.status === 'ready');
        const pending = mine.filter((x) => x.status === 'needs-mapping');
        return (
          <div className="space-y-4">
            <Card className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={namesOnly} onChange={(e) => setSettings({ namesOnly: e.target.checked })} />
                Names only
              </label>
              <InfoTip title="Names only vs full TRAQ 4X">
                <span><b>Off (default):</b> full TRAQ 4X translation. Names are replaced, DATEDIFF becomes (later, earlier, "d"), @ProcessDate / @ProcessingDate become BUSINESS_DATE, and @TIMEKEY is converted only where the mapping confirms what it is compared with.</span>
                <span><b>On:</b> only Entity, Column and "Table"."Column" are replaced; the CrisMac syntax is kept exactly as written. Use it to compare the two exports side by side.</span>
              </InfoTip>
              <span className="text-xs text-muted">{namesOnly ? 'Audit view: CrisMac syntax kept, only names replaced. Rules are not held back for parameters.' : 'Full TRAQ 4X translation.'}</span>
            </Card>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Rules in dd_export files" value={mine.length} hint={`${r.procedures.filter((p) => p.available).length} procedure file(s)`} />
              <Stat label="Ready (all columns mapped)" value={ready.length} />
              <Stat label="Need a mapping" value={pending.length} hint="kept separate, unchanged" />
              <Card className="flex items-center p-3">
                <Select value={proc} onChange={(e) => setProc(e.target.value)} aria-label="Procedure" className="w-full">
                  <option value="">All procedures</option>
                  {r.procedures.filter((p) => p.available).map((p) => <option key={p.name} value={p.name}>{p.name} ({p.rules})</option>)}
                </Select>
              </Card>
            </div>

            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5">Ready for TRAQ <InfoTip title="What changes">
                  <span>Entity Name, Column Name and each quoted "Table"."Column" in the expression are replaced with the confirmed TRAQ column (Agent 4 decisions, then workbook mappings, then an exact same-name TRAQ column).</span>
                  <span>Unless "Names only" is on, the CrisMac model's run parameters and date arithmetic are rewritten for TRAQ 4X: @ProcessDate becomes the run-date variable BUSINESS_DATE, DATEDIFF(earlier, later, "DAY") becomes DATEDIFF(later, earlier, "d"), and @TIMEKEY is converted only against a confirmed TimeKey or SCD2 column (never against a number). Each change is listed under Notes.</span>
                  <span>Everything else is as in dd_export.csv: operators, literals, explanation, dates, status and data type. A rule that still needs a parameter or TimeKey conversion that cannot be done without guessing waits below.</span>
                </InfoTip></span>}
                subtitle="dd_export layout, TRAQ names and run date"
                right={<ExportMenu baseName={namesOnly ? 'traq_dd_export_ready_names_only' : 'traq_dd_export_ready'} getDoc={() => readyDoc(mine, now())} disabled={ready.length === 0} />}
              />
              <RuleTable rows={ready} empty="No rule has all of its columns mapped yet. Confirm mappings in Agent 4 and they appear here." mapped />
            </Card>

            <ParamEditor rules={pending} />
            <Coverage rules={mine} />

            <Card>
              <CardHeader
                title="Needs a mapping first"
                subtitle="Original rule untouched; these are not in the ready file"
                right={<ExportMenu baseName="traq_dd_export_needs_mapping" getDoc={() => needsMappingDoc(mine, now())} disabled={pending.length === 0} />}
              />
              <RuleTable rows={pending} empty="Every rule is mapped." />
            </Card>
          </div>
        );
      }}
    </AsyncView>
  );
}

/** Where the gaps are: ready rules per procedure, and the columns/parameters whose mapping would unblock the most rules. */
function Coverage({ rules }: { rules: DdMigratedRule[] }) {
  const perProc = useMemo(() => coverageByProcedure(rules), [rules]);
  const blocking = useMemo(() => blockingColumns(rules).slice(0, 15), [rules]);
  if (perProc.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Coverage by procedure" subtitle="Rules ready for TRAQ / rules in the procedure's dd_export" />
        <ul className="divide-y divide-border text-xs">
          {perProc.map((p) => (
            <li key={p.procedure} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{p.procedure}</span>
              <span className="w-24"><Progress value={p.total ? Math.round((p.ready / p.total) * 100) : 0} tone={p.ready === p.total ? 'ok' : p.ready === 0 ? 'bad' : 'warn'} /></span>
              <span className="w-14 text-right tabular-nums">{p.ready}/{p.total}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Biggest blockers" subtitle="Mapping these unblocks the most rules" right={<Link to="/mapping" className="text-xs text-primary hover:underline">Open Agent 4</Link>} />
        {blocking.length === 0 ? <p className="p-4 text-sm text-muted">Nothing is blocking a rule.</p> : (
          <ul className="divide-y divide-border text-xs">
            {blocking.map((b) => (
              <li key={`${b.role}-${b.crismac}`} className="px-3 py-1.5">
                <div className="flex items-center gap-2"><span className="font-mono">{b.crismac}</span><Badge tone={b.role === 'parameter' ? 'info' : 'neutral'}>{b.role === 'parameter' ? 'parameter' : b.status === 'missing' ? 'no mapping' : b.status}</Badge><span className="ml-auto tabular-nums">{b.rules} rule(s)</span></div>
                <div className="text-muted">{b.procedures.slice(0, 3).join(', ')}{b.procedures.length > 3 ? ` +${b.procedures.length - 3}` : ''}{b.suggestion ? ` · ${b.suggestion}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Parameters that keep rules waiting: give each a value or a TRAQ expression (shared with the conversion settings). */
function ParamEditor({ rules }: { rules: DdMigratedRule[] }) {
  const settings = useConversionStore((s) => s.settings);
  const setSettings = useConversionStore((s) => s.setSettings);
  const names = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules) for (const u of r.unmapped) if (u.role === 'parameter') m.set(u.crismac, (m.get(u.crismac) ?? 0) + 1);
    return Array.from(m, ([name, used]) => ({ name, used })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rules]);
  if (names.length === 0) return null;
  const val = (rec: Record<string, string>, k: string) => rec[k] ?? rec[Object.keys(rec).find((x) => x.toUpperCase() === k) ?? ''] ?? '';
  const put = (which: 'paramValues' | 'paramMappings', k: string, v: string) => setSettings({ [which]: { ...settings[which], [k]: v } });
  return (
    <Card>
      <CardHeader title="Parameters that keep rules waiting" subtitle="TRAQ rules have no parameters. Give each a value, or a TRAQ expression; the rules update at once." />
      <div className="overflow-x-auto p-3">
        <table className="w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1 pr-2 font-medium">Parameter</th><th className="py-1 pr-2 font-medium">Rules waiting</th><th className="py-1 pr-2 font-medium">Value</th><th className="py-1 font-medium">or TRAQ expression</th></tr></thead>
          <tbody>
            {names.map((p) => (
              <tr key={p.name} className="border-t border-border">
                <td className="py-1.5 pr-2 font-mono">{p.name}</td>
                <td className="py-1.5 pr-2 text-muted">{p.used}</td>
                <td className="py-1.5 pr-2"><Input value={val(settings.paramValues, p.name)} onChange={(e) => put('paramValues', p.name, e.target.value)} className="h-8 w-32" aria-label={`Value of ${p.name}`} /></td>
                <td className="py-1.5"><Input value={val(settings.paramMappings, p.name)} onChange={(e) => put('paramMappings', p.name, e.target.value)} placeholder='e.g. "{ENTITY}"."var"."BUSINESS_DATE"' className="h-8 w-full min-w-[16rem] font-mono" aria-label={`TRAQ expression for ${p.name}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-muted">{'{ENTITY}'} is the rule's TRAQ table. Real values come from the procedure's own source (for example @FlgPreErosion is a procedure argument, and @REF_DATE or @REFPERIOD... are read from reference tables).</p>
      </div>
    </Card>
  );
}

function RuleTable({ rows, empty, mapped }: { rows: DdMigratedRule[]; empty: string; mapped?: boolean }) {
  return (
    <DataTable<DdMigratedRule> rows={rows} rowKey={(x) => x.id} pageSize={10} empty={empty}
      columns={[
        { key: 'p', header: 'Procedure', render: (x) => <span className="text-xs">{x.procedure}<div className="text-muted">row {x.rowNo}</div></span> },
        { key: 'c', header: mapped ? 'TRAQ column' : 'CrisMac column', render: (x) => <span className="font-mono text-xs">{mapped ? `${x.entity}.${x.column}` : `${x.original[0]}.${x.original[1]}`}</span> },
        { key: 'e', header: 'Expression', render: (x) => <span className="line-clamp-3 break-all font-mono text-[10.5px]" title={mapped ? x.traqRow[4] : x.original[4]}>{mapped ? x.traqRow[4] : x.original[4]}</span> },
        mapped
          ? { key: 'n', header: 'Notes', render: (x) => <div className="space-y-1 text-[11px] text-muted">{x.notes.map((n) => <div key={n}>{n}</div>)}</div> }
          : {
            key: 'u', header: 'Columns to map', render: (x) => (
              <div className="space-y-1 text-xs">
                {x.unmapped.slice(0, 6).map((u) => (
                  <div key={`${u.role}-${u.crismac}`}>
                    <span className="font-mono">{u.crismac}</span> <Badge tone={u.status === 'suggested' || u.status === 'ambiguous' ? 'warn' : 'neutral'}>{u.role === 'parameter' ? 'parameter' : u.status === 'missing' ? 'no mapping' : u.status}</Badge>
                    <div className="text-muted">{u.reason}{u.suggestion ? ` - ${u.suggestion}` : ''}</div>
                  </div>
                ))}
                {x.unmapped.length > 6 && <div className="text-muted">+{x.unmapped.length - 6} more</div>}
                {x.unmapped.some((u) => u.role !== 'parameter') && <Link to="/mapping" className="text-primary hover:underline">Map in Agent 4</Link>}
                {x.unmapped.some((u) => u.role === 'parameter') && <div className="text-muted">Parameters: set a value or TRAQ expression in the Mapping step's conversion settings.</div>}
              </div>
            ),
          },
      ]} />
  );
}
