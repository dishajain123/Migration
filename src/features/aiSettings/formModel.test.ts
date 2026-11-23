import { describe, expect, it } from 'vitest';
import type { ProviderInfo } from '@/types/ai';
import { buildSaveRequest } from './formModel';

const info = (usesBaseUrl: boolean) => ({ usesBaseUrl }) as ProviderInfo;
const v = { apiKey: '', baseUrl: '', model: ' m ', temperature: '', maxTokens: '' };

describe('buildSaveRequest', () => {
  it('omits the key when blank and trims the model', () => {
    const r = buildSaveRequest(info(false), v);
    expect(r).toEqual({ ok: true, request: { model: 'm', temperature: null, maxTokens: null } });
  });
  it('includes base URL only for providers that use one', () => {
    expect(buildSaveRequest(info(true), { ...v, baseUrl: 'http://h:1' })).toMatchObject({ ok: true, request: { baseUrl: 'http://h:1' } });
    expect(JSON.stringify(buildSaveRequest(info(false), { ...v, baseUrl: 'x' }))).not.toContain('baseUrl');
  });
  it('validates numbers', () => {
    expect(buildSaveRequest(info(false), { ...v, temperature: '3' }).ok).toBe(false);
    expect(buildSaveRequest(info(false), { ...v, maxTokens: '1.5' }).ok).toBe(false);
    expect(buildSaveRequest(info(false), { ...v, temperature: '0.5', maxTokens: '100' })).toMatchObject({ ok: true, request: { temperature: 0.5, maxTokens: 100 } });
  });
});
