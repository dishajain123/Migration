import { describe, expect, it } from 'vitest';
import { PLATFORM_GUIDE } from '@/data/platformGuide';
import type { ChatTurn, DocInput } from '@/types';
import { buildContext, composeAnswer } from './answer';
import { buildKnowledge, suggestedQuestions } from './knowledge';
import { parseWorkbookCsv } from './parse';
import { buildIndex, detectEntities, inheritEntities, isSmallTalk, search } from './retrieval';

// Same flattened layout as the real workbook (see parse.test.ts). Real in-scope sheet names are required by the parser.
const HDR = 'Sheet_Name,Row_No,Col_1,Col_2,Col_3,Col_4,Col_5,Col_6,Col_7,Col_8,Col_9,Col_10,Col_11';
const CSV = [
  HDR,
  '01 Index,3,TRAQ TABLE,LAYER,COLUMNS,MAPPED,ROWS IN DB,STRUCTURE FROM,,,,,',
  '01 Index,4,STG_BILLS,STAGING,2,1,"1,000",RECP (live),,,,,',
  '01 Index,5,FCT_COLLATERAL,MART,3,2,0,MART (live),,,,,',
  'FCT_COLLATERAL,1,FCT_COLLATERAL,,,,,,,,,,',
  'FCT_COLLATERAL,2,"MART | 3 columns | primary key (PERIOD_ID, ID)",,,,,,,,,,',
  'FCT_COLLATERAL,4,TRAQ COLUMN,DATATYPE,NULL,CRISMAC SOURCE,CRISMAC TABLE,CRISMAC COLUMN,CRISMAC DATATYPE,MAP TYPE,REMARK,,',
  'FCT_COLLATERAL,5,PERIOD_ID,NUMBER,NOT NULL,Finacle,feed_a,DATE_OF_DATA,DATE,DERIVED,period from date,,',
  'FCT_COLLATERAL,6,AMT,"NUMBER(21,3)",,Finacle,stg_bills,AMOUNT,"NUMBER(10,2)",DIRECT,,,',
  'FCT_COLLATERAL,7,UNFED_COL,VARCHAR2(10),NOT NULL,,,,,NOT FED,,,',
  'STG_BILLS,4,SOURCE SYSTEM,SOURCE TABLE,SOURCE COLUMN,SOURCE DATATYPE,TARGET TABLE,TARGET COLUMN,TARGET DATATYPE,MAP TYPE,REMARK,,',
  'STG_BILLS,5,Finacle,feed_a,AMOUNT,"NUMBER(10,2)",STG_BILLS,AMOUNT,NUMBER,DIRECT,,,',
  'FPM_DA_RULES,4,RUN,TRAQ COLUMN,KIND,DATATYPE,RULE,IN FORCE FROM,CRISMAC,READS,LOGIC,EXPRESSION AS SAVED IN THE APP,VERSION',
  'FPM_DA_RULES,5,1,ASSET_NORM,Physical,String,Formula,05-Nov-2026,x,IS_LAD,ALWAYS_STD when IS_LAD = 1,expr,v1',
].join('\n');

const DOCS: DocInput[] = [
  { file: 'docs/X.md', content: '# X\n\n## Zebra protocol\nThe zebra protocol describes how stripes are processed during overnight loading of the data.' },
];

const model = parseWorkbookCsv(CSV);
const chunks = buildKnowledge(model, { docs: DOCS, platform: PLATFORM_GUIDE });
const index = buildIndex(chunks);
const suggestions = suggestedQuestions(model);

function ask(question: string, history: ChatTurn[] = [], route?: string) {
  const own = detectEntities(index, question);
  const entities = own.length ? own : inheritEntities(index, question, history);
  const query = own.length ? question : `${question} ${entities.join(' ')}`;
  const passages = isSmallTalk(question) ? [] : search(index, query, { entities, route, limit: 8 });
  const ctx = buildContext({ question, history, route }, { passages, entities, intent: isSmallTalk(question) ? 'smalltalk' : 'question' });
  return { ctx, answer: composeAnswer(ctx, suggestions) };
}

