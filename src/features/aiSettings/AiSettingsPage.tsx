import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Button, Card, CardHeader, Input, PageHeader, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { aiGateway, useAiStore } from '@/stores/aiStore';
import type { ProviderEntry, TestConnectionResult } from '@/types/ai';
import { buildSaveRequest, type ProviderFormValues } from './formModel';

export function AiSettingsPage() {
  const { overview, status, error, load } = useAiStore();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { void load(); }, [load]);

  const state = {
    status: status === 'error' ? 'error' as const : status === 'ready' ? 'success' as const : 'loading' as const,
    data: overview, meta: null, error, reload: () => { void load(); },
  };
  return (
    <div>
      <PageHeader
        title="AI Settings"
        description="Choose the AI provider and model every agent uses. Keys are encrypted on the gateway server and never returned to the browser."
        right={<span className="flex items-center gap-2">
          <InfoTip title="Test connection vs. Save vs. Save & activate" align="right">
            <span><b>Test connection:</b> checks the key works - nothing is saved yet.</span>
            <span><b>Save:</b> stores this provider's key/model so it's ready to use, without changing which provider is active.</span>
            <span><b>Save & activate:</b> saves and switches every agent to this provider/model right away.</span>
          </InfoTip>
          {overview?.active && <Badge tone="ok">Active: {overview.providers.find((p) => p.info.id === overview.active?.provider)?.info.label} · {overview.active.model}</Badge>}
        </span>}
      />
      <AsyncView state={state}>
        {(o) => {
          const entry = o.providers.find((p) => p.info.id === selected) ?? o.providers.find((p) => p.info.id === o.active?.provider) ?? o.providers[0];
          return (
            <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
              <Card className="h-fit p-2">
                <ul className="space-y-0.5" aria-label="AI providers">
                  {o.providers.map((p) => {
                    const isActive = o.active?.provider === p.info.id;
                    return (
                      <li key={p.info.id}>
                        <button
                          onClick={() => setSelected(p.info.id)}
                          aria-current={entry.info.id === p.info.id}
                          className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm', entry.info.id === p.info.id ? 'bg-primarybg font-medium text-primary' : 'hover:bg-surface2')}
                        >
                          <span className="truncate">{p.info.label}</span>
                          {isActive ? <Badge tone="ok">Active</Badge>
                            : p.settings.hasKey || !p.info.requiresKey && p.settings.model ? <Badge tone="info">Configured</Badge>
                            : <Badge>Not set</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <ProviderForm key={entry.info.id} entry={entry} isActive={o.active?.provider === entry.info.id} />
            </div>
          );
        }}
      </AsyncView>
      <p className="mt-4 text-xs text-muted">
        Demo identity: settings are stored on the local gateway under your demo sign-in id. This is not real authentication.
      </p>
    </div>
  );
}

function ProviderForm({ entry, isActive }: { entry: ProviderEntry; isActive: boolean }) {
  const { info, settings } = entry;
  const { save, activate, deactivate, removeKey } = useAiStore();
  const [v, setV] = useState<ProviderFormValues>({
    apiKey: '', baseUrl: settings.baseUrl ?? '', model: settings.model ?? '',
    temperature: settings.temperature?.toString() ?? '', maxTokens: settings.maxTokens?.toString() ?? '',
  });
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'test' | 'save' | 'activate' | 'remove'>(null);
  const [test, setTest] = useState<TestConnectionResult | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof ProviderFormValues) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const keyReady = !info.requiresKey || settings.hasKey || v.apiKey.trim() !== '';
  // Load the model list automatically when a key (or no key) is available, so the dropdown is populated without a manual test.
  useEffect(() => {
    if (info.requiresKey && !settings.hasKey) return;
    let live = true;
    void aiGateway.listModels(info.id).then((r) => { if (live && r.data) setModels(r.data); });
    return () => { live = false; };
  }, [info.id, info.requiresKey, settings.hasKey]);

  const runTest = async () => {
    setBusy('test'); setNotice(null);
    const r = await aiGateway.testConnection(info.id, {
      apiKey: v.apiKey.trim() || undefined, baseUrl: info.usesBaseUrl ? v.baseUrl : undefined, model: v.model || undefined,
    });
    if (r.data) { setTest(r.data); setModels(r.data.models); }
    else setTest({ ok: false, message: r.error?.message ?? 'Test failed.', models: [], latencyMs: r.meta.latencyMs });
    setBusy(null);
  };

  const persist = async (): Promise<boolean> => {
    const built = buildSaveRequest(info, v);
    if (!built.ok) { setNotice({ ok: false, text: built.error }); return false; }
    const err = await save(info.id, built.request);
    if (err) { setNotice({ ok: false, text: err }); return false; }
    setV((x) => ({ ...x, apiKey: '' }));
    return true;
  };
  const onSave = async () => {
    setBusy('save'); setNotice(null);
    if (await persist()) setNotice({ ok: true, text: 'Saved.' });
    setBusy(null);
  };
  const onActivate = async () => {
    setBusy('activate'); setNotice(null);
    if (await persist()) {
      const err = await activate(info.id, v.model.trim() || undefined);
      setNotice(err ? { ok: false, text: err } : { ok: true, text: `${info.label} is now active for all agents.` });
    }
    setBusy(null);
  };
  const onRemove = async () => {
    setBusy('remove'); setNotice(null);
    const err = await removeKey(info.id);
    setNotice(err ? { ok: false, text: err } : { ok: true, text: 'Key removed.' });
    setTest(null);
    setBusy(null);
  };

  return (
    <Card>
      <CardHeader
        title={info.label}
        subtitle={info.requiresKey ? 'Requires your own API key.' : 'Runs locally; no API key needed.'}
        right={<a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={info.keyHelpUrl} target="_blank" rel="noreferrer">{info.requiresKey ? 'Get a key' : 'Get Ollama'} <ExternalLink size={11} /></a>}
      />
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); void onSave(); }}>
        {info.requiresKey && (
          <div>
            <label htmlFor="apiKey" className="mb-1 flex items-center gap-1.5 text-xs font-medium"><KeyRound size={12} /> API key {settings.keySource === 'user' && <Badge tone="ok">Saved</Badge>}{settings.keySource === 'env' && <Badge tone="info">From server environment</Badge>}</label>
            <Input id="apiKey" type="password" autoComplete="off" spellCheck={false} className="w-full font-mono" value={v.apiKey} onChange={set('apiKey')}
              placeholder={settings.hasKey ? '•••••••••••• in use (type to replace)' : 'Paste your API key'} />
            {settings.keySource === 'env' && <p className="mt-1 text-xs text-muted">A key is set in the gateway's environment, so you can leave this blank. A key saved here overrides it for your account.</p>}
          </div>
        )}
        {info.usesBaseUrl && (
          <div>
            <label htmlFor="baseUrl" className="mb-1 block text-xs font-medium">Base URL</label>
            <Input id="baseUrl" className="w-full font-mono" value={v.baseUrl} onChange={set('baseUrl')} placeholder={info.defaultBaseUrl} />
            <p className="mt-1 text-xs text-muted">The gateway server calls this address, so it must be reachable from the machine running it.</p>
          </div>
        )}
        <div>
          <label htmlFor="model" className="mb-1 block text-xs font-medium">Model</label>
          {models.length ? (
            <Select id="model" className="w-full font-mono" value={v.model} onChange={set('model')}>
              <option value="">Choose a model</option>
              {v.model && !models.includes(v.model) && <option value={v.model}>{v.model} (no longer offered, choose another)</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          ) : (
            <Input id="model" className="w-full font-mono" value={v.model} onChange={set('model')}
              placeholder={keyReady ? 'Loading models... or type an id' : 'Add an API key to list models, or type an id'} />
          )}
          <p className="mt-1 text-xs text-muted">{models.length ? `${models.length} current free/available models loaded from the provider.` : 'Model ids come from the provider; none are hardcoded here.'}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="temp" className="mb-1 block text-xs font-medium">Temperature <span className="font-normal text-muted">(optional, 0-2)</span></label>
            <Input id="temp" inputMode="decimal" className="w-full" value={v.temperature} onChange={set('temperature')} placeholder="Provider default" />
          </div>
          <div>
            <label htmlFor="maxTokens" className="mb-1 block text-xs font-medium">Max tokens <span className="font-normal text-muted">(optional)</span></label>
            <Input id="maxTokens" inputMode="numeric" className="w-full" value={v.maxTokens} onChange={set('maxTokens')} placeholder="Provider default" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Capabilities:
          <Badge tone={info.capabilities.jsonMode ? 'ok' : 'warn'}>JSON output {info.capabilities.jsonMode ? 'yes' : 'no'}</Badge>
          <Badge tone="warn">Tool calling not yet in gateway</Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void runTest()} disabled={busy !== null || !keyReady}>
            {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test connection
          </Button>
          <Button type="submit" variant="outline" disabled={busy !== null}>{busy === 'save' ? 'Saving...' : 'Save'}</Button>
          <Button type="button" onClick={() => void onActivate()} disabled={busy !== null || !keyReady || !v.model.trim()}>
            {busy === 'activate' ? 'Activating...' : isActive ? 'Save & keep active' : 'Save & activate'}
          </Button>
          {isActive && <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void deactivate()}>Deactivate</Button>}
          {info.requiresKey && settings.keySource === 'user' && (
            <Button type="button" variant="ghost" className="text-bad" disabled={busy !== null} onClick={() => void onRemove()}><Trash2 size={14} /> Remove key</Button>
          )}
        </div>

        <div aria-live="polite" className="space-y-2">
          {test && <Result ok={test.ok} text={`${test.message} (${test.latencyMs} ms)`} label="Connection" />}
          {!test && settings.lastTest && <Result ok={settings.lastTest.ok} text={`${settings.lastTest.message} Last tested ${new Date(settings.lastTest.at).toLocaleString()}.`} label="Last test" />}
          {notice && <Result ok={notice.ok} text={notice.text} />}
        </div>
      </form>
    </Card>
  );
}

function Result({ ok, text, label }: { ok: boolean; text: string; label?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-md border p-2 text-sm', ok ? 'border-ok bg-okbg text-ok' : 'border-bad bg-badbg text-bad')} role={ok ? 'status' : 'alert'}>
      {ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
      <span>{label && <strong>{label}: </strong>}{text}</span>
    </div>
  );
}
