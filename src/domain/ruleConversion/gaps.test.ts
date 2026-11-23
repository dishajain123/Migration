import { describe, expect, it } from 'vitest';
import type { ColumnResolution, ConvertedRule, MappingCandidate, MappingStatus } from '@/types';
import { findGaps, gapsDoc } from './gaps';

const res = (t: string, c: string, status: MappingStatus, chosen: MappingCandidate | null = null): ColumnResolution => ({
  crismacTable: t, crismacColumn: c.toUpperCase(), status, chosen, candidates: chosen ? [chosen] : [], note: 'note',
});
const ok = (c: string) => res('ACCOUNTCAL', c, 'documented', { table: 'FPM', column: c, dataType: '', basis: 'workbook' });
const rule = (id: string, target: ColumnResolution, references: ColumnResolution[]): ConvertedRule => ({
  id, procedure: 'DPD', procedureFile: 'x.sql', stage: '', crismacTable: target.crismacTable, crismacColumn: target.crismacColumn, statements: [], crismacLogic: 'logic', target, references, params: [],
  traq: { entity: '', column: '', columnType: '', derivationOption: 'Formula Expression', expression: 'IF([[UNMAPPED DIMPRODUCT.SCHEMETYPE]])THEN(1)ELSE(2)', explanation: '', effectiveStartDate: '', status: 'PENDING_REVIEW', dataType: '', reads: [], crismac: 'DPD 1-2' },
  status: 'needs-review', issues: [], confidence: { value: 0, source: 'mock', basis: [] }, dependencies: [], origin: 'derived',
});

const dim = res('DIMPRODUCT', 'SchemeType', 'missing');
const sug = res('DIMPRODUCT', 'Aqua_Scheme', 'suggested', { table: 'FPM', column: 'SCHEME', dataType: '', basis: 'agent4-suggestion', confidence: 62 });
const rules = [
  rule('a', ok('LastCrDate'), [dim]),
  rule('b', ok('StockStDt'), [dim, sug]),
  rule('c', res('ACLRUNNINGPROCESSSTATUS', 'COMPLETED', 'missing'), []),
  rule('d', ok('ContiExcessDt'), [ok('ContiExcessDt')]), // fully mapped: not a gap
];

describe('missing-column report', () => {
  const r = findGaps(rules, { b: { decision: 'approved', editedAt: '' } });

  it('lists only unconfirmed columns, with the rules each blocks, most blocking first', () => {
    expect(r.columns.map((c) => c.key)).toEqual(['DIMPRODUCT.SCHEMETYPE', 'ACLRUNNINGPROCESSSTATUS.COMPLETED', 'DIMPRODUCT.AQUA_SCHEME']);
    expect(r.columns[0].rules.map((x) => x.ruleId)).toEqual(['a', 'b']);
    expect(r.rules.map((x) => x.rule.id)).toEqual(['a', 'b', 'c']); // 'd' has no gap
    expect(r.stats).toMatchObject({ totalRules: 4, rulesWithGap: 3, columns: 3, missing: 2, suggested: 1, writeGaps: 1 });
  });

  it('tells which column is the only blocker of a rule and keeps suggestions as information only', () => {
    expect(r.columns[0].unblocks).toBe(1); // rule a only; rule b also misses AQUA_SCHEME
    expect(r.columns[2].suggestion).toMatch(/FPM\.SCHEME \(62%, Simulated\)/);
    expect(r.columns[0].rules.find((x) => x.ruleId === 'b')?.decision).toBe('approved');
  });

  it('exports the gaps and the affected rules with the unresolved expression', () => {
    const doc = gapsDoc(r, 't');
    expect(doc.sheets.map((s) => s.name)).toEqual(['Missing columns', 'Affected rules']);
    expect(doc.sheets[0].rows).toHaveLength(3);
    expect(doc.sheets[1].rows).toHaveLength(4); // a:1, b:2, c:1
    expect(String(doc.sheets[1].rows[0][8])).toContain('[[UNMAPPED');
  });
});
