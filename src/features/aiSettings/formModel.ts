import type { ProviderInfo, SaveProviderRequest } from '@/types/ai';

export interface ProviderFormValues { apiKey: string; baseUrl: string; model: string; temperature: string; maxTokens: string }

export type BuildResult = { ok: true; request: SaveProviderRequest } | { ok: false; error: string };

/** Turn form text into a save request. A blank key means "keep the saved key" (the field never shows it). */
export function buildSaveRequest(info: ProviderInfo, v: ProviderFormValues): BuildResult {
  const req: SaveProviderRequest = {};
  if (v.apiKey.trim()) req.apiKey = v.apiKey.trim();
  if (info.usesBaseUrl) req.baseUrl = v.baseUrl.trim() || null;
  req.model = v.model.trim() || null;
  if (v.temperature.trim() === '') req.temperature = null;
  else {
    const t = Number(v.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) return { ok: false, error: 'Temperature must be a number between 0 and 2.' };
    req.temperature = t;
  }
  if (v.maxTokens.trim() === '') req.maxTokens = null;
  else {
    const m = Number(v.maxTokens);
    if (!Number.isInteger(m) || m <= 0) return { ok: false, error: 'Max tokens must be a positive whole number.' };
    req.maxTokens = m;
  }
  return { ok: true, request: req };
}
