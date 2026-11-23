import { AlertTriangle, CheckCheck, ListChecks } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, DataTable, Input, Select, Stat } from '@/components/ui';
import { assessAll, summarize } from '@/domain/ruleConversion/approval';
import { decisionOf, filterRules, type RuleFilter } from '@/domain/ruleConversion/views';
import { approveRules, previewApproval, type ApprovalOutcome } from '@/stores/approvalWorkflow';
import { useConversionStore } from '@/stores/conversionStore';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import type { ConversionStatus, ConvertedRule } from '@/types';
import { ApproveDialog, OutcomeBanner } from './BulkApprove';
import { ConfidencePill, ConversionBadge, DecisionBadge } from './parts';
import { RuleDetail } from './RuleDetail';

type Bulk = { ids: string[]; via: 'selected' | 'all'; title: string } | null;

export function ReviewStep({ rules, selected, onSelect, onNext }: {
  rules: ConvertedRule[]; selected: string; onSelect: (id: string) => void; onNext: () => void;
}) {
  const edits = useConversionStore((s) => s.edits);
  const files = useConversionStore((s) => s.files);
  const mappingDecisions = useReviewStore((s) => s.mappingDecisions);
  const manualMappings = useReviewStore((s) => s.manualMappings);
  const reviewed = useMemo(() => selectReviewedMappings({ mappingDecisions, manualMappings }), [mappingDecisions, manualMappings]);
  const [filter, setFilter] = useState<RuleFilter>({ status: 'all', decision: 'all', procedure: '', withTarget: true, query: '' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Bulk>(null);
  const [outcome, setOutcome] = useState<ApprovalOutcome | null>(null);
  const shown = useMemo(() => filterRules(rules, edits, filter), [rules, edits, filter]);
  const procs = useMemo(() => Array.from(new Set(rules.map((r) => r.procedure))), [rules]);
  const assessments = useMemo(() => assessAll(rules, edits, reviewed), [rules, edits, reviewed]);
  const counts = useMemo(() => summarize(rules, edits, assessments), [rules, edits, assessments]);
  const current = rules.find((r) => r.id === selected) ?? shown[0];
  const file = files.find((f) => f.procedure?.name === current?.procedure);
  useEffect(() => { if (!selected && shown[0]) onSelect(shown[0].id); }, [selected, shown, onSelect]);
  // Drop ticks for rules that are no longer in the list (re-conversion, filter changes keep them on purpose).
  useEffect(() => { setChecked((c) => { const ids = new Set(rules.map((r) => r.id)); const next = new Set(Array.from(c).filter((id) => ids.has(id))); return next.size === c.size ? c : next; }); }, [rules]);
  const put = (patch: Partial<RuleFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const selectable = shown.filter((r) => decisionOf(r, edits) !== 'approved');
  const allTicked = selectable.length > 0 && selectable.every((r) => checked.has(r.id));
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setChecked((c) => { const n = new Set(c); if (allTicked) selectable.forEach((r) => n.delete(r.id)); else selectable.forEach((r) => n.add(r.id)); return n; });

  // Approve all only touches rules nobody has decided on: a rejected rule stays rejected until the reviewer approves it by hand.
  const pendingIds = useMemo(() => rules.filter((r) => decisionOf(r, edits) === 'pending').map((r) => r.id), [rules, edits]);
  const plan = useMemo(() => (bulk ? previewApproval(rules, bulk.ids) : null), [bulk, rules]);
  const open = (via: 'selected' | 'all') => {
    const ids = via === 'all' ? pendingIds : Array.from(checked);
    setBulk({ ids, via, title: via === 'all' ? 'Approve all eligible rules?' : `Approve ${ids.length} selected rule(s)?` });
  };
  const confirm = () => {
    if (!bulk) return;
    const res = approveRules(rules, bulk.ids, bulk.via);
    setOutcome(res);
    if (res.ok) setChecked((c) => { const n = new Set(c); res.approved.forEach((id) => n.delete(id)); return n; });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total rules" value={counts.total} />
        <Stat label="Approved" value={counts.approved} hint={counts.rejected ? `${counts.rejected} rejected` : undefined} />
        <Stat label="Pending" value={counts.pending} hint={`${counts.eligiblePending} can be approved now`} />
        <Stat label="Need attention" value={counts.attention} hint="unmapped, ambiguous or conflicting" />
        <Card className="flex flex-col justify-center gap-1.5 p-3">
          <Button size="sm" variant="success" disabled={counts.eligiblePending === 0} onClick={() => open('all')} title="Approve every pending rule that has all of its mappings verified">
            <CheckCheck size={13} /> Approve all ({counts.eligiblePending})
          </Button>
          <Button size="sm" variant="outline" disabled={checked.size === 0} onClick={() => open('selected')} title="Approve the ticked rules that are eligible">
            <ListChecks size={13} /> Approve selected ({checked.size})
          </Button>
        </Card>
      </div>

      {outcome && <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} />}

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
        <span className="ml-auto text-xs text-muted">{shown.length} shown</span>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_36rem]">
        <Card className="min-w-0 self-start">
          <DataTable<ConvertedRule>
            rows={shown} rowKey={(r) => r.id} pageSize={14} selectedKey={current?.id} onRowClick={(r) => onSelect(r.id)}
            empty="No rule matches these filters. Untick 'Only rules with a TRAQ target' to see rules that failed to map."
            columns={[
              {
                key: 'x', className: 'w-8',
                header: <input type="checkbox" aria-label="Select all shown rules" checked={allTicked} disabled={selectable.length === 0} onChange={toggleAll} />,
                render: (r) => (
                  <input
                    type="checkbox" aria-label={`Select ${r.crismacTable}.${r.crismacColumn}`} checked={checked.has(r.id)} disabled={decisionOf(r, edits) === 'approved'}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)}
                  />
                ),
              },
              { key: 'p', header: 'Procedure', render: (r) => <span className="text-xs">{r.procedure}</span> },
              { key: 'c', header: 'CrisMac -> TRAQ', render: (r) => (
                <span className="font-mono text-[11px] leading-tight">
                  <span className="block text-muted">{r.crismacTable}.{r.crismacColumn}</span>
                  <span className="block">{r.traq.entity ? `${r.traq.entity}.${edits[r.id]?.traq?.column ?? r.traq.column}` : '-'}</span>
                </span>
              ) },
              { key: 's', header: 'Result', render: (r) => <ConversionBadge status={r.status} /> },
              { key: 'd', header: 'Review', render: (r) => {
                const d = decisionOf(r, edits);
                const a = assessments.get(r.id);
                return (
                  <span className="flex flex-col items-start gap-1">
                    <DecisionBadge decision={d} />
                    {d !== 'approved' && a && !a.eligible && (
                      <span title={a.blockers.join('\n')}><Badge tone="warn"><span className="inline-flex items-center gap-1"><AlertTriangle size={10} /> Needs attention</span></Badge></span>
                    )}
                  </span>
                );
              } },
              { key: 'k', header: 'Confidence', render: (r) => <ConfidencePill rule={r} /> },
            ]}
          />
        </Card>
        <div className="min-w-0">
          {current ? <RuleDetail rule={current} file={file} assessment={assessments.get(current.id)} onOutcome={setOutcome} /> : <Card className="p-8 text-center text-sm text-muted">Select a rule to review it.</Card>}
        </div>
      </div>

      <div className="flex justify-end"><Button onClick={onNext}>Next: export</Button></div>
      {plan && bulk && <ApproveDialog open={!!bulk} onClose={() => setBulk(null)} title={bulk.title} plan={plan} onConfirm={confirm} />}
    </div>
  );
}
