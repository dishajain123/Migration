import type { ChatStreamTurn } from '../../../src/types/ai';
import { hasDestructiveSqlIntent, hasInjection, hasSecret, normalize } from './patterns';
import { allow, block, type GuardrailResult } from './types';

const SECRET_MSG = 'This message looks like it contains a secret or credential (an API key, password, bearer token or connection string). Remove it and ask again.';
const DESTRUCTIVE_MSG = 'This assistant can explain what SQL or a procedure does, but it will not treat a message as an instruction to run or apply changes against a database. Ask about what the statement does instead.';
const INJECTION_MSG = "This message looks like it is trying to override the assistant's instructions or extract its internal configuration, so it was not sent to the model.";

/**
 * Checked before the chat orchestrator runs at all (see app.ts), so a block never opens the SSE stream or reaches
 * the model/logs. `history` is only used for future context-aware checks; it is not itself re-validated here since
 * each turn was already checked when it was first sent.
 */
export function checkInput(question: string, _history: ChatStreamTurn[]): GuardrailResult {
  if (hasSecret(question)) return block('SECRET_DETECTED', SECRET_MSG);
  const norm = normalize(question);
  if (hasDestructiveSqlIntent(norm)) return block('DESTRUCTIVE_SQL', DESTRUCTIVE_MSG);
  if (hasInjection(norm)) return block('PROMPT_INJECTION', INJECTION_MSG);
  return allow();
}
