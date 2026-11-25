import type { AiGatewayClient } from './aiGateway';
import type { MappingDecisionService } from './types';

/** Mapping decisions live in the gateway process's storage (always real HTTP; there is no browser-side mock to drift from it). */
export function createDecisionService(gateway: AiGatewayClient): MappingDecisionService {
  return {
    list: () => gateway.listDecisions(),
    save: (rec) => gateway.saveDecision(rec),
    remove: (id) => gateway.removeDecision(id),
  };
}
