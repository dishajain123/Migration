import { composeAnswer, buildContext } from '@/domain/answer';
import { buildKnowledge, suggestedQuestions } from '@/domain/knowledge';
import { memo } from '@/domain/memo';
import { buildIndex, detectEntities, inheritEntities, isSmallTalk, search } from '@/domain/retrieval';
import { DOCS } from '@/data/docs';
import { PLATFORM_GUIDE } from '@/data/platformGuide';
import type { WorkbookModel } from '@/types';
import { traceAll } from '@/domain/procTrace';
import { getProcSources } from '../procSource';
import { getWorkbook } from '../workbookSource';
import type { ChatPipeline } from './pipeline';

const ROUTE_QUESTIONS: Record<string, string[]> = {
  '/': ['What does the readiness score mean?'],
  '/data-model': ['How do relationships work here?'],
  '/lineage': ['How do I trace a column?'],
  '/procedures': ['Why are there no SQL bodies?'],
  '/mapping': ['How do I review a mapping?', 'What does the confidence % mean?'],
  '/rules': ['How do I convert CrisMac SQL to TRAQ rules?', 'Which TRAQ rule format is exported?', 'What do the validation checks do?'],
};

/** Sample procedure SQL is optional knowledge: if it cannot be loaded the chatbot still answers from the workbook and docs. */
async function indexFor(model: WorkbookModel) {
  const procs = await getProcSources().catch(() => []);
  return memo(model, 'knowledgeIndex', () => buildIndex(buildKnowledge(model, { docs: DOCS, platform: PLATFORM_GUIDE, procs, traces: traceAll(model, procs) })));
}

/** Frontend-only pipeline: deterministic retrieval and template generation over workbook-derived data and docs. */
export const mockChatPipeline: ChatPipeline = {
  retriever: {
    async retrieve(req) {
      if (isSmallTalk(req.question)) return { passages: [], entities: [], intent: 'smalltalk' };
      const index = await indexFor(await getWorkbook());
      const own = detectEntities(index, req.question);
      const entities = own.length ? own : inheritEntities(index, req.question, req.history);
      const query = own.length ? req.question : `${req.question} ${entities.join(' ')}`;
      return { passages: search(index, query, { entities, route: req.route, limit: 8 }), entities, intent: 'question' };
    },
  },
  contextBuilder: { build: (req, retrieved) => buildContext(req, retrieved) },
  generator: {
    async generate(ctx) {
      const base = suggestedQuestions(await getWorkbook());
      return composeAnswer(ctx, base);
    },
  },
  suggestions: {
    async suggest(route) {
      const base = suggestedQuestions(await getWorkbook());
      const local = (route && ROUTE_QUESTIONS[route]) || [];
      return [...local, ...base].slice(0, 8);
    },
  },
};
