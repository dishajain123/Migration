import { describe, expect, it } from 'vitest';
import type { ColumnDef, TableDef, WorkbookModel } from '@/types';
import { buildGapMappingInput, parseGapMappingOutput } from './aiGapMapping';
import type { ColumnGap } from './gaps';

const col = (table: string, name: string, dataType: string, traqOnly = false): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: 0, traqOnly, sheet: 's', rowNo: 0 });
const model = {
  tables: [
    { name: 'FCT_X', system: 'TRAQ', layer: 'MART', columns: [col('FCT_X', 'LAST_CREDIT_DATE', 'DATE'), col('FCT_X', 'AMOUNT', 'NUMBER(10)'), col('FCT_X', 'ONLY_TRAQ', 'DATE', true), col('FCT_X', 'OTHER_DATE', 'DATE')] } as TableDef,
    { name: 'ACCOUNTCAL', system: 'CrisMac', layer: 'CRISMAC', columns: [col('ACCOUNTCAL', 'LastCrDate', 'datetime'), col('ACCOUNTCAL', 'Bal', 'varchar(5)')] } as TableDef,
  ],
  mappings: [], unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as unknown as WorkbookModel;

const gap = (table: string, column: string): ColumnGap => ({ key: `${table}.${column}`, crismacTable: table, crismacColumn: column, kind: 'missing', suggestion: '', note: '', rules: [], writtenBy: 1, readBy: 0, unblocks: 1 });
const gaps = [gap('ACCOUNTCAL', 'LastCrDate'), gap('ACCOUNTCAL', 'Bal'), gap('ACCOUNTCAL', 'Mystery')];
const input = () => buildGapMappingInput(model, gaps, [])!;

describe('AI mapping of missing columns', () => {
  it('offers only in-scope TRAQ columns (never traqOnly ones) and says nothing is invented', () => {
    const i = input();
    expect([...i.pool.keys()].sort()).toEqual(['FCT_X.AMOUNT', 'FCT_X.LAST_CREDIT_DATE', 'FCT_X.OTHER_DATE']);
    const text = i.prompt.messages.map((m) => m.content).join('\n');
    expect(text).toContain('ACCOUNTCAL.LastCrDate');
    expect(text).not.toContain('ONLY_TRAQ');
    expect(text).toContain('Not provided in workbook');
  });

  it('keeps a valid pick and drops invented, traqOnly, type-incompatible and duplicate picks, never repairing them', () => {
    const out = JSON.stringify({
      picks: [
        { gap: 'ACCOUNTCAL.LastCrDate', traqTable: 'FCT_X', traqColumn: 'LAST_CREDIT_DATE', confidence: 90, reason: 'same meaning' },
        { gap: 'ACCOUNTCAL.Bal', traqTable: 'FCT_X', traqColumn: 'OTHER_DATE', confidence: 80, reason: 'guess' },
        { gap: 'ACCOUNTCAL.Mystery', traqTable: 'FCT_X', traqColumn: 'ONLY_TRAQ', confidence: 70, reason: 'x' },
        { gap: 'ACCOUNTCAL.Mystery', traqTable: 'FCT_X', traqColumn: 'INVENTED', confidence: 60, reason: 'x' },
        { gap: 'NOT.ASKED', traqTable: 'FCT_X', traqColumn: 'AMOUNT', confidence: 50, reason: 'x' },
      ],
    });
    const set = parseGapMappingOutput(input(), out)!;
    // varchar -> DATE is a conversion the checker flags as needing one, not as incompatible, so it survives with a warning.
    expect(set.proposals.map((p) => `${p.gapKey}>${p.traqTable}.${p.traqColumn}`)).toEqual(['ACCOUNTCAL.LastCrDate>FCT_X.LAST_CREDIT_DATE', 'ACCOUNTCAL.Bal>FCT_X.OTHER_DATE']);
    expect(set.proposals[0]).toMatchObject({ confidence: 90, typeCheck: 'compatible' });
    expect(set.proposals[1].typeCheck).toBe('warn');
    expect(set.rejected.some((r) => r.gapKey === 'ACCOUNTCAL.Mystery' && /Not an in-scope/.test(r.reason))).toBe(true);
    expect(set.rejected.some((r) => r.gapKey === 'NOT.ASKED')).toBe(true);
    expect(set.unresolved.map((u) => u.gapKey)).toContain('ACCOUNTCAL.Mystery');
  });

  it('does not let two CrisMac columns feed one TRAQ column and rejects non-JSON output', () => {
    const out = JSON.stringify({ picks: [
      { gap: 'ACCOUNTCAL.LastCrDate', traqTable: 'FCT_X', traqColumn: 'LAST_CREDIT_DATE', confidence: 90, reason: 'a' },
      { gap: 'ACCOUNTCAL.Bal', traqTable: 'FCT_X', traqColumn: 'LAST_CREDIT_DATE', confidence: 60, reason: 'b' },
    ] });
    const set = parseGapMappingOutput(input(), out)!;
    expect(set.proposals).toHaveLength(1);
    expect(set.rejected[0].reason).toMatch(/already proposed/);
    expect(parseGapMappingOutput(input(), 'sorry, I cannot')).toBeNull();
  });
});
