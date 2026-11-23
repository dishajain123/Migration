import type {
  ActiveProvider, ChatMessage, CompletionRequest, CompletionResult, GatewayOverview, ProviderId, SaveProviderRequest,
  TestConnectionRequest, TestConnectionResult,
} from '../../src/types/ai';
import { envKey, type Env } from './config/env';
import { PROVIDERS, PROVIDER_ORDER } from './providers/registry';
import { GatewayError, type FetchLike, type ProviderAdapter, type ProviderConfig } from './providers/types';
import type { SettingsStore, StoredProvider } from './store';

export interface GatewayOptions { timeoutMs?: number; fetchImpl?: FetchLike; log?: (line: string) => void; env?: Env }

interface Resolved { adapter: ProviderAdapter; provider: ProviderId; model: string; cfg: ProviderConfig }

/** The single place every agent and the chatbot go through to reach an LLM. Provider and model come from the caller's saved settings. */
export class AiGateway {
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly log: (line: string) => void;
  private readonly env: Env;

  constructor(private readonly store: SettingsStore, opts: GatewayOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => undefined);
    this.env = opts.env ?? process.env;
  }

  /** Decrypted key for server-side use only: the user's saved key, else the server environment variable. */
  resolveKey(uid: string, id: ProviderId): string | null {
    return this.store.getKey(uid, id) ?? envKey(id, this.env);
  }
  private keySource(uid: string, id: ProviderId): 'user' | 'env' | null {
    if (this.store.getProvider(uid, id).encKey) return 'user';
    return envKey(id, this.env) ? 'env' : null;
  }

  overview(uid: string): GatewayOverview {
    return {
      identityMode: 'demo',
      active: this.store.getActive(uid),
      providers: PROVIDER_ORDER.map((id) => {
        const s = this.store.getProvider(uid, id);
        const src = this.keySource(uid, id);
        return {
          info: PROVIDERS[id].info,
          settings: {
            hasKey: src !== null, keySource: src, baseUrl: s.baseUrl ?? null, model: s.model ?? null,
            temperature: s.temperature ?? null, maxTokens: s.maxTokens ?? null, lastTest: s.lastTest ?? null,
          },
        };
      }),
    };
  }

  saveProvider(uid: string, id: ProviderId, req: SaveProviderRequest): GatewayOverview {
    const info = PROVIDERS[id].info;
    const patch: Parameters<SettingsStore['saveProvider']>[2] = {};
    if (req.apiKey !== undefined) {
      const k = req.apiKey.trim();
      if (!k) throw new GatewayError('BAD_REQUEST', 'API key cannot be empty. Leave the field blank to keep the saved key.');
      if (!info.requiresKey) throw new GatewayError('BAD_REQUEST', `${info.label} does not use an API key.`);
      patch.apiKey = k;
    }
    if (req.baseUrl !== undefined) patch.baseUrl = req.baseUrl === null || req.baseUrl.trim() === '' ? null : validUrl(req.baseUrl);
    if (req.model !== undefined) patch.model = req.model?.trim() || null;
    if (req.temperature !== undefined) {
      if (req.temperature !== null && !(req.temperature >= 0 && req.temperature <= 2)) throw new GatewayError('BAD_REQUEST', 'Temperature must be between 0 and 2.');
      patch.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) {
      if (req.maxTokens !== null && !(Number.isInteger(req.maxTokens) && req.maxTokens > 0)) throw new GatewayError('BAD_REQUEST', 'Max tokens must be a positive integer.');
      patch.maxTokens = req.maxTokens;
    }
    this.store.saveProvider(uid, id, patch);
    // Keep the active selection consistent when the active provider's model is edited.
    const active = this.store.getActive(uid);
    if (active?.provider === id && patch.model) this.store.setActive(uid, { provider: id, model: patch.model });
    return this.overview(uid);
  }

  /** Removes the key saved in AI Settings. A server environment key, if any, stays in effect. */
  removeKey(uid: string, id: ProviderId): GatewayOverview {
    this.store.clearKey(uid, id, !!envKey(id, this.env));
    return this.overview(uid);
  }

  async listModels(uid: string, id: ProviderId, override?: TestConnectionRequest): Promise<string[]> {
    return PROVIDERS[id].listModels(this.baseCfg(uid, id, override));
  }

  async testConnection(uid: string, id: ProviderId, req: TestConnectionRequest = {}): Promise<TestConnectionResult> {
    const started = Date.now();
    let result: TestConnectionResult;
    try {
      const models = await this.listModels(uid, id, req);
      const model = req.model?.trim() || this.store.getProvider(uid, id).model || null;
      if (model && models.length > 0 && !models.includes(model)) {
        result = { ok: false, message: `Connected, but model "${model}" is not offered by this provider. Choose one from the list.`, models, latencyMs: Date.now() - started };
      } else {
        result = { ok: true, message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`, models, latencyMs: Date.now() - started };
      }
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
      result = { ok: false, message: e.message, models: [], latencyMs: Date.now() - started };
    }
    if (req.apiKey === undefined) this.store.setLastTest(uid, id, { ok: result.ok, message: result.message });
    return result;
  }

  activate(uid: string, id: ProviderId, model?: string): GatewayOverview {
    const info = PROVIDERS[id].info;
    const stored = this.store.getProvider(uid, id);
    if (info.requiresKey && !this.resolveKey(uid, id)) throw new GatewayError('MISSING_KEY', `Save an API key for ${info.label} (or set it in the server environment) before activating it.`);
    const m = model?.trim() || stored.model;
    if (!m) throw new GatewayError('BAD_REQUEST', 'Choose a model before activating this provider.');
    this.store.saveProvider(uid, id, { model: m });
    this.store.setActive(uid, { provider: id, model: m });
    return this.overview(uid);
  }

  deactivate(uid: string): GatewayOverview { this.store.setActive(uid, null); return this.overview(uid); }

  getActive(uid: string): ActiveProvider | null { return this.store.getActive(uid); }

  /** Agent entry point. Reads the user's current selection on every call, so switching providers needs no restart. */
  async complete(uid: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const r = this.resolve(uid, req, signal);
    const started = Date.now();
    try {
      const text = await r.adapter.complete(req.messages, r.cfg);
      const latencyMs = Date.now() - started;
      this.log(`complete ok agent=${req.agent ?? '-'} provider=${r.provider} model=${r.model} ms=${latencyMs}`);
      return { text, provider: r.provider, model: r.model, latencyMs };
    } catch (e) {
      if (e instanceof GatewayError) this.log(`complete fail agent=${req.agent ?? '-'} provider=${r.provider} code=${e.code}`);
      throw e;
    }
  }

  /**
   * Streaming variant for the chatbot. Resolution errors (not configured, missing key, incompatible) throw here,
   * before any text; provider errors surface from the generator on first read.
   */
  openStream(uid: string, req: CompletionRequest, signal?: AbortSignal): { provider: ProviderId; model: string; deltas: AsyncGenerator<string> } {
    const r = this.resolve(uid, req, signal);
    const log = this.log;
    const agent = req.agent ?? '-';
    async function* run(): AsyncGenerator<string> {
      try {
        if (r.adapter.stream) yield* r.adapter.stream(req.messages, r.cfg);
        else yield await r.adapter.complete(req.messages, r.cfg);
        log(`stream ok agent=${agent} provider=${r.provider} model=${r.model}`);
      } catch (e) {
        if (e instanceof GatewayError) log(`stream fail agent=${agent} provider=${r.provider} code=${e.code}`);
        throw e;
      }
    }
    return { provider: r.provider, model: r.model, deltas: run() };
  }

  private resolve(uid: string, req: { messages: ChatMessage[]; provider?: ProviderId; model?: string; json?: boolean; tools?: boolean; temperature?: number; maxTokens?: number }, signal?: AbortSignal): Resolved {
    if (!Array.isArray(req.messages) || req.messages.length === 0) throw new GatewayError('BAD_REQUEST', 'messages must be a non-empty array.');
    const active = this.store.getActive(uid);
    const provider = req.provider ?? active?.provider;
    if (!provider || !(provider in PROVIDERS)) throw new GatewayError('NOT_CONFIGURED', 'No AI provider is active. Open AI Settings, save a key, and activate a provider.', 409);
    const stored = this.store.getProvider(uid, provider);
    const model = req.model?.trim() || (req.provider ? stored.model : active?.model) || undefined;
    if (!model) throw new GatewayError('BAD_REQUEST', 'No model is selected for this provider. Choose one in AI Settings.');
    const adapter = PROVIDERS[provider];
    const caps = adapter.info.capabilities;
    if (req.json && !caps.jsonMode) throw new GatewayError('INCOMPATIBLE', `${adapter.info.label} cannot guarantee JSON output through this gateway, which this agent requires. Choose another provider in AI Settings.`, 422);
    if (req.tools && !caps.toolCalling) throw new GatewayError('INCOMPATIBLE', `Tool calling is not supported by the gateway for ${adapter.info.label}. Choose another provider or model.`, 422);
    const cfg: ProviderConfig = {
      ...this.baseCfg(uid, provider),
      model,
      temperature: req.temperature ?? stored.temperature ?? undefined,
      maxTokens: req.maxTokens ?? stored.maxTokens ?? undefined,
      json: req.json,
      signal,
    };
    return { adapter, provider, model, cfg };
  }

  private baseCfg(uid: string, id: ProviderId, override?: TestConnectionRequest): Omit<ProviderConfig, 'model'> {
    const info = PROVIDERS[id].info;
    const stored: StoredProvider = this.store.getProvider(uid, id);
    const baseUrl = override?.baseUrl?.trim() ? validUrl(override.baseUrl) : stored.baseUrl || info.defaultBaseUrl;
    return {
      apiKey: override?.apiKey?.trim() || this.resolveKey(uid, id),
      baseUrl, timeoutMs: this.timeoutMs, fetchImpl: this.fetchImpl,
    };
  }
}

function validUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
    return u.toString().replace(/\/+$/, '');
  } catch {
    throw new GatewayError('BAD_REQUEST', 'Base URL must be a valid http(s) URL.');
  }
}
