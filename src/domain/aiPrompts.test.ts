import { describe, expect, it } from 'vitest';
import type { Suggestion, TableDetail } from '@/types';
import { extractJson, mappingPrompt, parseInsight, parseMappingInsight, tableBriefPrompt } from './aiPrompts';

const sug = (id: string, col: string): Suggestion => ({
  id, targetTable: 'T', targetColumn: col, targetType: 'int', sourceTable: 'S', sourceColumn: `${col}_SRC`, sourceType: 'int',
  confidence: 80, reasons: ['name'], issues: [], compat: 'compatible', ambiguous: false, origin: 'mock',
});

describe('extractJson / parseInsight', () => {
  it('handles fences and surrounding prose', () => {
    expect(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(extractJson('no json')).toBeNull();
  });
  it('parses a valid insight and drops empty sections', () => {
    const r = parseInsight('{"summary":"S","sections":[{"title":"A","points":["x"]},{"title":"B","points":[]}]}');
    expect(r).toEqual({ summary: 'S', sections: [{ title: 'A', points: ['x'] }] });
  });
  it('rejects output without a summary', () => { expect(parseInsight('{"sections":[]}')).toBeNull(); });
});

describe('mapping picks are restricted to offered candidates', () => {
  const suggestions = [sug('a', 'COL1'), sug('b', 'COL2')];
  it('drops invented candidates', () => {
    const { prompt, candidateIds } = mappingPrompt({ table: 'T', unfed: [
      { targetTable: 'T', targetColumn: 'COL1', targetType: 'int', nullable: null, reason: 'x', hasSuggestion: true, ambiguous: false },
    ], suggestions });
    expect(candidateIds).toEqual(new Set(['a']));
    expect(prompt.messages[1].content).toContain('candidateId=a');
    const out = parseMappingInsight('{"picks":[{"targetColumn":"COL1","candidateId":"a","confidence":150,"reason":"r"},{"targetColumn":"COL2","candidateId":"b","confidence":90,"reason":"r"},{"targetColumn":"X","candidateId":"zzz"}],"unresolved":[]}', suggestions, candidateIds);
    expect(out?.sections[0].points).toEqual(['COL1 <- S.COL1_SRC (AI-estimated 100%): r']);
    expect(out?.summary).toMatch(/2 discarded/);
  });
});

describe('prompts', () => {
  it('state missing facts rather than leaving blanks', () => {
    const d = { table: { name: 'T', system: 'TRAQ', layer: 'MART', listedColumns: 0, fedColumns: 0 }, banner: '', primaryKey: [], columns: [], notes: [] } as unknown as TableDetail;
    const p = tableBriefPrompt(d, []);
    expect(p.messages[1].content).toContain('Not provided in workbook');
    expect(p.messages[0].content).toMatch(/ONLY the facts/);
  });
});
