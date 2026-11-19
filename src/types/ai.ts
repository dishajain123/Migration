// Shared AI Gateway contract (used by the frontend client and by server/). Type-only: no runtime code.
// API keys never appear in any response type below; only `hasKey` is reported.

export type ProviderId = 'groq' | 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'ollama';

export interface ProviderCapabilities {
  jsonMode: boolean;
  toolCalling: boolean;
  temperature: boolean;
  maxTokens: boolean;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  requiresKey: boolean;
  /** True when the provider needs/accepts a base URL (Ollama). */
  usesBaseUrl: boolean;
  defaultBaseUrl: string;
  capabilities: ProviderCapabilities;
  keyHelpUrl: string;
}

export interface ProviderSettings {
  hasKey: boolean;
  /** Where the key comes from: 'user' = saved in AI Settings, 'env' = server environment variable (e.g. GROQ_API_KEY). */
  keySource: 'user' | 'env' | null;
  baseUrl: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  lastTest: { ok: boolean; message: string; at: string } | null;
}

export interface ProviderEntry { info: ProviderInfo; settings: ProviderSettings }

export interface ActiveProvider { provider: ProviderId; model: string }

export interface GatewayOverview {
  providers: ProviderEntry[];
  active: ActiveProvider | null;
  /** Always 'demo' until real authentication exists; settings are keyed by the caller's user id. */
  identityMode: 'demo';
}

export interface SaveProviderRequest {
  /** Omit to keep the stored key; empty string is rejected. */
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
}

export interface TestConnectionRequest {
  /** Optional unsaved values to test; otherwise the stored configuration is used. */
  apiKey?: string;
  baseUrl?: string | null;
  model?: string | null;
}

export interface TestConnectionResult { ok: boolean; message: string; models: string[]; latencyMs: number }

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage { role: ChatRole; content: string }

/** Entry point agents use. Provider/model come from the user's active configuration unless overridden. */
export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Agent requires JSON output. Rejected with INCOMPATIBLE if the active provider cannot guarantee it. */
  json?: boolean;
  /** Agent requires tool calling. Rejected with INCOMPATIBLE if unsupported. */
  tools?: boolean;
  /** Informational tag for server logs (never prompt text). */
  agent?: string;
  /** One-off provider/model for this call only (used when retrying after a rate limit). Does not change the active selection. */
  provider?: ProviderId;
  model?: string;
}

/** A provider/model the user picked, e.g. in the rate-limit dialog. */
export interface ModelChoice { provider: ProviderId; model: string; makeActive?: boolean }

export interface CompletionResult { text: string; provider: ProviderId; model: string; latencyMs: number }

/** Structured output shared by every agent's AI feature (the model must return exactly this JSON). */
export interface AiInsight {
  summary: string;
  sections: { title: string; points: string[] }[];
}

/**
 * RATE_LIMITED (429 throttling) is the only code that opens the provider/model switching dialog.
 * QUOTA_EXHAUSTED = billing/credit/quota used up; INVALID_KEY = 401; PERMISSION_DENIED = 403;
 * SERVER_ERROR = provider 5xx; UNREACHABLE = network failure.
 */
export type GatewayErrorCode =
  | 'UNAUTHENTICATED' | 'NOT_CONFIGURED' | 'MISSING_KEY' | 'INVALID_KEY' | 'PERMISSION_DENIED' | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED' | 'SERVER_ERROR' | 'TIMEOUT' | 'INCOMPATIBLE' | 'MODEL_NOT_FOUND' | 'UNREACHABLE' | 'BAD_REQUEST'
  | 'PROVIDER_ERROR'
  /** Guardrails rejected the message before it was sent to the model (prompt injection, secrets, destructive SQL intent). */
  | 'BLOCKED_INPUT'
  /** Guardrails withheld the model's answer (e.g. a leaked credential near the start of the response). */
  | 'BLOCKED_OUTPUT';

// ---- Chatbot (RAG over project knowledge) ----
export interface ChatStreamTurn { role: 'user' | 'assistant'; text: string }
export interface ChatStreamRequest {
  question: string;
  /** Prior turns, oldest first. The client keeps the conversation, so a retry after a rate limit reuses it unchanged. */
  history: ChatStreamTurn[];
  route?: string;
  provider?: ProviderId;
  model?: string;
}
export interface ChatSource {
  /** Citation tag used in the answer text, e.g. "S1". */
  tag: string;
  kind: string;
  title: string;
  label: string;
  sheet?: string;
  rowNo?: number;
  route?: string;
}
export type ChatStreamEvent =
  | { type: 'meta'; sources: ChatSource[]; retrieval: { mode: 'hybrid' | 'keyword'; entities: string[]; note?: string } }
  | { type: 'delta'; text: string }
  /**
   * provider/model are absent when the answer needed no model call (nothing relevant was retrieved). `warning` is set
   * by output guardrails: a heuristic flag shown to the user, never a silent rewrite of the answer.
   */
  | { type: 'done'; provider?: ProviderId; model?: string; kind: 'grounded' | 'not-found' | 'smalltalk'; warning?: 'unverified-claim' | 'fabricated-citation' }
  | { type: 'error'; code: GatewayErrorCode; message: string };

/** Knowledge chunks are built in the browser from the workbook and docs, then synced to the gateway for indexing. */
export interface KnowledgeStatus { hash: string | null; chunks: number; embeddings: { enabled: boolean; model: string | null; indexed: number } }
