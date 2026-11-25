import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnResolution, ConvertedRule, MappingCandidate, MappingStatus } from '@/types';

/*
 * The approval workflow against the real persisted stores. localStorage is replaced by an in-memory fake; "restart" is
 * vi.resetModules() plus a fresh import, which rehydrates the stores from whatever the fake holds.
 */

class FakeStorage {
  data = new Map<string, string>();
  failKey: string | null = null;
  get length() { return this.data.size; }
  key(i: number) { return Array.from(this.data.keys())[i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failKey === k) throw new Error('storage full'); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

const cand = (table: string, column: string, basis: MappingCandidate['basis']): MappingCandidate => ({ table, column, dataType: 'DATE', basis });
const res = (t: string, c: string, status: MappingStatus, chosen: MappingCandidate | null): ColumnResolution => ({
  crismacTable: t, crismacColumn: c.toUpperCase(), status, chosen, candidates: chosen ? [chosen] : [], note: '',
});
function rule(id: string, target: ColumnResolution, references: ColumnResolution[]): ConvertedRule {
  return {
    id, procedure: 'DPD', procedureFile: 'dpd.sql', stage: '', crismacTable: target.crismacTable, crismacColumn: target.crismacColumn,
    statements: [], crismacLogic: 'orig', target, references, params: [],
    traq: { entity: target.chosen?.table ?? '', column: target.chosen?.column ?? '', columnType: 'Physical', derivationOption: 'Formula Expression', expression: 'IF(1)THEN(2)ELSE(3)', explanation: 'x', effectiveStartDate: '', status: 'PENDING_REVIEW', dataType: 'Date', reads: [], crismac: 'DPD 1-2' },
    status: 'converted', issues: [], confidence: { value: 100, source: 'mock', basis: [] }, dependencies: [], origin: 'derived',
  };
}
const doc = (c: string, t: string) => res('ACCOUNTCAL', c, 'documented', { ...cand('FCT_PRODUCT_MASTER', t, 'workbook'), sheet: 'FCT_PRODUCT_MASTER', rowNo: 1 });
const nameMatch = res('ACCOUNTCAL', 'NPA_DATE', 'name-match', cand('FCT_PRODUCT_MASTER', 'NPA_DATE', 'name-match'));
const A = rule('DPD::ACCOUNTCAL.A', doc('LastCrDate', 'LAST_CREDIT_DATE'), [nameMatch]);
const B = rule('DPD::ACCOUNTCAL.B', doc('DebitSinceDt', 'LAST_UNDER_DRAWING_DATE'), [nameMatch]);
const BAD = rule('DPD::ACCOUNTCAL.C', doc('StockStDt', 'STOCK_STMT_SUBMISSION_DATE'), [res('ACCOUNTCAL', 'Gone', 'missing', null)]);
const CONV_KEY = 'crismac-traq-rule-conversion-v1';

async function boot(storage: FakeStorage) {
  vi.resetModules();
  vi.stubGlobal('localStorage', storage);
  const wf = await import('./approvalWorkflow');
  const review = await import('./reviewStore');
  const conv = await import('./conversionStore');
  return { wf, review: review.useReviewStore, selectReviewed: review.selectReviewedMappings, conv: conv.useConversionStore };
}

afterEach(() => { vi.unstubAllGlobals(); });

// Every test re-imports the stores after vi.resetModules() (a cold import of the workbook-heavy graph, several seconds), so 5 s is too tight.
describe('approval workflow (shared by Rules, Agent 4 and export)', { timeout: 30_000 }, () => {
  it('approving a rule approves it and saves its verified mapping in Agent 4 in one step', async () => {
    const { wf, review, conv, selectReviewed } = await boot(new FakeStorage());
    const out = wf.approveRules([A, B, BAD], [A.id], 'single');
    expect(out).toMatchObject({ ok: true, approved: [A.id], mappingsSaved: 1, mappingsReused: 1 });
    expect(conv.getState().edits[A.id].decision).toBe('approved');
    const saved = review.getState().manualMappings;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ sourceTable: 'ACCOUNTCAL', sourceColumn: 'NPA_DATE', targetColumn: 'NPA_DATE', origin: 'rule-approval', ruleIds: [A.id] });
    expect(review.getState().approvals[A.id].mappings.some((m) => m.action === 'created')).toBe(true);
    // Agent 4 and the converter read the same list, so the mapping is immediately usable everywhere.
    expect(selectReviewed(review.getState()).map((m) => `${m.sourceTable}.${m.sourceColumn}`)).toContain('ACCOUNTCAL.NPA_DATE');
  });

  it('Approve all / selected: approves the eligible rules, reports the ineligible with a reason, saves each mapping once', async () => {
    const { wf, review, conv } = await boot(new FakeStorage());
    const out = wf.approveRules([A, B, BAD], [A.id, B.id, BAD.id], 'all');
    expect(out.ok).toBe(true);
    expect(out.approved).toEqual([A.id, B.id]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({ ruleId: BAD.id });
    expect(out.skipped[0].reasons[0]).toMatch(/not mapped/);
    expect(out.mappingsSaved).toBe(1); // A and B share one pair
    expect(review.getState().manualMappings).toHaveLength(1);
    expect(review.getState().manualMappings[0].ruleIds).toEqual([A.id, B.id]);
    expect(conv.getState().edits[BAD.id]?.decision).toBeUndefined(); // untouched, still pending
    expect(review.getState().approvals[BAD.id]).toBeUndefined();
  });

  it('does not reprocess or duplicate on a second approval', async () => {
    const { wf, review } = await boot(new FakeStorage());
    wf.approveRules([A, B], [A.id, B.id], 'all');
    const again = wf.approveRules([A, B], [A.id, B.id], 'all');
    expect(again).toMatchObject({ ok: true, approved: [], alreadyApproved: 2, mappingsSaved: 0 });
    expect(review.getState().manualMappings).toHaveLength(1);
  });

  it('keeps decisions, mappings and approval records after a refresh or restart', async () => {
    const storage = new FakeStorage();
    const first = await boot(storage);
    first.wf.approveRules([A, B], [A.id, B.id], 'all');
    expect(storage.getItem('crismac-traq-review-v1')).toContain('rule-approval');
    expect(storage.getItem(CONV_KEY)).toContain('approved');

    const restarted = await boot(storage); // new module instances, same browser storage
    expect(restarted.conv.getState().edits[A.id].decision).toBe('approved');
    expect(restarted.review.getState().manualMappings).toHaveLength(1);
    expect(restarted.review.getState().approvals[B.id].via).toBe('all');
  });

  it('removing a mapping in Agent 4 sends the rules that relied on it back to review', async () => {
    const { wf, review, conv } = await boot(new FakeStorage());
    wf.approveRules([A, B], [A.id, B.id], 'all');
    const id = review.getState().manualMappings[0].id;
    const out = wf.removeMappingAndRevalidate(id);
    expect(out.revalidated.sort()).toEqual([A.id, B.id]);
    expect(review.getState().manualMappings).toHaveLength(0);
    expect(review.getState().approvals).toEqual({});
    expect(conv.getState().edits[A.id].decision).toBeUndefined();
    expect(conv.getState().edits[B.id].decision).toBeUndefined();
  });

  it('rejecting a rule withdraws its approval record but leaves the mapping in Agent 4', async () => {
    const { wf, review, conv } = await boot(new FakeStorage());
    wf.approveRules([A, B], [A.id, B.id], 'all');
    wf.withdrawRules([A.id], 'rejected');
    expect(conv.getState().edits[A.id].decision).toBe('rejected');
    expect(review.getState().approvals[A.id]).toBeUndefined();
    expect(review.getState().manualMappings).toHaveLength(1);
    expect(review.getState().manualMappings[0].ruleIds).toEqual([B.id]);
  });

  it('is all-or-nothing: if persisting fails, no rule is approved and no mapping is left behind', async () => {
    const storage = new FakeStorage();
    const { wf, review, conv } = await boot(storage);
    storage.failKey = CONV_KEY; // the decision store cannot write
    const out = wf.approveRules([A, B], [A.id, B.id], 'all');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Nothing was approved or saved/);
    expect(review.getState().manualMappings).toHaveLength(0);
    expect(review.getState().approvals).toEqual({});
    expect(conv.getState().edits[A.id]?.decision).toBeUndefined();
  });
});
