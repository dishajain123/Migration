import { useEffect, useState } from 'react';
import type { ApiMeta, ApiResult } from '@/types';

/** An immediate "no result" response, for views waiting on a selection. */
export function noResult<T>(message: string): Promise<ApiResult<T>> {
  return Promise.resolve({ data: null, meta: { simulated: false, requestId: '', latencyMs: 0 }, error: { code: 'NO_SELECTION', message } });
}

export interface AsyncState<T> {
  status: 'loading' | 'success' | 'error';
  data: T | null;
  meta: ApiMeta | null;
  error: string | null;
  reload: () => void;
}

/** Runs a service call and exposes loading/error/success. Business logic stays in services/domain. */
export function useAsync<T>(fn: () => Promise<ApiResult<T>>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({ status: 'loading', data: null, meta: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    fn()
      .then((r) => {
        if (!alive) return;
        if (r.error || r.data === null) setState({ status: 'error', data: null, meta: r.meta, error: r.error?.message ?? 'No data returned' });
        else setState({ status: 'success', data: r.data, meta: r.meta, error: null });
      })
      .catch((e) => {
        if (alive) setState({ status: 'error', data: null, meta: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
