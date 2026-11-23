// Shared regex families for input and output guardrails. Kept deterministic and narrow enough to avoid blocking
// ordinary technical questions (explaining SQL, procedures, mappings) - see inputGuardrails.ts/outputGuardrails.ts.

/** Credential/secret-shaped strings. Matched on both user input and model output; never logged verbatim. */
export const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/, // Anthropic
  /\bgsk_[A-Za-z0-9]{20,}\b/, // Groq
  /\bAIza[0-9A-Za-z_-]{20,}\b/, // Google / Gemini
  /\bor-[A-Za-z0-9]{20,}\b/, // OpenRouter
  /\bbearer\s+[A-Za-z0-9._-]{15,}\b/i,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{8,}['"]?/i,
  /\bpassword\s*[:=]\s*\S+/i,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s]+/, // scheme://user:pass@host connection string
];

export const hasSecret = (text: string): boolean => SECRET_PATTERNS.some((re) => re.test(text));

/** Attempts to override, extract, or reassign the assistant's instructions. */
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget)\b[^.?!\n]{0,40}\b(previous|prior|above|earlier|all)\b[^.?!\n]{0,20}\b(instructions?|rules?|prompts?|context)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\byou\s+are\s+now\s+(?:a|an|in)\b/i,
  /\bfrom\s+now\s+on,?\s+you\s+(?:are|will|must)\b/i,
  /\bact\s+as\s+(?:an?\s+)?(?:unrestricted|jailbroken|dan|uncensored|unfiltered)\b/i,
  /\breveal\s+(?:your|the)\s+(?:system\s+prompt|internal\s+(?:instructions|rules)|hidden\s+(?:instructions|rules))\b/i,
  /\b(?:what\s+(?:is|are)|print|show\s+me|repeat)\s+(?:your|the)\s+system\s+prompt\b/i,
  /\brepeat\s+(?:the|your)\s+(?:instructions|rules|system\s+prompt)\s+(?:verbatim|exactly|word\s+for\s+word)\b/i,
  /\bdisable\s+(?:your\s+)?(?:guardrails|safety|filters?)\b/i,
];

export const hasInjection = (text: string): boolean => INJECTION_PATTERNS.some((re) => re.test(text));

/** A destructive SQL verb plus clear execution intent (not "explain this DROP statement"). */
const DESTRUCTIVE_VERB = /\b(drop|truncate|delete\s+from|alter\s+table|exec(?:ute)?|update\s+\w+\s+set)\b/i;
const EXECUTION_INTENT = /\b(run|execute|apply|perform)\b[^.?!\n]{0,20}\b(this|that|it|the\s+\w+)\b[^.?!\n]{0,20}\b(on|against|to)\b|\b(?:on|against)\s+(?:the|our|my)\s+(?:database|server|production|prod|db)\b|\bgo\s+ahead\s+and\s+(?:run|execute)\b/i;

export const hasDestructiveSqlIntent = (text: string): boolean => DESTRUCTIVE_VERB.test(text) && EXECUTION_INTENT.test(text);

/** Strips zero-width/obfuscation characters and normalizes Unicode before pattern matching. */
export function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[​-‍⁠﻿]/g, '');
}
