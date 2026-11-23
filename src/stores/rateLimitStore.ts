import { create } from 'zustand';
import type { ApiResult } from '@/types';
import type { ModelChoice, ProviderId } from '@/types/ai';
import { useAiStore } from './aiStore';

export interface RateLimitRequest {
  message: string;
  /** The provider/model that was rate limited, when known. */
  failed: { provider: ProviderId; model: string } | null;
  resolve: (choice: ModelChoice | null) => void;
}

interface State {
  request: RateLimitRequest | null;
  /** Open the dialog and wait for the user: a provider/model to retry with, or null to give up. */
  ask: (message: string, failed: RateLimitRequest['failed']) => Promise<ModelChoice | null>;
  settle: (choice: ModelChoice | null) => void;
}

export const useRateLimitStore = create<State>((set, get) => ({
  request: null,
  ask: (message, failed) => new Promise((resolve) => {
    // Only one dialog at a time: a second concurrent request waits on the first answer's outcome by cancelling itself.
    if (get().request) { resolve(null); return; }
    set({ request: { message, failed, resolve } });
  }),
  settle: (choice) => { const r = get().request; set({ request: null }); r?.resolve(choice); },
}));

/**
 * Run an AI call and, if (and only if) it fails with a rate limit, ask the user which provider/model to retry with.
 * The same inputs are reused, so the original prompt and conversation are preserved. Nothing switches without consent.
 * Other failures (quota, key, permission, server, network) are returned untouched for the caller to show.
 */
export async function withRateLimitRecovery<T>(call: (override?: ModelChoice) => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  let override: ModelChoice | undefined;
  for (;;) {
    const r = await call(override);
    if (r.error?.code !== 'RATE_LIMITED') return r;
    const active = useAiStore.getState().overview?.active ?? null;
    const failed = override ? { provider: override.provider, model: override.model } : active;
    const choice = await useRateLimitStore.getState().ask(r.error.message, failed);
    if (!choice) return r;
    if (choice.makeActive) await useAiStore.getState().activate(choice.provider, choice.model);
    override = choice;
  }
}
