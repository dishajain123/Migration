import { CheckCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/Dialog';
import { Button, Card, DataTable, Input, Select } from '@/components/ui';
import { decisionCounts, decisionOf, filterRules, type RuleFilter } from '@/domain/ruleConversion/views';
import { useConversionStore } from '@/stores/conversionStore';
import type { ConversionStatus, ConvertedRule } from '@/types';
import { ConfidencePill, ConversionBadge, DecisionBadge } from './parts';
import { RuleDetail } from './RuleDetail';

export function ReviewStep({ rules, selected, onSelect, onNext }: {
  rules: ConvertedRule[]; selected: string; onSelect: (id: string) => void; onNext: () => void;
}) {
  const edits = useConversionStore((s) => s.edits);
  const files = useConversionStore((s) => s.files);
  const decide = useConversionStore((s) => s.decide);
  const [filter, setFilter] = useState<RuleFilter>({ status: 'all', decision: 'all', procedure: '', withTarget: true, query: '' });
  const [confirmBulk, setConfirmBulk] = useState(false);
  const shown = useMemo(() => filterRules(rules, edits, filter), [rules, edits, filter]);
  const procs = useMemo(() => Array.from(new Set(rules.map((r) => r.procedure))), [rules]);
  const counts = decisionCounts(rules, edits);
  const bulk = useMemo(() => rules.filter((r) => r.status === 'converted' && decisionOf(r, edits) === 'pending'), [rules, edits]);
  const current = rules.find((r) => r.id === selected) ?? shown[0];
  const file = files.find((f) => f.procedure?.name === current?.procedure);
  useEffect(() => { if (!selected && shown[0]) onSelect(shown[0].id); }, [selected, shown, onSelect]);
  const put = (patch: Partial<RuleFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="mr-2 text-sm font-semibold">4. Review</span>
        <Input placeholder="Search column or procedure..." value={filter.query} onChange={(e) => put({ query: e.target.value })} className="w-60" aria-label="Search rules" />
        <Select value={filter.status} onChange={(e) => put({ status: e.target.value as ConversionStatus | 'all' })} aria-label="Conversion status">
          <option value="all">All conversion results</option><option value="converted">Converted</option><option value="needs-review">Needs review</option><option value="failed">Failed</option>
        </Select>
        <Select value={filter.decision} onChange={(e) => put({ decision: e.target.value as RuleFilter['decision'] })} aria-label="Review decision">
          <option value="all">Any decision</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </Select>
        <Select value={filter.procedure} onChange={(e) => put({ procedure: e.target.value })} aria-label="Procedure">
          <option value="">All procedures</option>{procs.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm" title="Hide rules whose CrisMac column has no TRAQ column (working tables, NPA/SMA outputs)">
          <input type="checkbox" checked={filter.withTarget} onChange={(e) => put({ withTarget: e.target.checked })} /> Only rules with a TRAQ target
        </label>
        <span className="ml-auto text-xs text-muted">{counts.approved} approved · {counts.rejected} rejected · {counts.pending} pending</span>
        <Button size="sm" variant="outline" disabled={bulk.length === 0} onClick={() => setConfirmBulk(true)} title="Approve every rule that converted with no open issues">
          <CheckCheck size={13} /> Approve {bulk.length} clean rule(s)
        </Button>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_36rem]">
        <Card className="min-w-0 self-start">
          <DataTable<ConvertedRule>
            rows={shown} rowKey={(r) => r.id} pageSize={14} selectedKey={current?.id} onRowClick={(r) => onSelect(r.id)}
            empty="No rule matches these filters. Untick 'Only rules with a TRAQ target' to see rules that failed to map."
            columns={[
              { key: 'p', header: 'Procedure', render: (r) => <span className="text-xs">{r.procedure}</span> },
              { key: 'c', header: 'CrisMac -> TRAQ', render: (r) => (
                <span className="font-mono text-[11px] leading-tight">
                  <span className="block text-muted">{r.crismacTable}.{r.crismacColumn}</span>
                  <span className="block">{r.traq.entity ? `${r.traq.entity}.${edits[r.id]?.traq?.column ?? r.traq.column}` : '-'}</span>
                </span>
              ) },
              { key: 's', header: 'Result', render: (r) => <ConversionBadge status={r.status} /> },
              { key: 'd', header: 'Review', render: (r) => <DecisionBadge decision={decisionOf(r, edits)} /> },
              { key: 'k', header: 'Confidence', render: (r) => <ConfidencePill rule={r} /> },
            ]}
          />
        </Card>
        <div className="min-w-0">
          {current ? <RuleDetail rule={current} file={file} /> : <Card className="p-8 text-center text-sm text-muted">Select a rule to review it.</Card>}
        </div>
      </div>

      <div className="flex justify-end"><Button onClick={onNext}>Next: export</Button></div>
      <ConfirmDialog
        open={confirmBulk} onCancel={() => setConfirmBulk(false)} onConfirm={() => decide(bulk.map((r) => r.id), 'approved', 'Bulk approval of clean conversions')}
        title={`Approve ${bulk.length} rule(s)?`} confirmLabel="Approve all"
        body="These rules mapped every column through documented or Agent 4-approved mappings and have no open issues. You can still reject any of them afterwards."
      />
    </div>
  );
}
