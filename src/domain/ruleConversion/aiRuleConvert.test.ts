import { describe, expect, it } from 'vitest';
import { expressionProblem, type AiRuleInput } from './aiRuleConvert';

const pool: AiRuleInput['pool'] = new Map([
  ['FCT_X.DPD', { table: 'FCT_X', column: 'DPD', type: 'NUMBER' }],
  ['FCT_X.LAST_DATE', { table: 'FCT_X', column: 'LAST_DATE', type: 'DATE' }],
]);

describe('AI rule expression validator', () => {
  it('accepts an expression built from in-scope columns and documented functions', () => {
    expect(expressionProblem('IF(ISNOTEMPTY("FCT_X"."LAST_DATE"))THEN(DATEDIFF("FCT_X"."var"."BUSINESS_DATE","FCT_X"."LAST_DATE","d"))ELSE(0)', pool)).toBeNull();
  });
  it('rejects invented columns, unknown functions, placeholders, @variables and unbalanced brackets', () => {
    expect(expressionProblem('"FCT_X"."INVENTED"', pool)).toMatch(/not an in-scope/);
    expect(expressionProblem('MAGIC("FCT_X"."DPD")', pool)).toMatch(/not a documented/);
    expect(expressionProblem('[[UNMAPPED A.B]]', pool)).toMatch(/placeholders/);
    expect(expressionProblem('IF(@TIMEKEY > 1)THEN(1)ELSE(0)', pool)).toMatch(/@variable/);
    expect(expressionProblem('IF("FCT_X"."DPD" > 1', pool)).toMatch(/Unbalanced/);
    expect(expressionProblem('  ', pool)).toMatch(/Empty/);
  });
});
