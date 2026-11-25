import { join } from 'node:path';
import { createApp } from './app';
import { ChatOrchestrator } from './chatbot/orchestrator';
import { loadMasterKey } from './crypto';
import { AiGateway } from './gateway';
import { KnowledgeBase } from './knowledge_base/knowledgeBase';
import { DecisionStore } from './mappingDecisions/decisionStore';
import { HybridRetriever } from './retrieval/hybrid';
import { VectorStore } from './retrieval/vectorStore';
import { SettingsStore } from './store';

// Local AI gateway + chatbot backend. Secrets are stored encrypted under server/.data (git-ignored).
// Provider keys may also come from environment variables (see .env.example); never commit real keys.
const dataDir = process.env.GATEWAY_DATA_DIR ?? join(process.cwd(), 'server', '.data');
const key = loadMasterKey(process.env.GATEWAY_MASTER_KEY, join(dataDir, 'master.key'));
const log = (line: string) => console.log(`[gateway] ${line}`);
const gateway = new AiGateway(new SettingsStore(join(dataDir, 'providers.json'), key), {
  timeoutMs: Number(process.env.GATEWAY_TIMEOUT_MS ?? 60_000),
  localTimeoutMs: Number(process.env.GATEWAY_LOCAL_TIMEOUT_MS ?? 30 * 60_000), log,
});
const kb = new KnowledgeBase(join(dataDir, 'knowledge.json'));
const vectors = new VectorStore(dataDir);
const chat = new ChatOrchestrator(gateway, kb, new HybridRetriever(kb, vectors), fetch, undefined, log);
const port = Number(process.env.GATEWAY_PORT ?? 8787);
// Loopback only: this demo has no real authentication.
const decisions = new DecisionStore(join(dataDir, 'mapping-decisions.json'));
createApp({ gateway, chat, kb, vectors, decisions, fetchImpl: fetch, log }).listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port}`));
