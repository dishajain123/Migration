import { convertProcedures } from '@/domain/ruleConversion/convert';
import { analyzeSqlFile } from '@/domain/ruleConversion/intake';
import { TEMPLATES } from '@/domain/ruleConversion/templates';
import { getProcSourceFiles } from '../procSource';
import { getWorkbook } from '../workbookSource';
import type { RuleConversionService } from '../types';
import { respond } from './respond';

const NOTE = 'Rule-based conversion in the browser: SQL parsed by pattern matching, mappings from Agent 4 and the workbook. Not AI.';

export const mockRuleConversion: RuleConversionService = {
  analyzeFiles: (files) => respond(() => files.map((f) => ({ ...analyzeSqlFile(f), content: f.content })), { simulated: false, note: NOTE }),
  loadSamples: () => respond(async () => {
    const files = await getProcSourceFiles();
    return files.map((f) => ({ ...analyzeSqlFile({ fileName: f.info.file, size: f.sql.length, content: f.sql }, f.info.folder), content: f.sql }));
  }, { simulated: false, note: 'The 14 sample CrisMac procedures shipped beside the workbook.' }),
  listTemplates: () => respond(() => TEMPLATES, { simulated: false, note: 'Templates copied from dd_export.csv and the FPM_DA_RULES sheet.' }),
  convert: (req) => respond(async () => convertProcedures(await getWorkbook(), req), { simulated: false, note: NOTE }),
};
