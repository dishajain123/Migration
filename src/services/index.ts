import { config } from '@/config';
import { aiGateway } from './aiGateway';
import { createAgentAi } from './ai/agentAi';
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

const agents: Omit<Services, 'ai' | 'assistant'> = config.useMocks
  ? {
    chat: mockChat, dataModel: mockDataModel, lineage: mockLineage, procedures: mockProcedures, mapping: mockMapping, rules: mockRules,
    ruleConversion: mockRuleConversion, dashboard: mockDashboard,
  }
  : createHttpServices();

/**
 * The single switch between the mock and real backend. UI code only ever imports `services`.
 * `ai` is always the AI gateway (keys are server-side), fed with context from the agent services above.
 */
export const services: Services = { ...agents, ai: createAgentAi(agents, aiGateway), assistant: createAssistant(aiGateway, agents.chat) };
