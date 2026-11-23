import { describe, expect, it } from 'vitest';
import type { ColumnResolution, ConvertedRule, ManualMapping, MappingBasis, MappingCandidate, MappingStatus, ReviewedMapping, RuleEdit } from '@/types';
import {
  applyPlan, approvalSummary, assessRule, buildCtx, exportBlockers, planApproval, rulesDependingOn, withdraw,
} from './approval';
import { conversionReportDoc, rulesInScope, splitByReadiness } from './templates';

const cand = (table: string, column: string, basis: MappingBasis): MappingCandidate => ({ table, column, dataType: 'DATE', basis });
const res = (t: string, c: string, status: MappingStatus, chosen: MappingCandidate | null, candidates: MappingCandidate[] = chosen ? [chosen] : []): ColumnResolution => ({
  crismacTable: t, crismacColumn: c.toUpperCase(), status, chosen, candidates, note: '',
});
const documented = (t: string, c: string, tt: string, tc: string) => res(t, c, 'documented', { ...cand(tt, tc, 'workbook'), sheet: 'FCT_PRODUCT_MASTER', rowNo: 97, mapType: 'DIRECT' });
const byName = (t: string, c: string, tt: string, tc: string) => res(t, c, 'name-match', cand(tt, tc, 'name-match'));

function rule(id: string, target: ColumnResolution, references: ColumnResolution[] = [], over: Partial<ConvertedRule> = {}): ConvertedRule {
  return {
    id, procedure: 'DPD', procedureFile: 'dpd.sql', stage: '', crismacTable: target.crismacTable, crismacColumn: target.crismacColumn,
    statements: [], crismacLogic: 'orig', target, references, params: [],
    traq: { entity: target.chosen?.table ?? '', column: target.chosen?.column ?? '', columnType: 'Physical', derivationOption: 'Formula Expression', expression: 'IF(1)THEN(2)ELSE(3)', explanation: 'x', effectiveStartDate: '', status: 'PENDING_REVIEW', dataType: 'Date', reads: [], crismac: 'DPD 1-2' },
    status: 'converted', issues: [], confidence: { value: 100, source: 'mock', basis: [] }, dependencies: [], origin: 'derived', ...over,
  };
}

const clean = rule('DPD::ACCOUNTCAL.CONTIEXCESSDT', documented('ACCOUNTCAL', 'ContiExcessDt', 'FCT_PRODUCT_MASTER', 'LAST_OVER_DRAWING_DATE'), [documented('ACCOUNTCAL', 'ContiExcessDt', 'FCT_PRODUCT_MASTER', 'LAST_OVER_DRAWING_DATE')]);
const nameRef = byName('ACCOUNTCAL', 'NPA_DATE', 'FCT_PRODUCT_MASTER', 'NPA_DATE');
const withName = rule('DPD::ACCOUNTCAL.A', documented('ACCOUNTCAL', 'LastCrDate', 'FCT_PRODUCT_MASTER', 'LAST_CREDIT_DATE'), [nameRef]);
const withName2 = rule('DPD::ACCOUNTCAL.B', documented('ACCOUNTCAL', 'DebitSinceDt', 'FCT_PRODUCT_MASTER', 'LAST_UNDER_DRAWING_DATE'), [nameRef]);
const meta = { via: 'selected' as const, comment: '', at: '2026-11-23T00:00:00.000Z' };
const noEdits: Record<string, RuleEdit> = {};

