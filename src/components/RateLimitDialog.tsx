import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiGateway, useAiStore } from '@/stores/aiStore';
import { useRateLimitStore } from '@/stores/rateLimitStore';
import type { ProviderId } from '@/types/ai';
import { Dialog } from './Dialog';
import { Button, Select } from './ui';

/**
 * Shown when a request hits a provider rate limit (HTTP 429). The user chooses another provider and/or model and
 * retries the same request. Mounted once in the layout; opened by `withRateLimitRecovery`.
 */
export function RateLimitDialog() {
  const { request, settle } = useRateLimitStore();
  const { overview, load } = useAiStore();
  const [provider, setProvider] = useState<ProviderId | ''>('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [makeActive, setMakeActive] = useState(true);

  useEffect(() => { if (request && !overview) void load(); }, [request, overview, load]);

  const usable = useMemo(() => (overview?.providers ?? []).filter((p) => p.settings.hasKey || !p.info.requiresKey), [overview]);
  const unconfigured = useMemo(() => (overview?.providers ?? []).filter((p) => !usable.includes(p)), [overview, usable]);

  // Each time the dialog opens, start from the failed provider with its current model so a model switch is one click.
  useEffect(() => {
    if (!request) return;
    const start = request.failed?.provider ?? usable[0]?.info.id ?? '';
    setProvider(start);
    setModel(request.failed?.model ?? '');
    setMakeActive(true);
  }, [request, usable]);

  useEffect(() => {
    if (!request || !provider) return;
    let alive = true;
    setModelState('loading'); setModels([]);
    void aiGateway.listModels(provider).then((r) => {
      if (!alive) return;
      if (r.data) {
        setModels(r.data); setModelState('idle');
        setModel((cur) => (cur && r.data?.includes(cur) ? cur : overview?.providers.find((p) => p.info.id === provider)?.settings.model ?? r.data?.[0] ?? ''));
      } else setModelState('error');
    });
    return () => { alive = false; };
  }, [request, provider, overview]);

  // Stable callback: Dialog re-runs its focus management whenever onClose changes identity.
  const cancel = useCallback(() => settle(null), [settle]);
  const same = !!request?.failed && request.failed.provider === provider && request.failed.model === model;
  const label = (id?: ProviderId) => overview?.providers.find((p) => p.info.id === id)?.info.label ?? id ?? 'The selected provider';

  return (
    <Dialog
      open={!!request}
      onClose={cancel}
      size="md"
      title={<span className="flex items-center gap-2"><Gauge size={16} className="text-warn" /> Rate limit reached</span>}
      description="Nothing was changed. Choose how to continue, or cancel."
      footer={(
        <>
          <Button variant="outline" onClick={cancel}>Cancel</Button>
          <Button disabled={!provider || !model.trim()} onClick={() => provider && settle({ provider, model: model.trim(), makeActive })}>
            <RefreshCw size={14} /> Retry with {provider ? label(provider) : 'selection'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        <p>
          <strong>{label(request?.failed?.provider)}</strong>{request?.failed?.model && <> (<span className="font-mono text-xs">{request.failed.model}</span>)</>} has exceeded its rate limit.
          You can wait and retry, or switch to a different provider or model and send the same request again.
        </p>
        <p className="rounded-md bg-surface2 p-2 text-xs text-muted">{request?.message}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rl-provider" className="mb-1 block text-xs font-medium">Provider</label>
            <Select id="rl-provider" className="w-full" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {usable.map((p) => <option key={p.info.id} value={p.info.id}>{p.info.label}{p.info.id === request?.failed?.provider ? ' (rate limited)' : ''}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="rl-model" className="mb-1 flex items-center gap-1.5 text-xs font-medium">Model {modelState === 'loading' && <Loader2 size={11} className="animate-spin" />}</label>
            {models.length > 0 ? (
              <Select id="rl-model" className="w-full font-mono text-xs" value={model} onChange={(e) => setModel(e.target.value)}>
                {!models.includes(model) && model && <option value={model}>{model}</option>}
                {models.map((m) => <option key={m} value={m}>{m}{m === request?.failed?.model && provider === request.failed.provider ? ' (rate limited)' : ''}</option>)}
              </Select>
            ) : (
              <input id="rl-model" className="h-9 w-full rounded-md border border-border bg-surface px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model id" />
            )}
            {modelState === 'error' && <p className="mt-1 text-xs text-muted">Could not list models for this provider; type a model id.</p>}
          </div>
        </div>

        {same && <p className="text-xs text-warn">This is the provider and model that was just rate limited. Pick a different model or provider, or wait a moment before retrying.</p>}
        {usable.length === 0 && <p className="text-xs text-bad">No provider has a key yet. <Link to="/ai-settings" onClick={() => settle(null)} className="underline">Open AI Settings</Link></p>}
        {unconfigured.length > 0 && usable.length > 0 && (
          <p className="text-xs text-muted">Not listed (no key yet): {unconfigured.map((p) => p.info.label).join(', ')}. <Link to="/ai-settings" onClick={() => settle(null)} className="text-primary underline">Add one</Link></p>
        )}

        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} />
          <span>Make this my active provider and model for the app. Untick to use it for this retry only.</span>
        </label>
      </div>
    </Dialog>
  );
}
