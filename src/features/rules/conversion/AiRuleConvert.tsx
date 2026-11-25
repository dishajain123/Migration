import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { isOpenRule, MAX_AI_RULES, type AiRuleSet } from '@/domain/ruleConversion/aiRuleConvert';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { withRateLimitRecovery } from '@/stores/rateLimitStore';
import type { ConvertedRule } from '@/types';

const CONFIG_CODES = new Set(['NOT_CONFIGURED', 'MISSING_KEY', 'INVALID_KEY', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'INCOMPATIBLE']);
const MAX_BATCHES = 10;

type State =
  | { status: 'idle' } | { status: 'loading'; done: number; total: number }
  | { status: 'error'; code: string; message: string }
  | { status: 'done'; applied: number; rejected: AiRuleSet['rejected']; unresolved: AiRuleSet['unresolved']; by: string };

/**
 * Agent 5's AI step. The rule-based converter runs first; this asks the model to finish the rules it could not. Only expressions that
 * pass validation (documented functions, in-scope TRAQ columns, no placeholders) are applied, and they are labelled as AI. Mapping
 * blockers are unchanged, so a rule still needs confirmed columns and approval before it is Ready.
 */
export function AiRuleConvert({ rules }: { rules: ConvertedRule[] }) {
  const edits = useConversionStore((s) => s.edits);
  const apply = useConversionStore((s) => s.applyAiRules);
  const [state, setState] = useState<State>({ status: 'idle' });
  const open = rules.filter((r) => isOpenRule(r) && !edits[r.id]?.aiConverted && edits[r.id]?.decision !== 'rejected');

  const go = async () => {
    const queue = [...open];
    const total = Math.min(queue.length, MAX_BATCHES * MAX_AI_RULES);
    let applied = 0; let by = '';
    const rejected: AiRuleSet['rejected'] = []; const unresolved: AiRuleSet['unresolved'] = [];
    for (let i = 0; i < MAX_BATCHES && queue.length > 0; i++) {
      setState({ status: 'loading', done: Math.min(i * MAX_AI_RULES, total), total });
      const batch = queue.splice(0, MAX_AI_RULES);
      const r = await withRateLimitRecovery((o) => services.ai.convertRulesWithAi({ rules: batch }, o));
      if (!r.data) { setState({ status: 'error', code: r.error?.code ?? 'ERROR', message: r.error?.message ?? 'The AI request failed.' }); return; }
      by = `${r.meta.provider ?? 'AI'} · ${r.meta.model ?? ''}`;
      apply(r.data.proposals, { provider: r.meta.provider ?? '', model: r.meta.model ?? '' });
      applied += r.data.proposals.length; rejected.push(...r.data.rejected); unresolved.push(...r.data.unresolved);
    }
    setState({ status: 'done', applied, rejected, unresolved, by });
  };

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-1.5"><Sparkles size={14} className="text-primary" /> Convert open rules with AI</span>}
        subtitle="The rule-based converter runs first. The model then completes the rules it could not finish, using the CrisMac logic, the mappings and the in-scope TRAQ columns. Only valid expressions are applied."
        right={(
          <div className="flex items-center gap-2">
            {state.status === 'done' && <Badge tone="primary">AI · {state.by}</Badge>}
            <Button size="sm" onClick={() => void go()} disabled={state.status === 'loading' || open.length === 0}>
              {state.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {state.status === 'loading' ? `Working ${state.done}/${state.total}...` : `Convert ${open.length} open rule(s)`}
            </Button>
          </div>
        )}
      />
      <div aria-live="polite" className="p-3 text-sm">
        {state.status === 'idle' && <p className="text-muted">{open.length === 0 ? 'No open rules: everything the converter could finish is done.' : 'Nothing is sent until you click. Only column names, types and the CrisMac rule text of the open rules are included.'}</p>}
        {state.status === 'loading' && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> Waiting for the model, then validating each expression...</p>}
        {state.status === 'error' && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-bad bg-badbg p-2 text-bad">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>{state.message}{CONFIG_CODES.has(state.code) && <> <Link to="/ai-settings" className="font-medium underline">Open AI Settings</Link></>}</div>
          </div>
        )}
        {state.status === 'done' && (
          <div className="space-y-2">
            <p role="status" className="rounded-md bg-okbg px-3 py-2 text-ok">Applied {state.applied} AI expression(s). They are drafts: approve each rule in step 4. Rules with unmapped columns stay incomplete until those are mapped.</p>
            {state.rejected.length > 0 && (
              <details className="text-xs"><summary className="cursor-pointer text-muted">{state.rejected.length} answer(s) dropped by the validators</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{state.rejected.map((d, i) => <li key={i}><span className="font-mono">{d.ruleId}</span>: {d.reason}</li>)}</ul></details>
            )}
            {state.unresolved.length > 0 && (
              <details className="text-xs"><summary className="cursor-pointer text-muted">{state.unresolved.length} rule(s) the AI could not finish (they keep the CrisMac logic in the demo file)</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{state.unresolved.map((u) => <li key={u.ruleId}><span className="font-mono">{u.ruleId}</span>: {u.reason}</li>)}</ul></details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
