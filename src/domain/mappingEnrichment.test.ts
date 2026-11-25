import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, TableDef, WorkbookModel } from '@/types';
import type { EmbeddingIndex } from '@/types/profile';
import { analyseTable, suggestionsFromAnalysis } from './mappingEngine';
import { parseProfileJson } from './profile';
import { embeddingBonus, embeddingKey, EMBEDDING_FLOOR } from './schemaEmbedding';
import { suggestionsForTable } from './suggest';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const tbl = (name: string, system: TableDef['system'], layer: TableDef['layer'], columns: ColumnDef[]): TableDef => ({ name, system, layer, columns });
const map = (src: string, sc: string, tt: string, tc: string, rowNo: number): MappingRow => ({
  id: `${tt}.${tc}.${rowNo}`, sourceSystem: 'X', sourceTable: src, sourceColumn: sc, sourceColumns: [sc], sourceType: '', targetTable: tt, targetColumn: tc, targetType: '', mapType: 'DIRECT', remark: '', sheet: 'S', rowNo,
});

// CUST_SEG shares no name tokens with CLIENT_CLASS, so the workbook alone cannot connect them.
function model(): WorkbookModel {
  return {
    tables: [
      tbl('ACCOUNT_MASTER', 'CrisMac', 'SOURCE', [col('ACCOUNT_MASTER', 'ACCT_NO', 'VARCHAR2(20)'), col('ACCOUNT_MASTER', 'CLIENT_CLASS', 'VARCHAR2(5)'), col('ACCOUNT_MASTER', 'BRANCH_NM', 'VARCHAR2(5)')]),
      tbl('STG_T', 'TRAQ', 'STAGING', [col('STG_T', 'ACCT_NUMBER', 'VARCHAR2(20)'), col('STG_T', 'CUST_SEG', 'VARCHAR2(5)')]),
    ],
    mappings: [map('ACCOUNT_MASTER', 'ACCT_NO', 'STG_T', 'ACCT_NUMBER', 1)],
    unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
  } as WorkbookModel;
}

const profile = parseProfileJson(JSON.stringify({
  version: 1, label: 'test',
  columns: [
    { table: 'STG_T', column: 'CUST_SEG', description: 'Customer segment', glossaryTerm: 'Segment', valueSet: 'SEG' },
    { table: 'ACCOUNT_MASTER', column: 'CLIENT_CLASS', description: 'Client segment class', glossaryTerm: 'Segment', valueSet: 'SEG' },
    { table: 'ACCOUNT_MASTER', column: 'BRANCH_NM', description: 'Branch name' },
  ],
  glossary: [{ term: 'Segment' }], valueSets: [{ name: 'SEG', values: ['A', 'B', 'C'] }],
})).profile!;

const colOf = (a: ReturnType<typeof analyseTable>, name: string) => a!.columns.find((c) => c.targetColumn === name)!;

describe('workbook-only mode is unchanged by default', () => {
  it('cannot connect differently-named columns and reports workbook provenance', () => {
    const c = colOf(analyseTable(model(), 'STG_T'), 'CUST_SEG');
    expect(['suggested', 'ambiguous']).not.toContain(c.status);
    expect(c.candidates.every((x) => (x.provenance ?? 'workbook') === 'workbook')).toBe(true);
    expect(c.candidates.every((x) => x.profileBonus === undefined && x.embeddingBonus === undefined)).toBe(true);
  });

  it('gives the same result with empty options as with none, and leaves the context line alone', () => {
    const a = analyseTable(model(), 'STG_T');
    const b = analyseTable(model(), 'STG_T', undefined, {});
    expect(JSON.stringify(b?.columns)).toBe(JSON.stringify(a?.columns));
    expect(a?.context.columnDescriptions).toBe('Not provided in workbook');
    expect(a?.context.enrichment).toBeUndefined();
  });
});

