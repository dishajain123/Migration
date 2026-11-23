import { create } from 'zustand';
import { aiGateway } from '@/services/aiGateway';
import type { ApiResult } from '@/types';
import type { GatewayOverview, ProviderId, SaveProviderRequest } from '@/types/ai';

export { aiGateway };

interface AiState {
  overview: GatewayOverview | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: () => Promise<void>;
  save: (id: ProviderId, req: SaveProviderRequest) => Promise<string | null>;
  activate: (id: ProviderId, model?: string) => Promise<string | null>;
  deactivate: () => Promise<string | null>;
  removeKey: (id: ProviderId) => Promise<string | null>;
  reset: () => void;
}

export const useAiStore = create<AiState>((set) => {
  /** Apply an overview-returning call; resolves to an error message or null. */
  const apply = (r: ApiResult<GatewayOverview>): string | null => {
    if (r.data) { set({ overview: r.data, status: 'ready', error: null }); return null; }
    return r.error?.message ?? 'Request failed.';
  };
  return {
    overview: null, status: 'idle', error: null,
    async load() {
      set({ status: 'loading' });
      const r = await aiGateway.overview();
      if (r.data) set({ overview: r.data, status: 'ready', error: null });
      else set({ status: 'error', error: r.error?.message ?? 'Could not load AI settings.' });
    },
    async save(id, req) { return apply(await aiGateway.saveProvider(id, req)); },
    async activate(id, model) { return apply(await aiGateway.activate(id, model)); },
    async deactivate() { return apply(await aiGateway.deactivate()); },
    async removeKey(id) { return apply(await aiGateway.removeKey(id)); },
    reset: () => set({ overview: null, status: 'idle', error: null }),
  };
});
