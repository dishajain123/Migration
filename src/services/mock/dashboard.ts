import { buildDashboard } from '@/domain/dashboard';
import { getWorkbook } from '../workbookSource';
import type { DashboardService } from '../types';
import { respond } from './respond';

export const mockDashboard: DashboardService = {
  getSummary: () => respond(async () => buildDashboard(await getWorkbook()), {
    simulated: true, note: 'Counts are workbook-derived; suggestion counts use the Simulated mapping heuristic.',
  }),
};