describe('rule approval eligibility', () => {
  it('approves a rule whose columns are all documented, and creates no new mapping', () => {
    const plan = planApproval([clean], [clean.id], noEdits, []);
    expect(plan.eligible).toHaveLength(1);
    expect(plan.ineligible).toHaveLength(0);
    expect(plan.newMappings).toHaveLength(0);
    expect(plan.eligible[0].mappings[0].action).toBe('reused');
    expect(plan.eligible[0].mappings[0].evidence).toMatch(/FCT_PRODUCT_MASTER row 97/);
  });

  it('never silently approves an unmapped, suggested or ambiguous column and says why', () => {
    const missing = rule('p::a', documented('ACCOUNTCAL', 'X1', 'T', 'C'), [res('ACCOUNTCAL', 'Gone', 'missing', null)]);
    const suggested = rule('p::b', documented('ACCOUNTCAL', 'X2', 'T', 'C'), [res('ACCOUNTCAL', 'Sug', 'suggested', { ...cand('T', 'SUG', 'agent4-suggestion'), confidence: 80 })]);
    const ambiguous = rule('p::c', documented('ACCOUNTCAL', 'X3', 'T', 'C'), [res('ACCOUNTCAL', 'Amb', 'ambiguous', cand('T1', 'AMB', 'workbook'), [cand('T1', 'AMB', 'workbook'), cand('T2', 'AMB', 'workbook')])]);
    const noTarget = rule('p::d', res('WORK', 'Tmp', 'missing', null), []);
    const plan = planApproval([missing, suggested, ambiguous, noTarget], [missing.id, suggested.id, ambiguous.id, noTarget.id], noEdits, []);
    expect(plan.eligible).toHaveLength(0);
    expect(plan.ineligible.map((a) => a.blockers[0])).toEqual([
      expect.stringMatching(/ACCOUNTCAL\.GONE is not mapped/),
      expect.stringMatching(/Simulated suggestion .*80%/),
      expect.stringMatching(/could map to 2 TRAQ columns/),
      expect.stringMatching(/no TRAQ column to write to/),
    ]);
    expect(plan.newMappings).toHaveLength(0);
  });

  it('blocks a rule whose expression still has placeholders, but not one the reviewer corrected by hand', () => {
    const broken = rule('p::e', documented('ACCOUNTCAL', 'X', 'T', 'C'), [], {
      traq: { ...clean.traq, expression: 'IF([[PARAM @TIMEKEY]] > 1)THEN(1)ELSE(2)' },
      issues: [{ severity: 'error', code: 'PARAM', message: 'Parameter @TIMEKEY has no value.' }],
    });
    expect(assessRule(broken, undefined, buildCtx([])).blockers.join(' ')).toMatch(/PARAM/);
    const fixed: RuleEdit = { traq: { expression: 'IF(1 > 1)THEN(1)ELSE(2)' }, editedAt: '' };
    expect(assessRule(broken, fixed, buildCtx([])).eligible).toBe(true);
  });

  it('lets the reviewer approve an ambiguous target by picking one candidate, and saves that choice as a mapping', () => {
    const a = cand('T1', 'COL', 'workbook'); const b = cand('T2', 'COL', 'workbook');
    const amb = rule('p::f', res('ACCOUNTCAL', 'Col', 'ambiguous', a, [a, b]), []);
    expect(assessRule(amb, undefined, buildCtx([])).eligible).toBe(false);
    const pick: RuleEdit = { traq: { entity: 'T2', column: 'COL' }, editedAt: '' };
    const plan = planApproval([amb], [amb.id], { [amb.id]: pick }, []);
    expect(plan.eligible).toHaveLength(1);
    expect(plan.newMappings[0]).toMatchObject({ targetTable: 'T2', targetColumn: 'COL', action: 'created' });
  });

  it('skips rules that are already approved (no reprocessing) and ignores repeated ids', () => {
    const edits: Record<string, RuleEdit> = { [clean.id]: { decision: 'approved', editedAt: '' } };
    const plan = planApproval([clean, withName], [clean.id, clean.id, withName.id, withName.id], edits, []);
    expect(plan.alreadyApproved).toEqual([clean.id]);
    expect(plan.eligible.map((a) => a.ruleId)).toEqual([withName.id]);
  });
});

