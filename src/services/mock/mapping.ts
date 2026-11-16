import { mappingIssues, suggestionsForTable, targetSummaries, unfedWithFlags } from '@/domain/suggest';
import { getWorkbook } from '../workbookSource';
import type { MappingService } from '../types';
import { respond } from './respond';

const SIM = 'Suggestions and confidence are a deterministic heuristic (name tokens + type family). Simulated - not AI output.';

export const mockMapping: MappingService = {
  listTargets: () => respond(async () => targetSummaries(await getWorkbook()), { simulated: true, note: SIM }),
  getDocumented: (table) => respond(async () => (await getWorkbook()).mappings.filter((m) => m.targetTable === table), { simulated: false, note: 'Documented mappings from the workbook' }),
  getSuggestions: (table) => respond(async () => suggestionsForTable(await getWorkbook(), table), { simulated: true, note: SIM }),
  getUnfed: (table) => respond(async () => unfedWithFlags(await getWorkbook(), table), { simulated: false, note: 'Columns with no feeding mapping in the workbook' }),
  getIssues: (table) => respond(async () => mappingIssues(await getWorkbook(), table), { simulated: false }),
  listAllTables: () => respond(async () => (await getWorkbook()).tables
    .filter((t) => t.columns.length > 0)
    .map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })) }))
    .sort((a, b) => a.name.localeCompare(b.name)), { simulated: false }),
  submitReview: (id, decision) => respond(() => ({ id, decision }), { simulated: true, note: 'Mock persistence: the decision is stored client-side only.' }),
};
