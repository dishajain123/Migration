import { config } from '@/config';
import { createHttpServices } from './http';
import { mockDashboard } from './mock/dashboard';
import { mockDataModel } from './mock/dataModel';
import { mockLineage } from './mock/lineage';
import { mockMapping } from './mock/mapping';
import { mockProcedures } from './mock/procedures';
import { mockRules } from './mock/rules';
import type { Services } from './types';

/** The single switch between the mock and real backend. UI code only ever imports `services`. */
export const services: Services = config.useMocks
  ? { dataModel: mockDataModel, lineage: mockLineage, procedures: mockProcedures, mapping: mockMapping, rules: mockRules, dashboard: mockDashboard }
  : createHttpServices();
