import type { ChatMessage, GatewayErrorCode, ProviderInfo } from '../../../src/types/ai';

export class GatewayError extends Error {
  constructor(readonly code: GatewayErrorCode, message: string, readonly status = 400) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

/** Resolved, decrypted configuration for one call. Lives only in memory. */
export interface ProviderConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs: number;
  fetchImpl: FetchLike;
  /** Aborted when the caller goes away (e.g. the browser closed the chat stream). */
  signal?: AbortSignal;
}

/** Add a provider by implementing this interface and registering it in registry.ts. Nothing else changes. */
export interface ProviderAdapter {
  info: ProviderInfo;
  listModels(cfg: Omit<ProviderConfig, 'model'>): Promise<string[]>;
  complete(messages: ChatMessage[], cfg: ProviderConfig): Promise<string>;
  /** Yield text deltas as they arrive. Providers without it fall back to one `complete` call. */
  stream?(messages: ChatMessage[], cfg: ProviderConfig): AsyncGenerator<string>;
}
