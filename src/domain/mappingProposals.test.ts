import { describe, expect, it } from 'vitest';
import type { ColumnDef, MappingRow, Suggestion, TableDef, WorkbookModel } from '@/types';
import { mappingPrompt, parseMappingInsight } from './aiPrompts';
import { formatProposalInsight, parseMappingProposals } from './mappingProposals';
import { validateTransformation } from './transformValidator';

const col = (table: string, name: string, dataType: string, n = 0): ColumnDef => ({ id: `${table}.${name}`, table, name, dataType, nullable: true, ordinal: n, traqOnly: false, sheet: 's', rowNo: n });
const tbl = (name: string, system: TableDef['system'], layer: TableDef['layer'], columns: ColumnDef[]): TableDef => ({ name, system, layer, columns });
const row: MappingRow = { id: 'm1', sourceSystem: 'X', sourceTable: 'CM_ACCT', sourceColumn: 'ACCT_NO', sourceColumns: ['ACCT_NO'], sourceType: '', targetTable: 'STG_T', targetColumn: 'ACCT_NUMBER', targetType: '', mapType: 'DIRECT', remark: '', sheet: 'S', rowNo: 1 };

const model = {
  tables: [
    tbl('CM_ACCT', 'CrisMac', 'SOURCE', [col('CM_ACCT', 'ACCT_NO', 'VARCHAR2(20)'), col('CM_ACCT', 'STATUS_CD', 'VARCHAR2(2)'), col('CM_ACCT', 'FIRST_NM', 'VARCHAR2(30)'), col('CM_ACCT', 'LAST_NM', 'VARCHAR2(30)'), col('CM_ACCT', 'OPEN_DT', 'DATE')]),
    tbl('STG_T', 'TRAQ', 'STAGING', [col('STG_T', 'ACCT_NUMBER', 'VARCHAR2(20)'), col('STG_T', 'STATUS_DESC', 'VARCHAR2(10)'), col('STG_T', 'FULL_NAME', 'VARCHAR2(61)'), col('STG_T', 'OPENED_ON', 'DATE'), col('STG_T', 'LOAN_AMOUNT', 'NUMBER(10)'), col('STG_T', 'MISC', 'VARCHAR2(5)')]),
  ],
  mappings: [row], unmapped: [], daRules: [], decisionRows: [], sheets: [], outOfScope: [], loadedAt: '',
} as WorkbookModel;

const sug: Suggestion = {
  id: 'sug:1', targetTable: 'STG_T', targetColumn: 'STATUS_DESC', targetType: 'VARCHAR2(10)', sourceTable: 'CM_ACCT', sourceColumn: 'STATUS_CD', sourceType: 'VARCHAR2(2)',
  confidence: 70, reasons: [], issues: [], compat: 'compatible', ambiguous: false, origin: 'mock',
};
const base = { table: 'STG_T', suggestions: [sug], offered: new Set(['sug:1']), model };
const withTransform = { ...base, validateTransformation: (t: { expression: string; target: { table: string; column: string }; sources: { table: string; column: string }[] }) => validateTransformation({ ...t, model }) };

const text = JSON.stringify({
  picks: [
    { targetColumn: 'STATUS_DESC', candidateId: 'sug:1', confidence: 70, reason: 'code to text', transformation: "CASE WHEN STATUS_CD = 'A' THEN 'ACTIVE' ELSE 'OTHER' END" },
    { targetColumn: 'full_name', sources: [{ table: 'cm_acct', column: 'first_nm' }, { table: 'CM_ACCT', column: 'LAST_NM' }], confidence: 60, reason: 'names combine', transformation: "FIRST_NM + ' ' + LAST_NM" },
    { targetColumn: 'OPENED_ON', sources: [{ table: 'CM_ACCT', column: 'NOT_A_COLUMN' }], confidence: 90, reason: 'invented' },
    { targetColumn: 'LOAN_AMOUNT', sources: [{ table: 'CM_ACCT', column: 'OPEN_DT' }], confidence: 90, reason: 'date to number' },
    { targetColumn: 'MISC', sources: [{ table: 'GHOST', column: 'X' }], confidence: 50, reason: 'ghost table' },
    { targetColumn: 'MISC', sources: [{ table: 'CM_ACCT', column: 'FIRST_NM' }], confidence: 40, reason: 'weak', transformation: 'DROP TABLE CM_ACCT' },
  ],
  unresolved: [{ targetColumn: 'X', reason: 'nothing fits' }],
});