describe('automatic mapping creation without duplicates or overwrites', () => {
  it('saves only the same-name match the reviewer confirms, with rule id and evidence', () => {
    const plan = planApproval([withName], [withName.id], noEdits, []);
    expect(plan.newMappings).toHaveLength(1);
    const out = applyPlan([], {}, plan, meta);
    expect(out.created).toBe(1);
    expect(out.manualMappings).toHaveLength(1);
    expect(out.manualMappings[0]).toMatchObject({
      sourceTable: 'ACCOUNTCAL', sourceColumn: 'NPA_DATE', targetTable: 'FCT_PRODUCT_MASTER', targetColumn: 'NPA_DATE',
      origin: 'rule-approval', ruleIds: [withName.id], basis: 'name-match',
    });
    expect(out.manualMappings[0].evidence).toMatch(/same column name/i);
    expect(out.approvals[withName.id].mappings.find((m) => m.key === 'ACCOUNTCAL.NPA_DATE')?.action).toBe('created');
    expect(out.approvals[withName.id].via).toBe('selected');
  });

  it('creates one mapping when two rules need the same pair, and links both rules to it', () => {
    const plan = planApproval([withName, withName2], [withName.id, withName2.id], noEdits, []);
    expect(plan.newMappings).toHaveLength(1);
    const out = applyPlan([], {}, plan, meta);
    expect(out.manualMappings).toHaveLength(1);
    expect(out.manualMappings[0].ruleIds).toEqual([withName.id, withName2.id]);
  });

  it('reuses an existing Agent 4 mapping on a later approval instead of adding a duplicate', () => {
    const first = applyPlan([], {}, planApproval([withName], [withName.id], noEdits, []), meta);
    const reviewed: ReviewedMapping[] = first.manualMappings.map((m) => ({ id: m.id, targetTable: m.targetTable, targetColumn: m.targetColumn, targetType: m.targetType, sourceTable: m.sourceTable, sourceColumn: m.sourceColumn, sourceType: m.sourceType }));
    const second = planApproval([withName2], [withName2.id], noEdits, reviewed);
    expect(second.newMappings).toHaveLength(0);
    const out = applyPlan(first.manualMappings, first.approvals, second, meta);
    expect(out.manualMappings).toHaveLength(1);
    expect(out.manualMappings[0].ruleIds).toEqual([withName.id, withName2.id]);
    expect(out.created).toBe(0);
  });

  it('does not overwrite a conflicting mapping: the rule is blocked and the mapping is untouched', () => {
    const existing: ManualMapping = {
      id: 'manual:1', targetTable: 'FCT_PRODUCT_MASTER', targetColumn: 'OTHER_DATE', targetType: 'DATE', sourceTable: 'ACCOUNTCAL', sourceColumn: 'NPA_DATE', sourceType: '', note: '', createdAt: '',
    };
    const reviewed: ReviewedMapping[] = [{ id: existing.id, targetTable: existing.targetTable, targetColumn: existing.targetColumn, targetType: '', sourceTable: 'ACCOUNTCAL', sourceColumn: 'NPA_DATE', sourceType: '' }];
    const plan = planApproval([withName], [withName.id], noEdits, reviewed);
    expect(plan.eligible).toHaveLength(0);
    expect(plan.ineligible[0].blockers[0]).toMatch(/conflicts with the Agent 4 mapping to FCT_PRODUCT_MASTER\.OTHER_DATE/);
    expect(applyPlan([existing], {}, plan, meta).manualMappings).toEqual([existing]);
  });

  it('flags two rules in one batch that need different targets for the same source column', () => {
    const other = rule('DPD::ACCOUNTCAL.C', documented('ACCOUNTCAL', 'StockStDt', 'FCT_PRODUCT_MASTER', 'STOCK_STMT_SUBMISSION_DATE'), [byName('ACCOUNTCAL', 'NPA_DATE', 'FCT_NPA_PRODUCT', 'NPA_DATE')]);
    const plan = planApproval([withName, other], [withName.id, other.id], noEdits, []);
    expect(plan.eligible.map((a) => a.ruleId)).toEqual([withName.id]);
    expect(plan.ineligible[0].blockers[0]).toMatch(/conflicts with .* another rule in this batch/);
  });
});

