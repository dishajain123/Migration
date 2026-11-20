import { Check, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AiInsightPanel } from '@/components/AiInsightPanel';
import { InfoTip } from '@/components/InfoTip';
import { ConversionWorkspace } from './conversion/ConversionWorkspace';
import { DdMigration } from './conversion/DdMigration';
import { AsyncView, Badge, Button, Card, CardHeader, DataTable, Input, OriginBadge, PageHeader, Select, Stat, Tabs } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import type { BusinessRule, RuleKind, Severity, ValidationResult } from '@/types';

type Tab = 'convert' | 'migrate' | 'rules' | 'validation';
const TABS: Tab[] = ['convert', 'migrate', 'rules', 'validation'];
const KINDS: RuleKind[] = ['mandatory', 'constant', 'default', 'transform', 'constraint', 'derivation'];
const sevTone: Record<Severity, 'ok' | 'warn' | 'bad'> = { pass: 'ok', warn: 'warn', fail: 'bad' };

export function RulesPage() {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get('tab') as Tab | null;
  const tab: Tab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'convert';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  return (
    <div>
      <PageHeader
        title="Agent 5 · Business Rule Generator & Validator"
        description="Migrate CrisMac business rules to TRAQ: upload stored procedures, map their columns through Agent 4, review the generated TRAQ rules and export them in TRAQ's Excel/CSV format. The other tabs list the rules documented in the workbook and run validation checks."
        right={<InfoTip title="About Agent 5" align="right">
          <span><b>CrisMac SQL → TRAQ rules:</b> CrisMac keeps business rules in SQL procedures, TRAQ keeps them as derived-attribute rules in Excel/CSV. This tab converts one into the other using the approved mappings.</span>
          <span><b>Workbook rules:</b> rules extracted from the workbook (NOT NULL flags, constants, defaults, derivations, Derived Attribute rules).</span>
          <span><b>Validation:</b> metadata checks over the mappings, including the ones you approved in Agent 4.</span>
        </InfoTip>}
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'convert', label: 'CrisMac SQL → TRAQ rules' },
        { id: 'migrate', label: 'Corrected rules → TRAQ names' },
        { id: 'rules', label: 'Workbook rules' },
        { id: 'validation', label: 'Validation' },
      ]} />
      <div key={tab} className="anim-fade mt-3">{tab === 'convert' ? <ConversionWorkspace /> : tab === 'migrate' ? <DdMigration /> : tab === 'rules' ? <Rules /> : <Validation />}</div>
    </div>
  );
}

function Rules() {
  const state = useAsync(() => services.rules.listRules(), []);
  const decisions = useReviewStore((s) => s.ruleDecisions);
  const review = useReviewStore((s) => s.reviewRule);
  const [kind, setKind] = useState<RuleKind | ''>('');
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [q, setQ] = useState('');
  return (
    <Card>
      <CardHeader title="Rules" right={<OriginBadge meta={state.meta} />} />
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <Input placeholder="Search table / column / text..." value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <Select value={kind} onChange={(e) => setKind(e.target.value as RuleKind | '')}><option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select>
      </div>
      <AsyncView state={state} isEmpty={(d) => d.length === 0}>
        {(all) => {
          const st = (r: BusinessRule) => decisions[r.id]?.decision ?? 'pending';
          const rows = all.filter((r) => (!kind || r.kind === kind) && (status === 'all' || st(r) === status) && `${r.table} ${r.column ?? ''} ${r.text}`.toLowerCase().includes(q.toLowerCase()));
          return (
            <DataTable<BusinessRule> rows={rows} rowKey={(r) => r.id} pageSize={15}
              columns={[
                { key: 'k', header: 'Kind', render: (r) => <Badge tone="primary">{r.kind}</Badge> },
                { key: 't', header: 'Target', render: (r) => <span className="font-mono text-xs">{r.table}{r.column ? `.${r.column}` : ''}</span> },
                { key: 'x', header: 'Rule', render: (r) => <p className="max-w-2xl text-xs">{r.text}</p> },
                { key: 's', header: 'Source', render: (r) => <span className="text-xs text-muted">{r.sheet} · {r.rowNo}</span> },
                { key: 'st', header: 'Status', render: (r) => <Badge tone={st(r) === 'approved' ? 'ok' : st(r) === 'rejected' ? 'bad' : 'neutral'}>{st(r)}</Badge> },
                { key: 'a', header: '', render: (r) => (
                  <div className="flex gap-1">
                    <Button size="icon" variant="success" aria-label="Approve" onClick={() => review(r.id, 'approved', '')}><Check size={14} /></Button>
                    <Button size="icon" variant="danger" aria-label="Reject" onClick={() => review(r.id, 'rejected', '')}><X size={14} /></Button>
                    {decisions[r.id] && <Button size="icon" variant="outline" aria-label="Reset" onClick={() => useReviewStore.setState((s) => { const n = { ...s.ruleDecisions }; delete n[r.id]; return { ruleDecisions: n }; })}><Undo2 size={14} /></Button>}
                  </div>) },
              ]} />
          );
        }}
      </AsyncView>
    </Card>
  );
}