describe('profile enrichment', () => {
  it('connects columns through a shared glossary term and value set, tagged profile_enriched', () => {
    const m = model();
    const a = analyseTable(m, 'STG_T', undefined, { profile });
    const c = colOf(a, 'CUST_SEG');
    expect(c.status).toBe('suggested');
    expect(c.best?.column).toBe('CLIENT_CLASS');
    expect(c.best?.provenance).toBe('profile_enriched');
    expect(c.best?.profileSignals?.join(' ')).toMatch(/glossary/);
    expect(a?.context.enrichment?.[0]).toMatch(/profile "test"/);
    // the unrelated candidate is not boosted
    expect(c.candidates.find((x) => x.column === 'BRANCH_NM')?.profileBonus).toBeUndefined();
  });

  it('labels the suggestion, keeps it simulated and uncalibrated, and flags it for extra care', () => {
    const m = model();
    const s = suggestionsForTable(m, 'STG_T', undefined, { profile }).find((x) => x.targetColumn === 'CUST_SEG')!;
    expect(s.provenance).toBe('profile_enriched');
    expect(s.confidenceBasis).toBe('uncalibrated');
    expect(s.origin).toBe('mock');
    expect(s.issues.join(' ')).toMatch(/non-workbook input/);
    expect(s.reasons.join(' ')).toMatch(/Profile:/);
    // a plain workbook suggestion for the same model stays 'workbook'
    expect(suggestionsFromAnalysis(m, analyseTable(m, 'STG_T')!).every((x) => x.provenance === 'workbook')).toBe(true);
  });

  it('does not override a type clash', () => {
    const m = model();
    m.tables[0].columns[1] = col('ACCOUNT_MASTER', 'CLIENT_CLASS', 'DATE'); // DATE source vs NUMBER target (set below)
    m.tables[1].columns[1] = col('STG_T', 'CUST_SEG', 'NUMBER(5)');
    const c = colOf(analyseTable(m, 'STG_T', undefined, { profile }), 'CUST_SEG');
    expect(c.candidates.find((x) => x.column === 'CLIENT_CLASS')?.accepted).toBe(false); // number <-> date is incompatible
  });
});

describe('embedding signal', () => {
  const vec = (v: number[]) => v;
  const index = (sim: boolean, usesProfile = false): EmbeddingIndex => ({
    id: `emb:${sim}${usesProfile}`, model: 'test:model', usesProfile,
    vectors: {
      [embeddingKey('STG_T', 'CUST_SEG')]: vec([1, 0]),
      [embeddingKey('ACCOUNT_MASTER', 'CLIENT_CLASS')]: sim ? vec([0.95, 0.31]) : vec([0, 1]),
      [embeddingKey('ACCOUNT_MASTER', 'BRANCH_NM')]: vec([0, 1]),
    },
  });

  it('bonus is zero at or below the floor and grows to the weight', () => {
    expect(embeddingBonus(undefined)).toBe(0);
    expect(embeddingBonus(EMBEDDING_FLOOR)).toBe(0);
    expect(embeddingBonus(1)).toBeCloseTo(0.2);
    expect(embeddingBonus(0.8)).toBeCloseTo(0.1);
  });

  it('never creates a match on its own: with no name, evidence or profile signal the bonus is withheld', () => {
    const m = model();
    const alone = colOf(analyseTable(m, 'STG_T', undefined, { embeddings: index(true) }), 'CUST_SEG');
    const cand = alone.candidates.find((x) => x.column === 'CLIENT_CLASS')!;
    expect(cand.embeddingSimilarity).toBeGreaterThan(0.9); // measured and shown ...
    expect(cand.embeddingBonus).toBe(0); // ... but it adds nothing
    expect(cand.provenance).toBe('workbook');
    expect(['suggested', 'ambiguous']).not.toContain(alone.status);
  });

  it('adds to a profile-backed match, which is then treated as non-workbook input', () => {
    const m = model();
    const base = colOf(analyseTable(m, 'STG_T', undefined, { profile }), 'CUST_SEG').best!;
    const both = colOf(analyseTable(m, 'STG_T', undefined, { profile, embeddings: index(true, true) }), 'CUST_SEG').best!;
    expect(both.embeddingBonus).toBeGreaterThan(0);
    expect(both.score).toBeGreaterThan(base.score);
    expect(both.provenance).toBe('profile_enriched');
  });

  it('supports a name-similar match and tags it embedding_enriched when no profile content was embedded', () => {
    const m = model();
    m.tables[0].columns.push(col('ACCOUNT_MASTER', 'SEGMENT_CD', 'VARCHAR2(5)'));
    m.tables[1].columns.push(col('STG_T', 'CUST_SEGMENT_CODE', 'VARCHAR2(5)'));
    const idx: EmbeddingIndex = { id: 'emb:x', model: 't', usesProfile: false, vectors: { [embeddingKey('STG_T', 'CUST_SEGMENT_CODE')]: [1, 0], [embeddingKey('ACCOUNT_MASTER', 'SEGMENT_CD')]: [0.9, 0.43] } };
    const withEmb = colOf(analyseTable(m, 'STG_T', undefined, { embeddings: idx }), 'CUST_SEGMENT_CODE').best!;
    const without = colOf(analyseTable(m, 'STG_T'), 'CUST_SEGMENT_CODE').best!;
    expect(withEmb.column).toBe('SEGMENT_CD');
    expect(withEmb.provenance).toBe('embedding_enriched');
    expect(withEmb.score).toBeGreaterThan(without.score);
    expect(without.provenance).toBe('workbook');
  });

  it('dissimilar vectors add nothing', () => {
    const c = colOf(analyseTable(model(), 'STG_T', undefined, { embeddings: index(false) }), 'CUST_SEG');
    expect(c.candidates.every((x) => !x.embeddingBonus)).toBe(true);
  });
});
