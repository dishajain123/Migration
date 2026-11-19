import { extractCitedTags } from '../../../src/domain/citations';
import type { ChatSource } from '../../../src/types/ai';
import { hasSecret } from './patterns';
import { allow, block, type GuardrailResult } from './types';

const OUTPUT_SECRET_MSG = 'The answer was withheld because it appeared to contain a secret or credential.';

/**
 * Run on a growing prefix of the streamed answer (see orchestrator.ts), so an obvious credential leak near the start
 * of the answer is caught before those tokens reach the client. This is a best-effort mitigation, not a guarantee:
 * once tokens are streamed they cannot be un-sent, so this check only covers the buffered prefix.
 */
export function checkOutputSecrets(textSoFar: string): GuardrailResult {
  if (hasSecret(textSoFar)) return block('OUTPUT_SECRET', OUTPUT_SECRET_MSG);
  return allow();
}

/**
 * The only output check that is unambiguous enough to run deterministically after the full answer is known: a
 * citation tag that was never actually retrieved is always fabricated, never a legitimate reference.
 */
export function checkGroundedness(fullText: string, sources: ChatSource[]): GuardrailResult {
  const valid = new Set(sources.map((s) => s.tag));
  const cited = extractCitedTags(fullText);
  const fabricated = cited.filter((t) => !valid.has(t));
  if (fabricated.length) return block('FABRICATED_CITATION', `The answer cited a source (${fabricated.join(', ')}) that was not actually retrieved for this question.`);
  return allow();
}

const HEDGE = /not provided in workbook|i (could not|couldn't|don't|do not) (find|have)|no documented|not (available|documented)|not sure|unclear/i;
const ENTITY_SHAPED = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/**
 * Soft warning only (never blocks): the answer names table/column-shaped entities but cites no source at all, even
 * though passages were retrieved and the text isn't already hedging about missing information. Heuristic, so it is
 * surfaced to the user as a flag to double-check, not presented as a confirmed defect.
 */
export function hasUnverifiedClaim(fullText: string, sources: ChatSource[]): boolean {
  if (!sources.length) return false;
  if (HEDGE.test(fullText)) return false;
  if (extractCitedTags(fullText).length) return false;
  return ENTITY_SHAPED.test(fullText);
}
