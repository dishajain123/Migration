// Guardrails are deterministic, regex/heuristic checks - no extra LLM call, no keyword blacklist alone (each check
// combines a signal family with context so normal technical questions about SQL/procedures are never blocked).

export type GuardrailReasonCode =
  | 'PROMPT_INJECTION'
  | 'SECRET_DETECTED'
  | 'DESTRUCTIVE_SQL'
  | 'OUTPUT_SECRET'
  | 'FABRICATED_CITATION';

export interface GuardrailResult {
  allowed: boolean;
  reason?: GuardrailReasonCode;
  /** Safe to show the user as-is; never includes the matched text. */
  message?: string;
}

export const allow = (): GuardrailResult => ({ allowed: true });
export const block = (reason: GuardrailReasonCode, message: string): GuardrailResult => ({ allowed: false, reason, message });
