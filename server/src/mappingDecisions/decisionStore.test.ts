import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MappingDecisionRecord } from '../../../src/types/decisions';
import { GatewayError } from '../providers/types';
import { parseDecisionRecord } from '../schemas/requests';
import { DecisionStore } from './decisionStore';

const rec = (id: string, over: Partial<MappingDecisionRecord> = {}): MappingDecisionRecord => ({
  id, targetTable: 'T', targetColumn: 'C', sourceTable: 'S', sourceColumn: 'X', decision: 'approved', origin: 'heuristic', comment: '', decidedAt: '2026-11-01T00:00:00.000Z', ...over,
});

describe('DecisionStore', () => {
  it('upserts, lists newest first, replaces by id, and removes', () => {
    const s = new DecisionStore(null);
    s.upsert('u', rec('a', { decidedAt: '2026-11-01T00:00:00.000Z' }));
    s.upsert('u', rec('b', { decidedAt: '2026-11-02T00:00:00.000Z' }));
    s.upsert('u', rec('a', { decision: 'rejected', decidedAt: '2026-11-03T00:00:00.000Z' }));
    expect(s.list('u').map((r) => `${r.id}:${r.decision}`)).toEqual(['a:rejected', 'b:approved']);
    expect(s.remove('u', 'a')).toBe(true);
    expect(s.remove('u', 'a')).toBe(false);
    expect(s.list('u')).toHaveLength(1);
  });

  it('keeps users separate', () => {
    const s = new DecisionStore(null);
    s.upsert('alice', rec('a'));
    expect(s.list('bob')).toEqual([]);
    expect(s.remove('bob', 'a')).toBe(false);
  });

  it('persists to disk and reloads, and survives a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'));
    try {
      const file = join(dir, 'sub', 'd.json');
      new DecisionStore(file).upsert('u', rec('a', { transformation: 'CAST(X AS DATE)', provenance: 'profile_enriched', confidence: 61 }));
      expect(new DecisionStore(file).list('u')[0]).toMatchObject({ id: 'a', transformation: 'CAST(X AS DATE)', provenance: 'profile_enriched', confidence: 61 });
      expect(readFileSync(file, 'utf8')).not.toMatch(/apiKey|encKey/);
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, '{ not json');
      expect(new DecisionStore(bad).list('u')).toEqual([]);
      expect(new DecisionStore(join(dir, 'missing.json')).list('u')).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('parseDecisionRecord', () => {
  const body = { id: 'sug:T.C<-S.X', targetTable: 'T', targetColumn: 'C', sourceTable: 'S', sourceColumn: 'X', decision: 'approved', origin: 'ai', provenance: 'embedding_enriched', confidence: 150.4, transformation: '  CAST(X AS INT) ', comment: 'ok' };
  it('accepts a valid record, clamps confidence and trims the transformation', () => {
    const r = parseDecisionRecord(body, () => '2026-11-25T00:00:00.000Z');
    expect(r).toMatchObject({ id: 'sug:T.C<-S.X', confidence: 100, transformation: 'CAST(X AS INT)', decidedAt: '2026-11-25T00:00:00.000Z', provenance: 'embedding_enriched' });
  });
  it('rejects missing fields, bad enums and non-printable ids', () => {
    for (const bad of [{ ...body, decision: 'maybe' }, { ...body, origin: 'robot' }, { ...body, targetTable: '' }, { ...body, id: 'a\nb' }, { ...body, provenance: 'magic' }, { ...body, confidence: 'high' }]) {
      expect(() => parseDecisionRecord(bad)).toThrow(GatewayError);
    }
  });
});
