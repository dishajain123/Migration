import { config } from '@/config';
import type { ApiResult } from '@/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wrap a synchronous/async computation as an async, enveloped mock API response. */
export async function respond<T>(
  fn: () => T | Promise<T>, opts: { simulated: boolean; note?: string },
): Promise<ApiResult<T>> {
  const start = performance.now();
  await sleep(config.mockLatencyMs * (0.6 + Math.random() * 0.8));
  const requestId = `mock-${Math.random().toString(36).slice(2, 10)}`;
  const meta = () => ({ simulated: opts.simulated, note: opts.note, requestId, latencyMs: Math.round(performance.now() - start) });
  try {
    if (Math.random() < config.mockErrorRate) throw new Error('Injected mock failure (VITE_MOCK_ERROR_RATE)');
    const data = await fn();
    return { data, meta: meta() };
  } catch (e) {
    return { data: null, meta: meta(), error: { code: 'MOCK_ERROR', message: e instanceof Error ? e.message : String(e) } };
  }
}
