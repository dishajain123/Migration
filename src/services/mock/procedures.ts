import { analyzeSql, buildCatalogue, describeKind, documentedExpressions } from '@/domain/procedures';
import { traceAll } from '@/domain/procTrace';
import { getDdExport, getProcSources } from '../procSource';
import { getWorkbook } from '../workbookSource';
import type { ProcedureService } from '../types';
import { respond } from './respond';

const sourceNote = 'Verbatim from the sample SQL files beside the workbook; structure extracted with regular expressions, not AI.';

export const mockProcedures: ProcedureService = {
  listObjects: () => respond(async () => buildCatalogue(await getWorkbook()), {
    simulated: false, note: 'Objects are referenced by name in the workbook; SQL for the 14 sample procedures is on the Source procedures tab.',
  }),
  listExpressions: () => respond(async () => documentedExpressions(await getWorkbook()), { simulated: false, note: 'Verbatim expressions from remark cells' }),
  explain: (id) => respond(async () => {
    const o = buildCatalogue(await getWorkbook()).find((x) => x.id === id);
    if (!o) throw new Error('Object not found');
    const short = o.name.replace(/^PRO\./i, '').toLowerCase();
    const src = await getProcSources().then((l) => l.find((p) => p.name.toLowerCase() === short)).catch(() => undefined);
    const lines = [
      `${o.name}: ${describeKind(o.kind)}.`,
      `Referenced ${o.references.length} time(s) on: ${o.sheets.join(', ')}.`,
      o.operations.length ? `Operation keywords in surrounding text: ${o.operations.join(', ')}.` : 'No operation keywords (INSERT/UPDATE/MERGE/DELETE) appear in the surrounding text.',
      o.mentionedTables.length ? `Tables mentioned alongside it: ${o.mentionedTables.slice(0, 10).join(', ')}.` : 'No tables are named alongside it.',
      src
        ? `SQL body: provided as a sample file (${src.steps.length} statements, ${src.lineCount} lines). Open it on the Source procedures tab.`
        : 'SQL body: not provided in the workbook or the sample SQL files, so no logic beyond the above can be stated.',
    ];
    return { summary: lines };
  }, { simulated: true, note: 'Template-generated summary. No AI analysis was performed.' }),
  analyzeSql: (sql) => respond(async () => analyzeSql(await getWorkbook(), sql), { simulated: false, note: 'Client-side regex analysis, not AI' }),
  listSources: () => respond(() => getProcSources(), { simulated: false, note: sourceNote }),
  listTraces: () => respond(async () => traceAll(await getWorkbook(), await getProcSources()), {
    simulated: false, note: 'Derived: name matches against TRAQ columns and FPM_DA_RULES rows. Not a translation of the logic.',
  }),
  getDdExport: (name) => respond(() => getDdExport(name), { simulated: false, note: 'Data-dictionary export as saved in CSV' }),
};