function Validation() {
  const mappingDecisions = useReviewStore((s) => s.mappingDecisions);
  const manual = useReviewStore((s) => s.manualMappings);
  const reviewed = useMemo(() => selectReviewedMappings({ mappingDecisions, manualMappings: manual }), [mappingDecisions, manual]);
  const state = useAsync(() => services.rules.validate({ reviewed }), [reviewed]);
  const [sev, setSev] = useState<Severity | ''>('');
  const [check, setCheck] = useState('');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Includes {reviewed.length} human-reviewed mapping(s) from Agent 4 (check C7).</span>
        <Button size="sm" variant="outline" onClick={state.reload}>Re-run validation</Button>
      </div>
      <AiInsightPanel title="AI validation review" resetKey={String(reviewed.length)} run={(o) => services.ai.reviewValidation(reviewed, o)} actionLabel="Review results with AI" />
      <AsyncView state={state}>
        {(rep) => {
          const checks = Array.from(new Map(rep.results.map((r) => [r.checkId, r.check])).entries());
          const rows = rep.results.filter((r) => (!sev || r.severity === sev) && (!check || r.checkId === check));
          return (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Passed" value={rep.totals.pass} />
                <Stat label="Warnings" value={rep.totals.warn} />
                <Stat label="Failed" value={rep.totals.fail} />
              </div>
              <p className="text-xs text-muted">{rep.basis}</p>
              <Card>
                <div className="flex flex-wrap gap-2 border-b border-border p-3">
                  <Select value={sev} onChange={(e) => setSev(e.target.value as Severity | '')}><option value="">All results</option><option value="fail">Failed</option><option value="warn">Warnings</option><option value="pass">Passed</option></Select>
                  <Select value={check} onChange={(e) => setCheck(e.target.value)}><option value="">All checks</option>{checks.map(([id, name]) => <option key={id} value={id}>{id} · {name}</option>)}</Select>
                </div>
                <DataTable<ValidationResult> rows={rows} rowKey={(r) => r.id} pageSize={15}
                  columns={[
                    { key: 's', header: 'Result', render: (r) => <Badge tone={sevTone[r.severity]}>{r.severity}</Badge> },
                    { key: 'c', header: 'Check', render: (r) => <span className="text-xs"><span className="font-mono">{r.checkId}</span> {r.check}</span> },
                    { key: 't', header: 'Table / sheet', render: (r) => <span className="font-mono text-xs">{r.table}</span> },
                    { key: 'm', header: 'Detail', render: (r) => (
                      <div className="text-xs"><div>{r.message}</div>
                        {r.items.length > 0 && <details className="mt-1 text-muted"><summary className="cursor-pointer">Show {r.flagged > r.items.length ? `first ${r.items.length} of ${r.flagged}` : r.items.length} item(s)</summary><ul className="mt-1 space-y-0.5 font-mono text-[11px]">{r.items.map((i) => <li key={i}>{i}</li>)}</ul></details>}
                      </div>) },
                  ]} />
              </Card>
            </>
          );
        }}
      </AsyncView>
    </div>
  );
}
