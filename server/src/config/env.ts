import type { ProviderId } from '../../../src/types/ai';

/**
 * Server-side configuration read from environment variables (see .env.example). Keys placed here are the default for
 * every user; a key saved in AI Settings overrides it for that user. Neither is ever sent to the browser or logged.
 */
export const ENV_KEY_NAMES: Record<ProviderId, string[]> = {
  groq: ['GROQ_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  ollama: [],
};

export type Env = Record<string, string | undefined>;

export function envKey(id: ProviderId, env: Env = process.env): string | null {
  for (const name of ENV_KEY_NAMES[id]) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return null;
}

/** Embedding models are configuration, not code: override per deployment without touching adapters. */
export const embeddingModels = (env: Env = process.env) => ({
  openai: env.EMBEDDING_MODEL_OPENAI?.trim() || 'text-embedding-3-small',
  gemini: env.EMBEDDING_MODEL_GEMINI?.trim() || 'gemini-embedding-001',
});
