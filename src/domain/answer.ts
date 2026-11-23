import type { ChatAnswer, ChatContext, ChatRequest, RetrievalResult, SourceRef } from '@/types';
import { OUT_OF_SCOPE_TABLES } from './constants';
import { terms } from './retrieval';

/*
 * Context building and template response generation. Together they are the mock of "prompt assembly + LLM call":
 * the generator may only restate text that retrieval returned, so every sentence traces back to a source.
 */

const MAX_PASSAGES = 4;
const MAX_CHARS = 3200;
const MIN_COVERAGE = 0.5;

export function buildContext(req: ChatRequest, r: RetrievalResult): ChatContext {
  const outOfScope = OUT_OF_SCOPE_TABLES.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(req.question));
  const top = r.passages[0];
  const qTerms = Array.from(new Set(terms(req.question)));
  const matchedAny = new Set(r.passages.slice(0, MAX_PASSAGES).flatMap((p) => p.matchedOn.map((m) => m.toLowerCase())));
  const entityHit = !!top && r.entities.length > 0 && top.matchedOn.some((m) => r.entities.includes(m));
  const covered = qTerms.filter((t) => matchedAny.has(t)).length;
  const coverage = qTerms.length ? covered / qTerms.length : 0;
  const grounded = r.intent === 'question' && !!top && (entityHit || (top.score >= 2.5 && coverage >= MIN_COVERAGE));

  const passages: ChatContext['passages'] = [];
  let chars = 0;
  if (grounded) {
    for (const p of r.passages) {
      if (passages.length >= MAX_PASSAGES) break;
      if (p.score < top.score * 0.25 && passages.length > 0) break;
      if (chars + p.chunk.text.length > MAX_CHARS && passages.length > 0) break;
      passages.push(p);
      chars += p.chunk.text.length;
    }
  }
  return {
    question: req.question, history: req.history.slice(-6), route: req.route, intent: r.intent,
    entities: r.entities, outOfScope, passages: grounded ? passages : r.passages.slice(0, 3), grounded,
  };
}

function dedupeSources(refs: SourceRef[], cap: number): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const r of refs) {
    const k = `${r.kind}|${r.label}|${r.sheet ?? ''}|${r.rowNo ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= cap) break;
  }
  return out;
}

const CAPABILITIES = [
  'tables, columns, data types and primary keys',
  'data flow and lineage between tables',
  'CrisMac-to-TRAQ mappings and unmapped columns',
  'procedures, views and documented expressions (names only; SQL bodies are not in the workbook)',
  'business rules and validation checks',
  'known gaps in the workbook, and how to use this platform',
];

export function composeAnswer(ctx: ChatContext, suggestions: string[]): ChatAnswer {
  if (ctx.intent === 'smalltalk') {
    return {
      kind: 'smalltalk',
      text: ['Hello. I can explain the CrisMAC to TRAQ migration using only the workbook, the project docs and the platform guide.', 'Ask me about:', ...CAPABILITIES.map((c) => `- ${c}`)].join('\n'),
      sources: [], followUps: suggestions.slice(0, 3),
    };
  }
  if (!ctx.grounded) {
    const close = ctx.passages.slice(0, 3).map((p) => p.chunk.title);
    const lines = [
      ctx.outOfScope.length
        ? `${ctx.outOfScope.join(', ')} ${ctx.outOfScope.length > 1 ? 'are' : 'is'} outside the migration scope (downstream of FCT_PRODUCT_MASTER), so the workbook content loaded here does not cover ${ctx.outOfScope.length > 1 ? 'them' : 'it'}.`
        : "I couldn't find that in the workbook or the project documentation, so I won't guess.",
      'I can answer questions about:',
      ...CAPABILITIES.map((c) => `- ${c}`),
      ...(close.length && !ctx.outOfScope.length ? [`Closest topics I do have: ${close.join('; ')}.`] : []),
    ];
    return { kind: 'not-found', text: lines.join('\n'), sources: [], followUps: suggestions.slice(0, 3) };
  }

  const names = ctx.entities.slice(0, 3).join(', ');
  const entityHit = ctx.entities.length > 0 && ctx.passages[0].matchedOn.some((m) => ctx.entities.includes(m));
  const lines: string[] = [];
  if (ctx.outOfScope.length) lines.push(`Note: ${ctx.outOfScope.join(', ')} ${ctx.outOfScope.length > 1 ? 'are' : 'is'} outside the migration scope (downstream of FCT_PRODUCT_MASTER).`, '');
  lines.push(names && entityHit ? `Here is what the workbook and docs say about **${names}**:` : 'Here is what I found in the workbook and docs:', '');
  if (!entityHit) {
    const matched = new Set(ctx.passages.flatMap((p) => p.matchedOn.map((m) => m.toLowerCase())));
    const missing = Array.from(new Set(terms(ctx.question))).filter((t) => t.length >= 4 && !matched.has(t)).slice(0, 3);
    if (missing.length) lines.splice(lines.length - 1, 0, `Nothing I have mentions: ${missing.join(', ')}. The closest material is below.`);
  }
  ctx.passages.forEach((p, i) => {
    if (i > 0) lines.push('');
    const body = p.chunk.kind === 'documentation' ? `From ${p.chunk.title}:\n${p.chunk.text}` : p.chunk.text;
    lines.push(body);
  });

  const tableTitle = ctx.passages.find((p) => p.chunk.kind === 'table')?.chunk.title
    ?? ctx.entities.map((e) => ctx.passages.find((p) => p.chunk.kind === 'lineage' && p.chunk.entities.some((x) => x.toUpperCase() === e))?.chunk.entities[0]).find(Boolean);
  const followUps = tableTitle
    ? [`Where does ${tableTitle} get its data?`, `What business rules apply to ${tableTitle}?`, `What columns does ${tableTitle} have?`]
    : suggestions;
  return {
    kind: 'grounded',
    text: lines.join('\n'),
    sources: dedupeSources(ctx.passages.flatMap((p) => p.chunk.sources.slice(0, 2)), 8),
    followUps: followUps.filter((f) => f.toLowerCase() !== ctx.question.trim().toLowerCase()).slice(0, 3),
  };
}
