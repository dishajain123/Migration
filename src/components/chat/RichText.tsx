import { Fragment, type ReactNode } from 'react';
import type { ChatSource } from '@/types/ai';
import { CodeBlock } from './CodeBlock';

/*
 * Small, safe Markdown renderer for chat answers: headings, paragraphs, bullet/numbered lists, pipe tables, fenced code
 * (SQL highlighted), blockquotes, **bold**, *italic*, `code`, [links](https://...) and [S1] citation chips.
 * Output is built from React elements only, so no HTML is ever injected.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[S\d+\]|(?<![*\w])\*[^*\s][^*]*\*(?![*\w]))/g;

function inline(text: string, sources?: ChatSource[]): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold">{inline(part.slice(2, -2), sources)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded bg-surface2 px-1 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-primary underline">{link[1]}</a>;
    const cite = /^\[(S\d+)\]$/.exec(part);
    if (cite) {
      const src = sources?.find((s) => s.tag === cite[1]);
      return <sup key={i} title={src ? `${src.title} (${src.label})` : 'Source'} className="mx-0.5 rounded bg-primarybg px-1 text-[10px] font-medium text-primary">{cite[1].slice(1)}</sup>;
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSeparator = (l: string) => isTableRow(l) && cells(l).every((c) => /^:?-{2,}:?$/.test(c));

export function RichText({ text, sources }: { text: string; sources?: ChatSource[] }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  const key = () => `b${blocks.length}`;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence (a stream may still be mid-block: render what has arrived)
      blocks.push(<CodeBlock key={key()} code={code.join('\n')} lang={fence[1]} />);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={key()} className={h[1].length <= 2 ? 'mt-1 text-sm font-semibold' : 'mt-0.5 text-sm font-medium'}>{inline(h[2], sources)}</div>);
      i++; continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key()} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead><tr>{head.map((c, j) => <th key={j} className="border border-border bg-surface2 px-2 py-1 font-medium">{inline(c, sources)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-border px-2 py-1 align-top">{inline(c, sources)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(re.exec(lines[i++])![1]);
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={key()} className={ordered ? 'ml-5 list-decimal space-y-0.5' : 'ml-4 list-disc space-y-0.5'}>{items.map((b, j) => <li key={j}>{inline(b, sources)}</li>)}</Tag>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key()} className="border-l-2 border-border pl-2 text-muted">{inline(quote.join(' '), sources)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    if (para.length === 0) { para.push(lines[i++]); }
    blocks.push(<p key={key()}>{inline(para.join(' '), sources)}</p>);
  }
  return <div className="space-y-1.5 break-words text-sm leading-relaxed">{blocks}</div>;
}
