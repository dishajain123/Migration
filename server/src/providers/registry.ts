import type { ProviderId } from '../../../src/types/ai';
import { anthropic, gemini, groq, ollama, openai, openrouter } from './adapters';
import type { ProviderAdapter } from './types';

// To add a provider: implement ProviderAdapter, add its id to ProviderId (src/types/ai.ts), register it here.
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = { groq, gemini, openai, anthropic, openrouter, ollama };
export const PROVIDER_ORDER: ProviderId[] = ['groq', 'gemini', 'openai', 'anthropic', 'openrouter', 'ollama'];

export function isProviderId(v: string): v is ProviderId { return v in PROVIDERS; }
