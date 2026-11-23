import {
  applyPlan, planApproval, rulesDependingOn, withdraw, type ApprovalPlan,
} from '@/domain/ruleConversion/approval';
import type { ConvertedRule, RuleApproval } from '@/types';
import { useConversionStore } from './conversionStore';
import { selectReviewedMappings, useReviewStore } from './reviewStore';

/*
 * The single place where a rule decision and Agent 4's mapping repository change together.
 *
 * Both repositories are persisted stores (reviewStore: mappings + approval records, conversionStore: rule decisions). A change
 * to both is made as one transaction: the plan is computed first (pure), then both stores are updated, and if anything throws
 * (or the decision did not land) both are restored to the snapshot taken before. Ineligible rules are never part of the
 * transaction; they are reported back with the reason and left untouched.
 */

export interface ApprovalOutcome {
  ok: boolean;
  error?: string;
  /** Rule ids approved by this call. */
  approved: string[];
  alreadyApproved: number;
  skipped: { ruleId: string; label: string; reasons: string[] }[];
  mappingsSaved: number;
  mappingsReused: number;
}

const empty = (extra: Partial<ApprovalOutcome> = {}): ApprovalOutcome => ({ ok: true, approved: [], alreadyApproved: 0, skipped: [], mappingsSaved: 0, mappingsReused: 0, ...extra });

const reviewed = () => selectReviewedMappings(useReviewStore.getState());

/** What approving these rules would do (nothing is changed). Used by the confirmation dialog. */
export function previewApproval(rules: ConvertedRule[], ids: string[]): ApprovalPlan {
  return planApproval(rules, ids, useConversionStore.getState().edits, reviewed());
}

export function approveRules(rules: ConvertedRule[], ids: string[], via: RuleApproval['via'], comment = ''): ApprovalOutcome {
  const plan = previewApproval(rules, ids);
  const skipped = plan.ineligible.map((a) => ({ ruleId: a.ruleId, label: a.label, reasons: a.blockers }));
  if (plan.eligible.length === 0) return empty({ alreadyApproved: plan.alreadyApproved.length, skipped });

  const review = useReviewStore.getState();
  const before = { manualMappings: review.manualMappings, approvals: review.approvals, edits: useConversionStore.getState().edits };
  const eligibleIds = plan.eligible.map((a) => a.ruleId);
  try {
    const applied = applyPlan(before.manualMappings, before.approvals, plan, { via, comment, at: new Date().toISOString() });
    useReviewStore.getState().setMappingState({ manualMappings: applied.manualMappings, approvals: applied.approvals });
    useConversionStore.getState().decide(eligibleIds, 'approved', comment || (via === 'single' ? '' : `Approved with ${via === 'all' ? 'Approve all' : 'Approve selected'}`));
    const landed = useConversionStore.getState().edits;
    if (eligibleIds.some((id) => landed[id]?.decision !== 'approved')) throw new Error('A rule decision was not stored.');
    return empty({ approved: eligibleIds, alreadyApproved: plan.alreadyApproved.length, skipped, mappingsSaved: applied.created, mappingsReused: applied.reused });
  } catch (e) {
    // Restore both stores. Each step is guarded on its own: if storage is what failed, the in-memory state is still reset.
    try { useReviewStore.getState().setMappingState({ manualMappings: before.manualMappings, approvals: before.approvals }); } catch { /* storage unavailable */ }
    try { useConversionStore.setState({ edits: before.edits }); } catch { /* storage unavailable */ }
    return empty({ ok: false, error: `Nothing was approved or saved: ${e instanceof Error ? e.message : String(e)}`, skipped, alreadyApproved: plan.alreadyApproved.length });
  }
}

/** Reject or reset rules. Their approval records go; the mappings stay in Agent 4 (remove them there if they are wrong). */
export function withdrawRules(ids: string[], decision: 'rejected' | null, comment = ''): void {
  const review = useReviewStore.getState();
  const next = withdraw(review.manualMappings, review.approvals, ids);
  review.setMappingState(next);
  useConversionStore.getState().decide(ids, decision, comment);
}

/**
 * Remove a mapping from Agent 4 and re-validate every approved rule that relied on it: their approval is withdrawn so they
 * need a fresh review (and show as unmapped again until a mapping exists).
 */
export function removeMappingAndRevalidate(mappingId: string): { revalidated: string[] } {
  const review = useReviewStore.getState();
  const dependents = rulesDependingOn(review.approvals, review.manualMappings, mappingId);
  const next = withdraw(review.manualMappings.filter((m) => m.id !== mappingId), review.approvals, dependents);
  review.setMappingState(next);
  if (dependents.length) useConversionStore.getState().decide(dependents, null, 'A mapping this rule relied on was removed in Agent 4; review again.');
  return { revalidated: dependents };
}

/** Undo an approved Agent 4 suggestion (Suggestions tab) with the same re-validation. */
export function clearMappingDecisionAndRevalidate(id: string): { revalidated: string[] } {
  const review = useReviewStore.getState();
  const dependents = rulesDependingOn(review.approvals, review.manualMappings, id);
  review.clearMappingDecision(id);
  if (dependents.length) {
    const next = withdraw(useReviewStore.getState().manualMappings, useReviewStore.getState().approvals, dependents);
    useReviewStore.getState().setMappingState(next);
    useConversionStore.getState().decide(dependents, null, 'A mapping this rule relied on was reset in Agent 4; review again.');
  }
  return { revalidated: dependents };
}
