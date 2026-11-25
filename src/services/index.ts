import { config } from '@/config';
import { aiGateway } from './aiGateway';
import { createAgentAi } from './ai/agentAi';
import { createMappingJobs } from './ai/mappingJobs';
import { createDecisionService } from './decisions';
import { createAssistant } from './chat/assistant';
import { createHttpServices } from './http';
import { mockChat } from './mock/chat';
import { mockDashboard } from './mock/dashboard';
import { mockDataModel } from './mock/dataModel';
import { mockLineage } from './mock/lineage';
import { mockMapping } from './mock/mapping';
import { mockProcedures } from './mock/procedures';
import { mockRuleConversion } from './mock/ruleConversion';
import { mockRules } from './mock/rules';
import type { Services } from './types';

type Agents = Omit<Services, 'ai' | 'assistant' | 'decisions' | 'jobs'>;

const agents: Agents = config.useMocks
  ? {
    chat: mockChat, dataModel: mockDataModel, lineage: mockLineage, procedures: mockProcedures, mapping: mockMapping, rules: mockRules,
    ruleConversion: mockRuleConversion, dashboard: mockDashboard,
  }
  : createHttpServices();

/**
 * The single switch between the mock and real backend. UI code only ever imports `services`.
 * `ai` is always the AI gateway (keys are server-side), fed with context from the agent services above.
 */
const decisions = createDecisionService(aiGateway);

export const services: Services = {
  ...agents,
  decisions,
  ai: createAgentAi(agents, aiGateway, decisions),
  jobs: createMappingJobs(agents, aiGateway, decisions),
  assistant: createAssistant(aiGateway, agents.chat),
};
