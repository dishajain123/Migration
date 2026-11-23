import { applyReviewed } from '@/domain/mappingEngine';
import { mappingIssues, suggestionsForTable, tableAnalysis, targetSummaries, unfedWithFlags } from '@/domain/suggest';
import type { ProcSource } from '@/types';
import { getProcSources } from '../procSource';
import { getWorkbook } from '../workbookSource';
import type { MappingService } from '../types';
import { respond } from './respond';

const SIM = 'Suggestions and confidence are a deterministic heuristic (name tokens + type family + workbook/procedure evidence). Simulated - not AI output.';

/** Sample procedure SQL is optional context; if it cannot be loaded the engine still runs and reports procedureSqlLoaded=false. */
const optionalProcs = (): Promise<ProcSource[]> => getProcSources().catch(() => []);

export const mockMapping: MappingService = {
  listTargets: () => respond(async () => targetSummaries(await getWorkbook()), { simulated: true, note: SIM }),
  getDocumented: (table) => respond(async () => (await getWorkbook()).mappings.filter((m) => m.targetTable === table), { simulated: false, note: 'Documented mappings from the workbook' }),
  getSuggestions: (table) => respond(async () => suggestionsForTable(await getWorkbook(), table, await optionalProcs()), { simulated: true, note: SIM }),
  getUnfed: (table) => respond(async () => unfedWithFlags(await getWorkbook(), table, await optionalProcs()), { simulated: false, note: 'Columns with no feeding mapping in the workbook' }),
  getAnalysis: (table, reviewed) => respond(async () => {
    const a = tableAnalysis(await getWorkbook(), table, await optionalProcs());
    if (!a) throw new Error(`Table ${table} not found in the workbook.`);
    return applyReviewed(a, reviewed ?? []);
  }, { simulated: true, note: SIM }),
  getIssues: (table) => respond(async () => mappingIssues(await getWorkbook(), table), { simulated: false }),
  listAllTables: () => respond(async () => (await getWorkbook()).tables
    .filter((t) => t.columns.length > 0)
    .map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })) }))
    .sort((a, b) => a.name.localeCompare(b.name)), { simulated: false }),
  submitReview: (id, decision) => respond(() => ({ id, decision }), { simulated: true, note: 'Mock persistence: the decision is stored client-side only.' }),
};
