import { AlertCircle, CheckCircle2, DatabaseZap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog } from '@/components/Dialog';
import { Badge, Button } from '@/components/ui';
import type { ApprovalPlan } from '@/domain/ruleConversion/approval';
import { cn } from '@/lib/cn';
import type { ApprovalOutcome } from '@/stores/approvalWorkflow';

const SHOWN = 8;

/** Confirmation before approving several rules: what will be approved, what cannot be and why, which mappings get saved. */
export function ApproveDialog({ open, onClose, title, plan, onConfirm }: {
  open: boolean; onClose: () => void; title: string; plan: ApprovalPlan; onConfirm: () => void;
}) {
  const n = plan.eligible.length;
  return (
    <Dialog
      open={open} onClose={onClose} title={title} size="md"
      description="Approving also saves each rule's verified CrisMac to TRAQ column mappings in Agent 4, so you do not enter them again."
      footer={<>
        <Button variant="outline" onClick={onClose} data-autofocus>Cancel</Button>
        <Button variant="success" disabled={n === 0} onClick={() => { onConfirm(); onClose(); }}>Approve {n} rule{n === 1 ? '' : 's'}</Button>
      </>}
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile label="Can be approved" value={n} tone="ok" />
          <Tile label="Cannot be approved" value={plan.ineligible.length} tone={plan.ineligible.length ? 'bad' : 'neutral'} />
          <Tile label="Already approved" value={plan.alreadyApproved.length} tone="neutral" />
        </div>

        <div className="rounded-md border border-border p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><DatabaseZap size={13} /> Mappings saved to Agent 4</div>
          <p><b>{plan.newMappings.length}</b> new · <b>{plan.reusedCount}</b> already in Agent 4 or documented in the workbook (reused, not duplicated).</p>
          {plan.newMappings.length > 0 && (
            <>
              <p className="mt-1 text-muted">New mappings are exact same-name TRAQ columns, or targets you picked, that you confirm by approving:</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                {plan.newMappings.slice(0, SHOWN).map((m) => <li key={`${m.key}>${m.targetTable}.${m.targetColumn}`}>{m.key} → {m.targetTable}.{m.targetColumn}</li>)}
              </ul>
              {plan.newMappings.length > SHOWN && <p className="mt-0.5 text-muted">+{plan.newMappings.length - SHOWN} more</p>}
            </>
          )}
        </div>

        {plan.ineligible.length > 0 && (
          <div className="rounded-md border border-border p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-bad"><AlertCircle size={13} /> Skipped: these stay pending and nothing is saved for them</div>
            <ul className="space-y-1">
              {plan.ineligible.slice(0, SHOWN).map((a) => (
                <li key={a.ruleId}><span className="font-mono">{a.label}</span> <span className="text-muted">({a.procedure})</span><div className="text-muted">{a.blockers[0]}{a.blockers.length > 1 ? ` (+${a.blockers.length - 1} more)` : ''}</div></li>
              ))}
            </ul>
            {plan.ineligible.length > SHOWN && <p className="mt-1 text-muted">+{plan.ineligible.length - SHOWN} more</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'neutral' }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className={cn('text-xl font-semibold tabular-nums', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad')}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

/** Result of an approval: counts, the automatic mapping indicator, and the reasons for anything skipped. */
export function OutcomeBanner({ outcome, onDismiss }: { outcome: ApprovalOutcome; onDismiss: () => void }) {
  const approved = outcome.approved.length;
  const bad = !outcome.ok;
  return (
    <div role="status" className={cn('anim-fade rounded-md border px-3 py-2 text-sm', bad ? 'border-bad bg-badbg text-bad' : approved ? 'border-ok bg-okbg text-ok' : 'border-warn bg-surface2')}>
      <div className="flex flex-wrap items-center gap-2">
        {bad ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        <span className="font-medium">
          {bad ? outcome.error : approved
            ? `Approved ${approved} rule${approved === 1 ? '' : 's'}.`
            : outcome.alreadyApproved ? 'Those rules were already approved.' : 'No rule was approved.'}
        </span>
        {!bad && approved > 0 && (
          <>
            <Badge tone="ok">Mapping saved automatically</Badge>
            <span className="text-xs">{outcome.mappingsSaved} new mapping{outcome.mappingsSaved === 1 ? '' : 's'} saved, {outcome.mappingsReused} reused.</span>
            <Link to="/mapping" className="text-xs underline">See in Agent 4</Link>
          </>
        )}
        {outcome.skipped.length > 0 && <span className="text-xs text-bad">{outcome.skipped.length} could not be approved.</span>}
        <button type="button" className="ml-auto text-xs underline" onClick={onDismiss}>Dismiss</button>
      </div>
      {outcome.skipped.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-muted">Why they could not be approved</summary>
          <ul className="mt-1 space-y-1">
            {outcome.skipped.slice(0, 15).map((s) => <li key={s.ruleId}><span className="font-mono">{s.label}</span>: {s.reasons[0]}</li>)}
          </ul>
          {outcome.skipped.length > 15 && <p className="text-muted">+{outcome.skipped.length - 15} more; open a rule to see all reasons.</p>}
        </details>
      )}
    </div>
  );
}
