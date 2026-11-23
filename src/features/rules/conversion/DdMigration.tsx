import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Card, CardHeader, DataTable, Select, Stat } from '@/components/ui';
import { needsMappingDoc, readyDoc } from '@/domain/ruleConversion/ddMigrate';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
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
  const state = useAsync(() => services.ruleConversion.migrateDd({ reviewed }), [reviewed]);
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
                  <span>Everything else is exactly as in dd_export.csv: operators, literals, run parameters, explanation, dates, status and data type.</span>
                </InfoTip></span>}
                subtitle="Exact dd_export layout, nothing added"
                right={<ExportMenu baseName="traq_dd_export_ready" getDoc={() => readyDoc(mine, now())} disabled={ready.length === 0} />}
              />
              <RuleTable rows={ready} empty="No rule has all of its columns mapped yet. Confirm mappings in Agent 4 and they appear here." mapped />
            </Card>

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
                    <span className="font-mono">{u.crismac}</span> <Badge tone={u.status === 'suggested' || u.status === 'ambiguous' ? 'warn' : 'neutral'}>{u.status === 'missing' ? 'no mapping' : u.status}</Badge>
                    <div className="text-muted">{u.reason}{u.suggestion ? ` - ${u.suggestion}` : ''}</div>
                  </div>
                ))}
                {x.unmapped.length > 6 && <div className="text-muted">+{x.unmapped.length - 6} more</div>}
                <Link to="/mapping" className="text-primary hover:underline">Map in Agent 4</Link>
              </div>
            ),
          },
      ]} />
  );
}