describe('LLM proposes, validator checks', () => {
  const set = parseMappingProposals(text, withTransform)!;

  it('surfaces valid proposals as AI_DRAFT with canonical names and types from the schema', () => {
    expect(set.proposals.map((p) => p.targetColumn)).toEqual(['STATUS_DESC', 'FULL_NAME', 'MISC']);
    const many = set.proposals.find((p) => p.targetColumn === 'FULL_NAME')!;
    expect(many.origin).toBe('ai-discovered');
    expect(many.sources).toEqual([{ table: 'CM_ACCT', column: 'FIRST_NM', type: 'VARCHAR2(30)' }, { table: 'CM_ACCT', column: 'LAST_NM', type: 'VARCHAR2(30)' }]);
    expect(many.targetType).toBe('VARCHAR2(61)');
    expect(many.status).toBe('AI_DRAFT');
    expect(many.transformation?.status).toBe('AI_DRAFT');
    expect(many.warnings.join(' ')).not.toMatch(/without a transformation/);
    expect(set.proposals[0].origin).toBe('heuristic-candidate');
    expect(set.proposals[0].transformation?.text).toMatch(/^CASE WHEN/);
  });

  it('drops invented columns, ghost tables and type-incompatible picks, with the validator message', () => {
    const msgs = set.discarded.map((d) => `${d.targetColumn}: ${d.reason}`).join('\n');
    expect(msgs).toMatch(/OPENED_ON: .*NOT_A_COLUMN/);
    expect(msgs).toMatch(/LOAN_AMOUNT: .*Incompatible families/);
    expect(msgs).toMatch(/MISC: .*GHOST/);
    expect(set.proposals.some((p) => p.targetColumn === 'OPENED_ON' || p.targetColumn === 'LOAN_AMOUNT')).toBe(false);
  });

  it('keeps a proposal whose transformation failed the parser check, but without that transformation', () => {
    const misc = set.proposals.find((p) => p.targetColumn === 'MISC')!;
    expect(misc.transformation).toBeUndefined();
    expect(set.discarded.some((d) => /transformation dropped/.test(d.reason) && /DROP/.test(d.reason + (d.source ?? '')))).toBe(true);
  });

  it('flags truncation and one-to-many reuse', () => {
    const misc = set.proposals.find((p) => p.targetColumn === 'MISC')!;
    expect(misc.validation).toBe('valid_with_warnings');
    expect(misc.warnings.join(' ')).toMatch(/truncation/);
    expect(misc.warnings.join(' ')).toMatch(/One-to-many: CM_ACCT.FIRST_NM is also proposed for FULL_NAME/);
  });

  it('drops a transformation when no parser is supplied, and every ai-discovered pick when there is no schema', () => {
    const noParser = parseMappingProposals(text, base)!;
    expect(noParser.proposals.every((p) => !p.transformation)).toBe(true);
    const noModel = parseMappingProposals(text, { ...base, model: undefined })!;
    expect(noModel.proposals.map((p) => p.targetColumn)).toEqual(['STATUS_DESC']);
    expect(noModel.discarded.some((d) => /cannot be verified/.test(d.reason))).toBe(true);
  });

  it('warns about several sources without a transformation and about competing proposals', () => {
    const t = JSON.stringify({ picks: [
      { targetColumn: 'FULL_NAME', sources: [{ table: 'CM_ACCT', column: 'FIRST_NM' }, { table: 'CM_ACCT', column: 'LAST_NM' }], confidence: 50, reason: 'r' },
      { targetColumn: 'FULL_NAME', sources: [{ table: 'CM_ACCT', column: 'ACCT_NO' }], confidence: 30, reason: 'r' },
    ] });
    const s = parseMappingProposals(t, base)!;
    expect(s.proposals).toHaveLength(2);
    expect(s.proposals[0].warnings.join(' ')).toMatch(/without a transformation/);
    expect(s.proposals[0].warnings.join(' ')).toMatch(/2 different proposals exist for FULL_NAME/);
  });

  it('rejects output without picks and formats a readable, tagged insight', () => {
    expect(parseMappingProposals('{"foo":1}', base)).toBeNull();
    const insight = formatProposalInsight(set, true);
    expect(insight.sections.map((s) => s.title)).toEqual(expect.arrayContaining(['Recommended mappings', 'Found beyond the heuristic candidates (validated against the schema)', 'Validator warnings', 'Discarded by the validator', 'No plausible candidate']));
    expect(insight.sections[0].points[0]).toMatch(/\[AI_DRAFT\]/);
    expect(insight.summary).toMatch(/not applied until a human approves/);
    expect(parseMappingInsight(text, [sug], new Set(['sug:1']), { table: 'STG_T', model })?.sections.length).toBeGreaterThan(0);
  });
});