describe('rule to mapping synchronisation', () => {
  it('finds the approved rules that depend on a mapping and withdraws them without deleting other mappings', () => {
    const out = applyPlan([], {}, planApproval([withName, withName2], [withName.id, withName2.id], noEdits, []), meta);
    const id = out.manualMappings[0].id;
    expect(rulesDependingOn(out.approvals, out.manualMappings, id).sort()).toEqual([withName.id, withName2.id].sort());
    const after = withdraw(out.manualMappings, out.approvals, [withName.id]);
    expect(Object.keys(after.approvals)).toEqual([withName2.id]);
    expect(after.manualMappings[0].ruleIds).toEqual([withName2.id]);
  });

  it('reports total, approved, pending, eligible and needs-attention counts', () => {
    const bad = rule('p::z', res('WORK', 'Tmp', 'missing', null));
    const edits: Record<string, RuleEdit> = { [clean.id]: { decision: 'approved', editedAt: '' }, 'DPD::ACCOUNTCAL.B': { decision: 'rejected', editedAt: '' } };
    const s = approvalSummary([clean, withName, withName2, bad], edits, []);
    expect(s).toEqual({ total: 4, approved: 1, rejected: 1, pending: 2, eligiblePending: 1, attention: 1 });
  });
});

describe('export readiness', () => {
  const approved = (r: ConvertedRule): Record<string, RuleEdit> => ({ [r.id]: { decision: 'approved', editedAt: '' } });

  it('marks Ready only an approved rule whose every column is confirmed', () => {
    expect(exportBlockers(clean, approved(clean)[clean.id])).toEqual([]);
    expect(exportBlockers(clean, undefined)).toEqual(['Not approved yet']);
    // approved but a column is still only a name match (not yet saved in Agent 4)
    expect(exportBlockers(withName, approved(withName)[withName.id]).join(' ')).toMatch(/name match only/);
  });

  it('never exports an unresolved reference as valid', () => {
    const unresolved = rule('p::u', documented('ACCOUNTCAL', 'X', 'T', 'C'), [res('ACCOUNTCAL', 'Gone', 'missing', null)], { traq: { ...clean.traq, expression: 'IF("T"."C" > [[UNMAPPED ACCOUNTCAL.Gone]])THEN(1)ELSE(2)' } });
    const edits = approved(unresolved);
    expect(exportBlockers(unresolved, edits[unresolved.id]).join(' ')).toMatch(/not mapped.*placeholders/s);
    expect(rulesInScope([unresolved], edits, 'validated')).toEqual([]);
  });

  it('exports validated rules only, and the complete report separates Ready from Pending with the original logic kept', () => {
    const edits = { ...approved(clean), ...approved(withName) };
    expect(rulesInScope([clean, withName], edits, 'validated').map((r) => r.id)).toEqual([clean.id]);
    expect(rulesInScope([clean, withName], edits, 'approved').map((r) => r.id)).toEqual([clean.id, withName.id]);
    const split = splitByReadiness([withName, clean], edits);
    expect(split.ready.map((r) => r.id)).toEqual([clean.id]);
    expect(split.pending[0].reasons.length).toBeGreaterThan(0);

    const doc = conversionReportDoc([withName, clean], edits, '2026-01-01', 't');
    const rules = doc.sheets.find((s) => s.name === 'Rules');
    expect(rules?.columns.slice(0, 2)).toEqual(['Export status', 'Why not ready']);
    expect(rules?.columns).toContain('Original CrisMac logic');
    expect(rules?.rows.map((r) => r[0])).toEqual(['Ready for TRAQ', 'Pending']); // ready block first
    expect(rules?.rows[0][12]).toBe('orig');
  });
});
