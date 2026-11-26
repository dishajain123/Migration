import { AlertTriangle, ArrowRight, Check, DatabaseZap, FileCode2, RotateCcw, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/Dialog';
import { mapSourceColumnLink } from '@/features/mapping/links';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { decisionOf } from '@/domain/ruleConversion/views';
import { effectiveFields } from '@/domain/ruleConversion/templates';
import { cn } from '@/lib/cn';
import type { RuleAssessment } from '@/domain/ruleConversion/approval';
import { approveRules, withdrawRules, type ApprovalOutcome } from '@/stores/approvalWorkflow';
import { useConversionStore } from '@/stores/conversionStore';
import { useReviewStore } from '@/stores/reviewStore';
import type { ConvertedRule, SqlFileAnalysis, TraqRuleFields } from '@/types';
import { ConfidenceBlock, ConversionBadge, DecisionBadge, IssueList, MappingBadge, Section, SqlPreviewDialog } from './parts';

export function RuleDetail({ rule, file, assessment, onOutcome }: {
  rule: ConvertedRule; file: SqlFileAnalysis | undefined; assessment?: RuleAssessment; onOutcome?: (o: ApprovalOutcome) => void;
}) {
  const edits = useConversionStore((s) => s.edits);
  const batchDate = useConversionStore((s) => s.settings.effectiveStartDate);
  const editRule = useConversionStore((s) => s.editRule);
  const approval = useReviewStore((s) => s.approvals[rule.id]);
  const approve = () => { const res = approveRules([rule], [rule.id], 'single'); onOutcome?.(res); };
  const reject = () => withdrawRules([rule.id], 'rejected');
  const resetRule = (id: string) => withdrawRules([id], null);
  const [preview, setPreview] = useState<[number, number] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const edit = edits[rule.id];
  const f = effectiveFields(rule, edit, '');
  const decision = decisionOf(rule, edits);
  const set = (patch: Partial<TraqRuleFields>) => editRule(rule.id, patch);
  const edited = (k: keyof TraqRuleFields) => edit?.traq?.[k] !== undefined && edit.traq[k] !== rule.traq[k];

  return (
    <Card className="flex max-h-[80vh] flex-col overflow-hidden">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-sm">
          <span title="CrisMac table.column written by the procedure">{rule.crismacTable}.{rule.crismacColumn}</span>
          <ArrowRight size={14} className="text-muted" aria-label="becomes" />
          <span className="font-semibold" title="TRAQ table.column the rule derives">{f.entity ? `${f.entity}.${f.column}` : 'no TRAQ target'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConversionBadge status={rule.status} /><DecisionBadge decision={decision} />
          {edit?.traq && <Badge tone="info">Edited by hand</Badge>}
          <span className="text-xs text-muted">{rule.procedure} · {rule.stage || 'uploaded'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="success" onClick={approve} disabled={decision === 'approved' || (assessment ? !assessment.eligible : false)} title={assessment && !assessment.eligible ? 'This rule cannot be approved yet; see why below.' : 'Approve this rule and save its verified mappings in Agent 4'}><Check size={13} /> Approve</Button>
          <Button size="sm" variant="danger" onClick={reject} disabled={decision === 'rejected'}><X size={13} /> Reject</Button>
          {(edit?.traq || edit?.decision) && <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}><RotateCcw size={13} /> Reset</Button>}
          {approval && approval.mappings.length > 0 && (
            <span title={`${approval.mappings.length} mapping(s) saved or reused when this rule was approved`}><Badge tone="ok"><span className="inline-flex items-center gap-1"><DatabaseZap size={10} /> Mapping saved automatically</span></Badge></span>
          )}
        </div>
        {decision !== 'approved' && assessment && !assessment.eligible && (
          <div role="alert" className="mt-1 rounded-md border border-warn bg-surface2 p-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle size={13} className="text-warn" /> Cannot be approved yet</div>
            <ul className="list-disc space-y-0.5 pl-4 text-muted">{assessment.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            {(() => {
              const first = [rule.target, ...rule.references].find((r) => !['approved', 'documented', 'name-match'].includes(r.status));
              return <Link to={first ? mapSourceColumnLink(first.crismacTable, first.crismacColumn) : '/mapping'} className="mt-1 inline-block text-primary hover:underline">{first ? `Fix mapping for ${first.crismacColumn} in Agent 4` : 'Fix mappings in Agent 4'}</Link>;
            })()}
          </div>
        )}
      </div>

      <div key={rule.id} className="anim-fade min-h-0 flex-1 space-y-5 overflow-auto p-4">
        <Section title="Issues and warnings">
          <IssueList issues={rule.issues} empty="No issues: every column used a documented or approved mapping." />
        </Section>

        <Section title="Original CrisMac procedure" hint="The statements that set this column, in execution order, exactly as written.">
          <ol className="space-y-2">
            {rule.statements.map((s) => (
              <li key={s.stepId} className="rounded-md border border-border p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone="primary">{s.type}</Badge>
                  <span className="text-muted">step {s.stepIndex}</span>
                  <button type="button" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline disabled:text-muted" disabled={!file?.content} onClick={() => setPreview([s.lineStart, s.lineEnd])}>
                    <FileCode2 size={12} /> lines {s.lineStart}-{s.lineEnd}
                  </button>
                </div>
                <Code>{`${rule.crismacColumn} = ${s.expression}`}</Code>
                {s.guards.length > 0 && <Labelled label="Runs when (IF/ELSE)"><Code>{s.guards.join(' AND ')}</Code></Labelled>}
                {s.joins.length > 0 && <Labelled label="Joins">{s.joins.map((j) => <Code key={`${j.table}-${j.alias}`}>{`${j.kind} ${j.table}${j.alias ? ` ${j.alias}` : ''}${j.on ? ` ON ${j.on}` : ''}`}</Code>)}</Labelled>}
                {s.where && <Labelled label="WHERE"><Code>{s.where}</Code></Labelled>}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Extracted business rule (CrisMac terms)" hint="All statements composed into one expression: each later statement sees the earlier result.">
          <Code>{rule.crismacLogic}</Code>
        </Section>

        <Section title="Column mapping used" hint="From Agent 4 decisions and the workbook mapping rows.">
          <table className="w-full text-left text-xs">
            <thead className="text-muted"><tr><th className="py-1 pr-2 font-medium">Role</th><th className="py-1 pr-2 font-medium">CrisMac</th><th className="py-1 pr-2 font-medium">TRAQ</th><th className="py-1 font-medium">Mapping</th></tr></thead>
            <tbody>
              {[{ role: 'writes', r: rule.target }, ...rule.references.map((r) => ({ role: 'reads', r }))].map(({ role, r }) => (
                <tr key={`${role}-${r.crismacTable}.${r.crismacColumn}`} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2 text-muted">{role}</td>
                  <td className="py-1.5 pr-2 font-mono">{r.crismacTable}.{r.crismacColumn}</td>
                  <td className="py-1.5 pr-2 font-mono">{r.chosen ? `${r.chosen.table}.${r.chosen.column}` : '-'}</td>
                  <td className="py-1.5">
                    <MappingBadge status={r.status} note={r.note} />
                    {!['approved', 'documented', 'name-match'].includes(r.status) && (
                      <Link to={mapSourceColumnLink(r.crismacTable, r.crismacColumn)} className="mt-0.5 block text-primary hover:underline">Map {r.crismacColumn} in Agent 4</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {approval && (
            <details className="rounded-md border border-border p-2 text-xs">
              <summary className="cursor-pointer font-medium">Mappings recorded at approval ({approval.mappings.filter((m) => m.action === 'created').length} saved, {approval.mappings.filter((m) => m.action === 'reused').length} reused)</summary>
              <ul className="mt-1 space-y-1">
                {approval.mappings.map((m) => (
                  <li key={m.key}><span className="font-mono">{m.key} → {m.targetTable}.{m.targetColumn}</span> <Badge tone={m.action === 'created' ? 'ok' : 'info'}>{m.action === 'created' ? 'saved to Agent 4' : 'reused'}</Badge><div className="text-muted">{m.evidence}</div></li>
                ))}
              </ul>
            </details>
          )}
          {rule.params.length > 0 && (
            <p className="text-xs text-muted">Parameters: {rule.params.map((p) => `${p.name} ${p.status === 'unresolved' ? '(not set)' : `-> ${p.value}`}`).join('; ')}.</p>
          )}
          {rule.target.chosen && <Link to={`/mapping?table=${encodeURIComponent(rule.target.chosen.table)}`} className="text-xs text-primary hover:underline">Review {rule.target.chosen.table} mappings in Agent 4</Link>}
          {rule.target.chosen && <Link to={`/lineage?table=${encodeURIComponent(rule.target.chosen.table)}`} className="ml-3 text-xs text-primary hover:underline">See its lineage in Agent 2</Link>}
        </Section>

        <Section title="Translated TRAQ rule" hint="Generated by rule-based rewriting. Edit anything below; edits are kept and exported.">
          <EditText label="Display Derivation Expression" value={f.expression} edited={edited('expression')} mono rows={6} onCommit={(v) => set({ expression: v })} onRestore={() => set({ expression: rule.traq.expression })} />
          <div className="grid gap-2 sm:grid-cols-2">
            {rule.target.candidates.length > 1 ? (
              <label className="text-xs">
                <span className="mb-1 block font-medium">TRAQ target (ambiguous)</span>
                <Select className="w-full" value={`${f.entity}.${f.column}`} onChange={(e) => { const [entity, column] = e.target.value.split('.'); set({ entity, column }); }}>
                  {rule.target.candidates.map((c) => <option key={`${c.table}.${c.column}`} value={`${c.table}.${c.column}`}>{c.table}.{c.column} ({c.basis})</option>)}
                </Select>
                <span className="mt-0.5 block text-[11px] text-muted">The expression was generated for {rule.traq.entity}; check its table references after changing.</span>
              </label>
            ) : (
              <ReadOnly label="Entity / column" value={f.entity ? `${f.entity}.${f.column}` : 'Not mapped'} />
            )}
            <label className="text-xs">
              <span className="mb-1 block font-medium">Column Type</span>
              <Select className="w-full" value={f.columnType} onChange={(e) => set({ columnType: e.target.value })}>
                <option value="">(not set)</option><option value="Physical">Physical</option><option value="Temporary">Temporary</option>
              </Select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">Data Type</span>
              <Select className="w-full" value={f.dataType} onChange={(e) => set({ dataType: e.target.value })}>
                <option value="">(not set)</option>{['Date', 'Integer', 'String', 'Decimal'].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">Effective start date</span>
              <Input type="date" className="w-full" value={f.effectiveStartDate} onChange={(e) => set({ effectiveStartDate: e.target.value })} />
              <span className="mt-0.5 block text-[11px] text-muted">{f.effectiveStartDate ? 'Set for this rule.' : batchDate ? `Uses the batch date ${batchDate}.` : 'No batch date set (Step 3).'}</span>
            </label>
          </div>
          <EditText label="Rule Explanation" value={f.explanation} edited={edited('explanation')} rows={4} onCommit={(v) => set({ explanation: v })} onRestore={() => set({ explanation: rule.traq.explanation })} />
          <p className="text-[11px] text-muted">Reads: {f.reads.length ? f.reads.join(', ') : 'no TRAQ columns'} · Source: {f.crismac}</p>
        </Section>

        <Section title="Confidence">
          <ConfidenceBlock rule={rule} />
        </Section>

        {rule.dependencies.length > 0 && (
          <Section title="Depends on other procedures" hint="These procedures write columns this rule reads; their rules must run first in TRAQ.">
            <p className="font-mono text-xs">{rule.dependencies.join(', ')}</p>
          </Section>
        )}
      </div>

      <SqlPreviewDialog open={!!preview} onClose={() => setPreview(null)} fileName={file?.fileName ?? rule.procedureFile} content={file?.content ?? ''} highlight={preview ?? undefined} />
      <ConfirmDialog open={confirmReset} onCancel={() => setConfirmReset(false)} onConfirm={() => resetRule(rule.id)} title="Reset this rule?" confirmLabel="Reset" tone="danger"
        body="Your edits and the approve/reject decision for this rule are discarded and the generated version is shown again." />
    </Card>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface2 p-2 font-mono text-[11px] leading-relaxed">{children}</pre>;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mt-1.5"><div className="mb-0.5 text-[11px] font-medium text-muted">{label}</div><div className="space-y-1">{children}</div></div>;
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="text-xs"><span className="mb-1 block font-medium">{label}</span><div className="flex h-9 items-center rounded-md border border-border bg-surface2 px-3 font-mono">{value}</div></div>;
}

/** Text area that keeps typing local and saves on blur, so the persisted store is not written on every key. */
function EditText({ label, value, edited, mono, rows, onCommit, onRestore }: {
  label: string; value: string; edited: boolean; mono?: boolean; rows: number; onCommit: (v: string) => void; onRestore: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="block text-xs">
      <span className="mb-1 flex items-center gap-2 font-medium">{label}{edited && <Badge tone="info">edited</Badge>}
        {edited && <button type="button" onClick={onRestore} className="ml-auto font-normal text-primary hover:underline">Restore generated</button>}
      </span>
      <textarea
        value={draft} rows={rows} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }}
        className={cn('w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-primary', mono && 'font-mono text-[11px]')}
      />
    </label>
  );
}