describe('mappingPrompt gives the model the full candidate schema', () => {
  const unfed = ['STATUS_DESC', 'FULL_NAME'].map((c) => ({ targetTable: 'STG_T', targetColumn: c, targetType: 'VARCHAR2(10)', nullable: null, reason: 'no mapping row in workbook', hasSuggestion: c === 'STATUS_DESC', ambiguous: false }));
  const schema = [{ table: 'CM_ACCT', columns: [{ name: 'STATUS_CD', type: 'VARCHAR2(2)' }, { name: 'FIRST_NM', type: 'VARCHAR2(30)' }, { name: 'OPEN_DT', type: 'DATE' }] }];

  it('lists every pool column, not just the top heuristic hits, and columns with no heuristic candidate', () => {
    const { prompt, candidateIds } = mappingPrompt({ table: 'STG_T', unfed, suggestions: [sug], schema });
    const body = prompt.messages[1].content;
    expect(candidateIds).toEqual(new Set(['sug:1']));
    expect(body).toContain('candidateId=sug:1');
    expect(body).toMatch(/SOURCE SCHEMA/);
    for (const c of ['STATUS_CD', 'FIRST_NM', 'OPEN_DT']) expect(body).toContain(c);
    expect(body).toMatch(/NO heuristic candidate[\s\S]*FULL_NAME/);
    expect(prompt.messages[0].content).toMatch(/NEVER write a table or column that is not in SOURCE SCHEMA/);
  });

  it('includes profile descriptions but sample values only with consent', () => {
    const profile = (share: boolean) => ({
      version: 1 as const, id: 'p', shareSampleValuesWithAi: share, glossary: [], valueSets: [],
      columns: [{ table: 'CM_ACCT', column: 'STATUS_CD', description: 'Account status code', profile: { topValues: ['A', 'C'], distinctCount: 4 } }],
    });
    const off = mappingPrompt({ table: 'STG_T', unfed, suggestions: [sug], schema, profile: profile(false) }).prompt.messages[1].content;
    const on = mappingPrompt({ table: 'STG_T', unfed, suggestions: [sug], schema, profile: profile(true) }).prompt.messages[1].content;
    expect(off).toContain('Account status code');
    expect(off).toContain('distinct 4');
    expect(off).not.toMatch(/top values/);
    expect(on).toMatch(/top values: A, C/);
  });

  it('cuts an oversized schema and says so', () => {
    const big = [{ table: 'BIG', columns: Array.from({ length: 700 }, (_, i) => ({ name: `C${i}`, type: 'INT' })) }];
    const body = mappingPrompt({ table: 'STG_T', unfed, suggestions: [], schema: big }).prompt.messages[1].content;
    expect(body).toMatch(/showing 600 of 700/);
    expect(body).toMatch(/100 more columns not shown/);
  });
});
