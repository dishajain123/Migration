import type { ApiResult } from '@/types';

export const fail = <T>(code: string, message: string): ApiResult<T> => ({ data: null, meta: { simulated: false, requestId: '', latencyMs: 0 }, error: { code, message } });

/** Unwrap an upstream service result or turn its failure into this call's failure. */
export async function need<T>(p: Promise<ApiResult<T>>): Promise<{ ok: true; value: T } | { ok: false; error: ApiResult<never> }> {
  const r = await p;
  if (r.data === null) return { ok: false, error: fail(r.error?.code ?? 'UPSTREAM', r.error?.message ?? 'Could not load the workbook data for this request.') as ApiResult<never> };
  return { ok: true, value: r.data };
}
