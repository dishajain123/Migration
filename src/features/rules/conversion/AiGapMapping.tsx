import { AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, DataTable } from '@/components/ui';
import type { GapMappingProposal, GapMappingSet } from '@/domain/ruleConversion/aiGapMapping';
import type { ColumnGap } from '@/domain/ruleConversion/gaps';
import { services } from '@/services';
import { withRateLimitRecovery } from '@/stores/rateLimitStore';
import { useReviewStore } from '@/stores/reviewStore';
import type { ApiMeta, ConvertedRule } from '@/types';

const CONFIG_CODES = new Set(['NOT_CONFIGURED', 'MISSING_KEY', 'INVALID_KEY', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'INCOMPATIBLE']);

type State =
  | { status: 'idle' } | { status: 'loading' }
  | { status: 'error'; code: string; message: string }
  | { status: 'success'; set: GapMappingSet; meta: ApiMeta };

/**
 * AI draft mappings for the columns that block rules. The model only picks from the in-scope TRAQ columns and every pick is
 * validated (domain/ruleConversion/aiGapMapping.ts); nothing is saved until the reviewer accepts it here, and an accepted
 * pair is stored as an Agent 4 manual mapping like any other.
 */
export function AiGapMapping({ gaps, rules }: { gaps: ColumnGap[]; rules: ConvertedRule[] }) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const gapSig = gaps.map((g) => g.key).join('|');
  useEffect(() => { setState({ status: 'idle' }); }, [gapSig]);

  const go = async () => {
    setState({ status: 'loading' });
    const r = await withRateLimitRecovery((o) => services.ai.proposeGapMappings({ gaps, rules }, o));
    setState(r.data ? { status: 'success', set: r.data, meta: r.meta } : { status: 'error', code: r.error?.code ?? 'ERROR', message: r.error?.message ?? 'The AI request failed.' });
  };

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-primary" /> Map the missing columns with AI</span>}
        subtitle="The model sees each missing CrisMac column, the rule logic that uses it, how the workbook already maps that table, and the in-scope TRAQ columns. Picks outside those columns or with incompatible types are dropped. Nothing is saved until you accept it."
        right={(
          <div className="flex items-center gap-2">
            {state.status === 'success' && state.meta.provider && <Badge tone="primary">AI · {state.meta.provider} · {state.meta.model}</Badge>}
            <Button size="sm" variant={state.status === 'success' ? 'outline' : 'default'} onClick={() => void go()} disabled={state.status === 'loading' || gaps.length === 0}>
              {state.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {state.status === 'loading' ? 'Working...' : state.status === 'success' ? 'Regenerate' : `Propose mappings for ${gaps.length} column(s)`}
            </Button>
          </div>
        )}
      />
      <div aria-live="polite" className="p-3 text-sm">
        {state.status === 'idle' && <p className="text-muted">Nothing is sent until you click. Only workbook column names, types and the CrisMac rule text of the affected rules are included.</p>}
        {state.status === 'loading' && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Waiting for the model, then validating its answer...</p>}
        {state.status === 'error' && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-bad bg-badbg p-2 text-bad">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>{state.message}{CONFIG_CODES.has(state.code) && <> <Link to="/ai-settings" className="font-medium underline">Open AI Settings</Link></>}</div>
          </div>
        )}
        {state.status === 'success' && <Proposals set={state.set} note={state.meta.note} />}
      </div>
    </Card>
  );
}

function Proposals({ set, note }: { set: GapMappingSet; note?: string }) {
  const manual = useReviewStore((s) => s.manualMappings);
  const add = useReviewStore((s) => s.addManualMapping);
  const exists = (p: GapMappingProposal) => manual.some((m) => m.sourceTable.toUpperCase() === p.crismacTable.toUpperCase() && m.sourceColumn.toUpperCase() === p.crismacColumn.toUpperCase()
    && m.targetTable === p.traqTable && m.targetColumn === p.traqColumn);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const open = set.proposals.filter((p) => !exists(p));
  const chosen = open.filter((p) => !skip.has(p.gapKey));

  const save = (list: GapMappingProposal[]) => {
    for (const p of list) {
      add({
        targetTable: p.traqTable, targetColumn: p.traqColumn, targetType: p.traqType, sourceTable: p.crismacTable, sourceColumn: p.crismacColumn, sourceType: '',
        note: `AI draft accepted by reviewer (AI estimate ${p.confidence}%): ${p.reason}`, origin: 'ai-accepted',
        evidence: `AI proposal accepted by the reviewer. ${p.typeNote}.`,
      });
    }
  };
  const toggle = (k: string) => setSkip((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-2">
      {set.proposals.length === 0
        ? <p className="text-muted">The model made no proposal that passed validation.</p>
        : (
          <>
            <DataTable<GapMappingProposal>
              rows={set.proposals} rowKey={(p) => p.gapKey} pageSize={12}
              columns={[
                { key: 'x', header: '', className: 'w-8', render: (p) => (exists(p)
                  ? <Check size={14} className="text-ok" aria-label="Already saved" />
                  : <input type="checkbox" aria-label={`Accept ${p.gapKey}`} checked={!skip.has(p.gapKey)} onChange={() => toggle(p.gapKey)} />) },
                { key: 's', header: 'CrisMac column', render: (p) => <span className="font-mono text-xs">{p.crismacTable}.{p.crismacColumn}</span> },
                { key: 't', header: 'Proposed TRAQ column', render: (p) => <div className="font-mono text-xs">{p.traqTable}.{p.traqColumn}<div className="text-muted">{p.traqType || '-'}</div></div> },
                { key: 'c', header: 'AI estimate', className: 'w-20', render: (p) => <span className="text-xs tabular-nums">{p.confidence}%</span> },
                { key: 'w', header: 'Why / checks', render: (p) => (
                  <div className="space-y-1 text-xs">
                    <div className="flex flex-wrap gap-1"><Badge tone="info">AI_DRAFT</Badge>{p.typeCheck === 'warn' && <Badge tone="warn">type needs conversion</Badge>}{p.typeCheck === 'unknown' && <Badge tone="neutral">type not checked</Badge>}</div>
                    <div>{p.reason}</div>
                    <div className="text-muted">{p.typeNote}</div>
                  </div>) },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => save(chosen)} disabled={chosen.length === 0}>Accept {chosen.length} selected as Agent 4 mappings</Button>
              <span className="text-xs text-muted">Saved as manual mappings (labelled AI draft, accepted by reviewer). The affected rules still need approval in step 4.</span>
            </div>
          </>
        )}
      {set.rejected.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{set.rejected.length} pick(s) dropped by the validators</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{set.rejected.map((d, i) => <li key={i}><span className="font-mono">{d.gapKey}{d.traq !== '.' ? ` -> ${d.traq}` : ''}</span>: {d.reason}</li>)}</ul>
        </details>
      )}
      {set.unresolved.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{set.unresolved.length} column(s) left unmapped</summary>
          <ul className="mt-1 list-disc pl-5">{set.unresolved.map((u) => <li key={u.gapKey}><span className="font-mono">{u.gapKey}</span>: {u.reason}</li>)}</ul>
        </details>
      )}
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  );
}
