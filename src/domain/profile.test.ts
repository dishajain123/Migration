import { describe, expect, it } from 'vitest';
import { describeProfile, parseProfileCsv, parseProfileFile, parseProfileJson, profileFor } from './profile';
import { profileSimilarity } from './mappingSemantics';

const good = {
  version: 1, label: 'L', shareSampleValuesWithAi: false,
  columns: [
    { table: 'A', column: 'Seg', description: 'Customer segment code', glossaryTerm: 'Customer segment', valueSet: 'SEG', profile: { distinctCount: 6, nullRate: 0.01, min: 1, max: 9, topValues: ['A', 'B', 'C'] } },
    { table: 'B', column: 'CLIENT_CLASS', description: 'Class of the client segment', glossaryTerm: 'client class', valueSet: 'SEG' },
  ],
  glossary: [{ term: 'Customer segment', synonyms: ['client class'] }, { term: 'client class' }],
  valueSets: [{ name: 'SEG', values: ['A', 'B', 'C', 'D'] }],
};

describe('profile parsing', () => {
  it('accepts the documented JSON shape and gives a stable content id', () => {
    const a = parseProfileJson(JSON.stringify(good));
    const b = parseProfileJson(JSON.stringify(good));
    expect(a.errors).toEqual([]);
    expect(a.profile?.columns).toHaveLength(2);
    expect(a.profile?.id).toBe(b.profile?.id);
    expect(parseProfileJson(JSON.stringify({ ...good, label: 'other' })).profile?.id).not.toBe(a.profile?.id);
  });

  it('reports invalid values instead of guessing', () => {
    const r = parseProfileJson(JSON.stringify({ ...good, columns: [{ table: 'A', column: 'X', profile: { nullRate: 5, distinctCount: -1 } }, { table: 'A' }] }));
    expect(r.errors.join('\n')).toMatch(/nullRate/);
    expect(r.errors.join('\n')).toMatch(/distinctCount/);
    expect(r.errors.join('\n')).toMatch(/"table" and "column" are required/);
    expect(parseProfileJson('{"columns":[]}').profile).toBeNull();
    expect(parseProfileJson('not json').errors[0]).toMatch(/Not valid JSON/);
  });

  it('warns about duplicates and undefined references', () => {
    const r = parseProfileJson(JSON.stringify({ ...good, columns: [...good.columns, { table: 'a', column: 'seg' }, { table: 'C', column: 'Z', valueSet: 'NOPE' }] }));
    expect(r.warnings.join('\n')).toMatch(/more than once/);
    expect(r.warnings.join('\n')).toMatch(/value set "NOPE"/);
  });

  it('parses CSV with | lists and builds glossary and value sets from the rows', () => {
    const csv = 'table,column,description,glossary_term,value_set,value_set_values,null_rate,top_values\nA,SEG,Segment,Customer segment,SEG,A|B|C,0.02,A|B\n';
    const r = parseProfileCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.profile?.valueSets[0].values).toEqual(['A', 'B', 'C']);
    expect(r.profile?.columns[0].profile?.topValues).toEqual(['A', 'B']);
    expect(r.profile?.shareSampleValuesWithAi).toBe(false);
    expect(parseProfileFile('x.csv', csv, true).profile?.shareSampleValuesWithAi).toBe(true);
    expect(parseProfileCsv('a,b\n1,2').profile).toBeNull();
  });

  it('never describes sample values unless sharing was explicitly allowed', () => {
    const off = parseProfileJson(JSON.stringify(good)).profile!;
    const on = parseProfileJson(JSON.stringify({ ...good, shareSampleValuesWithAi: true })).profile!;
    expect(describeProfile(off, 'a', 'seg')).toContain('null rate 1.0%');
    expect(describeProfile(off, 'a', 'seg')).not.toMatch(/top values/);
    expect(describeProfile(on, 'a', 'seg')).toMatch(/top values: A, B, C/);
  });
});

describe('profileSimilarity', () => {
  const p = parseProfileJson(JSON.stringify(good)).profile!;
  it('is strong for the same glossary term/synonym and value set, and zero without entries', () => {
    const s = profileSimilarity(profileFor(p, 'A', 'SEG'), profileFor(p, 'B', 'CLIENT_CLASS'));
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.signals.join(' ')).toMatch(/glossary/);
    expect(s.signals.join(' ')).toMatch(/value set/);
    expect(profileSimilarity(profileFor(p, 'A', 'SEG'), undefined)).toEqual({ score: 0, signals: [] });
  });
  it('stays low for unrelated columns', () => {
    const q = parseProfileJson(JSON.stringify({ version: 1, columns: [
      { table: 'A', column: 'X', description: 'Opening balance amount', profile: { distinctCount: 5000 } },
      { table: 'B', column: 'Y', description: 'Branch address line', profile: { distinctCount: 12 } },
    ] })).profile!;
    expect(profileSimilarity(profileFor(q, 'A', 'X'), profileFor(q, 'B', 'Y')).score).toBe(0);
  });
});
