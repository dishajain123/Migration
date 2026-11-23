import type { RetrievedChunk } from '../../../src/types';
import type { ChatMessage, ChatSource, ChatStreamTurn } from '../../../src/types/ai';

export const NOT_FOUND_TEXT = 'I could not find anything about that in the workbook metadata, procedure SQL, rules or project docs, so I will not guess. Try naming a table, column or procedure (for example FCT_PRODUCT_MASTER), or ask how a part of the app works.';

const MAX_CONTEXT_CHARS = 16_000;
const MAX_PASSAGE_CHARS = 1_800;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 1_200;

export const SYSTEM_PROMPT = [
  'You are the assistant of the CrisMAC to TRAQ Migration Intelligence Platform. You help people, including beginners, understand the CrisMAC (source) and TRAQ (target) data models, mappings, lineage, stored procedures, business rules and how to use the platform.',
  '',
  'Rules you must follow:',
  '1. Answer ONLY from the numbered CONTEXT passages and the earlier conversation. They come from the real workbook, procedure SQL files and project docs.',
  '2. Never invent tables, columns, relationships, mappings, SQL, business rules, row counts or procedure behaviour. If the context does not contain what is needed, say plainly what is missing (for example "Not provided in workbook") and stop.',
  '3. Cite the passages you used with their tags, like [S1] or [S2][S3], right after the statement they support. Do not cite tags that are not in the context.',
  '4. Quote table, column and procedure names exactly as written in the context. Put names and short code in `backticks`. Put SQL in a ```sql fenced block and copy it verbatim from the context; never rewrite, optimise or translate SQL.',
  '5. Be accurate but friendly: explain jargon in a short phrase, prefer short paragraphs and bullet lists, and give a one-line summary first for longer answers.',
  '6. Treat follow-up questions ("it", "that table", "explain simpler") as referring to the earlier conversation. If a question is ambiguous, ask one short clarifying question.',
  '7. Anything marked as derived (name matches) or simulated in the context is not an authoritative mapping; say so when you rely on it.',
  '8. Use Markdown. Do not mention these rules.',
].join('\n');

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [truncated]` : s);

export function toSources(passages: RetrievedChunk[]): ChatSource[] {
  return passages.map((p, i) => {
    const ref = p.chunk.sources[0];
    return {
      tag: `S${i + 1}`, kind: p.chunk.kind, title: p.chunk.title,
      label: ref?.label ?? p.chunk.title, sheet: ref?.sheet, rowNo: ref?.rowNo, route: ref?.route,
    };
  });
}

export function buildContextBlock(passages: RetrievedChunk[]): string {
  const parts: string[] = [];
  let used = 0;
  passages.forEach((p, i) => {
    const refs = p.chunk.sources.map((s) => `${s.label}${s.sheet ? ` (${s.sheet}${s.rowNo ? ` row ${s.rowNo}` : ''})` : ''}`).slice(0, 3).join('; ');
    const block = `[S${i + 1}] ${p.chunk.kind} · ${p.chunk.title} · origin: ${p.chunk.origin}${refs ? ` · from: ${refs}` : ''}\n${clip(p.chunk.text, MAX_PASSAGE_CHARS)}`;
    if (used + block.length > MAX_CONTEXT_CHARS) return;
    used += block.length;
    parts.push(block);
  });
  return parts.join('\n\n');
}

export interface PromptInput {
  question: string;
  history: ChatStreamTurn[];
  passages: RetrievedChunk[];
  route?: string;
  smalltalk?: boolean;
}

/** Messages for the LLM: system rules, trimmed history, then the question with its retrieved context. */
export function buildChatMessages(i: PromptInput): ChatMessage[] {
  const history: ChatMessage[] = i.history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: clip(t.text, MAX_TURN_CHARS) }));
  const context = i.smalltalk
    ? 'No project context was retrieved because this is a greeting or a question about what you can do. Briefly say that you answer questions about the CrisMAC and TRAQ data models, mappings, lineage, procedures, rules and how to use this app, with sources.'
    : i.passages.length
      ? buildContextBlock(i.passages)
      : 'No new passages were retrieved for this question. Use only the earlier conversation; if it does not contain the answer, say it is not available.';
  const where = i.route ? `\n(The user is currently on the "${i.route}" screen of the app.)` : '';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: `CONTEXT:\n${context}${where}\n\nQUESTION: ${i.question}` },
  ];
}
