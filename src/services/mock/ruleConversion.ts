import { convertProcedures } from '@/domain/ruleConversion/convert';
import { migrateDdRows } from '@/domain/ruleConversion/ddMigrate';
import { buildMappingIndex } from '@/domain/ruleConversion/resolve';
import type { DdMigratedRule, DdMigrationResult } from '@/types';
import { analyzeSqlFile } from '@/domain/ruleConversion/intake';
import { TEMPLATES } from '@/domain/ruleConversion/templates';
import { getDdExport, getProcSourceFiles, getProcSources } from '../procSource';
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
  migrateDd: (req) => respond(async (): Promise<DdMigrationResult> => {
    const model = await getWorkbook();
    const index = buildMappingIndex(model, req.reviewed);
    const procs = await getProcSources();
    const rules: DdMigratedRule[] = [];
    const procedures: DdMigrationResult['procedures'] = [];
    for (const p of procs) {
      const dd = await getDdExport(p.name).catch(() => null);
      if (!dd || !dd.available) { procedures.push({ name: p.name, available: false, rules: 0, note: dd?.note ?? 'dd_export.csv could not be loaded.' }); continue; }
      const mine = migrateDdRows(model, p.name, dd.header, dd.rows, req.reviewed, index, req.settings);
      rules.push(...mine);
      procedures.push({ name: p.name, available: true, rules: mine.length, note: dd.file });
    }
    return { rules, procedures };
  }, { simulated: false, note: 'Rule text from the project dd_export.csv files; only names are replaced, using confirmed Agent 4 / workbook mappings. Not AI.' }),
};