describe('knowledge base', () => {
  it('describes tables from the workbook and flags missing facts instead of inventing them', () => {
    const t = chunks.find((c) => c.id === 'table:FCT_COLLATERAL')!;
    expect(t.text).toContain('primary key');
    expect(t.text).toMatch(/PERIOD_ID, ID/);
    expect(t.text).toContain('Purpose: Not provided in workbook');
    const stg = chunks.find((c) => c.id === 'table:STG_BILLS')!;
    expect(stg.text).toContain('Primary key: Not provided in workbook');
  });

  it('gives every chunk at least one source reference or is a documented overview', () => {
    const noSource = chunks.filter((c) => c.sources.length === 0);
    expect(noSource).toEqual([]);
  });

  it('builds example questions from real object names', () => {
    expect(suggestions.length).toBeGreaterThan(3);
    expect(suggestions.some((q) => q.includes('FCT_COLLATERAL'))).toBe(true);
  });
});

describe('retrieval and answers', () => {
  it('finds the table chunk for a table question and cites it', () => {
    const { ctx, answer } = ask('What columns does FCT_COLLATERAL have?');
    expect(ctx.grounded).toBe(true);
    expect(ctx.passages.slice(0, 3).some((p) => p.chunk.id === 'table:FCT_COLLATERAL')).toBe(true);
    expect(answer.kind).toBe('grounded');
    expect(answer.sources.some((s) => s.label === 'FCT_COLLATERAL')).toBe(true);
  });

  it('resolves a qualified TABLE.COLUMN reference to that exact column', () => {
    const { ctx, answer } = ask('Where does FCT_COLLATERAL.AMT come from?');
    expect(ctx.passages[0].chunk.title).toBe('FCT_COLLATERAL.AMT');
    expect(answer.text).toContain('DIRECT');
  });

  it('does not guess when nothing relevant exists', () => {
    const { ctx, answer } = ask('What is the weather in Paris?');
    expect(ctx.grounded).toBe(false);
    expect(answer.kind).toBe('not-found');
    expect(answer.sources).toEqual([]);
    expect(answer.text).toContain("won't guess");
  });

  it('says out-of-scope tables are outside the migration scope', () => {
    const { answer } = ask('Tell me about FCT_NPA_PRODUCT');
    expect(answer.text).toContain('outside the migration scope');
  });

  it('carries the previous table into a pronoun follow-up', () => {
    const history: ChatTurn[] = [{ role: 'user', text: 'Tell me about FCT_COLLATERAL' }];
    expect(inheritEntities(index, 'what rules apply to it?', history)).toContain('FCT_COLLATERAL');
    const { ctx } = ask('what rules apply to it?', history);
    expect(ctx.entities).toContain('FCT_COLLATERAL');
    expect(ctx.passages.some((p) => p.chunk.kind === 'rule')).toBe(true);
  });

  it('answers app-usage questions from the platform guide', () => {
    const { ctx, answer } = ask('How do I approve a mapping?');
    expect(ctx.passages[0].chunk.kind).toBe('platform');
    expect(answer.sources.some((s) => s.route === '/mapping')).toBe(true);
  });

  it('retrieves project documentation and cites the heading', () => {
    const { answer } = ask('explain the zebra protocol');
    expect(answer.kind).toBe('grounded');
    expect(answer.sources.some((s) => s.kind === 'documentation' && s.label === 'docs/X.md > Zebra protocol')).toBe(true);
  });

  it('only restates retrieved text (grounding invariant)', () => {
    for (const q of ['What columns does FCT_COLLATERAL have?', 'Which procedures are referenced?', 'What gaps exist in the workbook?', 'Where does STG_BILLS get its data?']) {
      const { ctx, answer } = ask(q);
      if (ctx.grounded) for (const p of ctx.passages) expect(answer.text).toContain(p.chunk.text);
    }
  });

  it('treats greetings as small talk without citing sources', () => {
    expect(isSmallTalk('hello')).toBe(true);
    expect(isSmallTalk('hello, what columns does FCT_COLLATERAL have?')).toBe(false);
    const { answer } = ask('hi');
    expect(answer.kind).toBe('smalltalk');
    expect(answer.sources).toEqual([]);
  });
});
