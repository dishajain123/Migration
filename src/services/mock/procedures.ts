import { analyzeSql, buildCatalogue, describeKind, documentedExpressions } from '@/domain/procedures';
import { getWorkbook } from '../workbookSource';
import type { ProcedureService } from '../types';
import { respond } from './respond';

export const mockProcedures: ProcedureService = {
  listObjects: () => respond(async () => buildCatalogue(await getWorkbook()), {
    simulated: false, note: 'Objects are referenced by name in the workbook; no SQL bodies are provided.',
  }),
  listExpressions: () => respond(async () => documentedExpressions(await getWorkbook()), { simulated: false, note: 'Verbatim expressions from remark cells' }),
  explain: (id) => respond(async () => {
    const o = buildCatalogue(await getWorkbook()).find((x) => x.id === id);
    if (!o) throw new Error('Object not found');
    const lines = [
      `${o.name}: ${describeKind(o.kind)}.`,
      `Referenced ${o.references.length} time(s) on: ${o.sheets.join(', ')}.`,
      o.operations.length ? `Operation keywords in surrounding text: ${o.operations.join(', ')}.` : 'No operation keywords (INSERT/UPDATE/MERGE/DELETE) appear in the surrounding text.',
      o.mentionedTables.length ? `Tables mentioned alongside it: ${o.mentionedTables.slice(0, 10).join(', ')}.` : 'No tables are named alongside it.',
      'SQL body: not provided in the workbook, so no logic beyond the above can be stated.',
    ];
    return { summary: lines };
  }, { simulated: true, note: 'Template-generated summary. No AI analysis was performed.' }),
  analyzeSql: (sql) => respond(async () => analyzeSql(await getWorkbook(), sql), { simulated: false, note: 'Client-side regex analysis, not AI' }),
};
