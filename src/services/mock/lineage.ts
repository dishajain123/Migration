import { buildLineage, edgeMappings, traceColumn } from '@/domain/lineage';
import { getWorkbook } from '../workbookSource';
import type { LineageService } from '../types';
import { respond } from './respond';

const NOTE = 'Edges are aggregated from documented mapping rows';

export const mockLineage: LineageService = {
  getGraph: (opts) => respond(async () => buildLineage(await getWorkbook(), opts), { simulated: false, note: NOTE }),
  getEdgeMappings: (s, t) => respond(async () => edgeMappings(await getWorkbook(), s, t), { simulated: false, note: NOTE }),
  traceColumn: (table, column, dir) => respond(async () => traceColumn(await getWorkbook(), table, column, dir), { simulated: false, note: NOTE }),
  listColumns: (table) => respond(async () => {
    const m = await getWorkbook();
    return (m.tables.find((t) => t.name === table)?.columns ?? []).map((c) => c.name);
  }, { simulated: false }),
};
