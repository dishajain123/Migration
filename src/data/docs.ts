import type { DocInput } from '@/types';
// Vite inlines these at build time (`?raw`). They are the project's own documentation, retrieved by the chatbot.
import readme from '../../README.md?raw';
import architecture from '../../docs/ARCHITECTURE.md?raw';
import agentDesign from '../../docs/AGENT_DESIGN.md?raw';
import dataDictionary from '../../docs/DATA_DICTIONARY.md?raw';
import apiContracts from '../../docs/API_CONTRACTS.md?raw';
import decisions from '../../docs/DECISIONS.md?raw';

export const DOCS: DocInput[] = [
  { file: 'README.md', content: readme },
  { file: 'docs/DATA_DICTIONARY.md', content: dataDictionary },
  { file: 'docs/ARCHITECTURE.md', content: architecture },
  { file: 'docs/AGENT_DESIGN.md', content: agentDesign },
  { file: 'docs/API_CONTRACTS.md', content: apiContracts },
  { file: 'docs/DECISIONS.md', content: decisions },
];
