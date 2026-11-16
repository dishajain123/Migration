import { Fragment, type ReactNode } from 'react';

/** Renders the tiny subset used by answers: paragraphs, "- " bullets, **bold** and `code`. No HTML is ever injected. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded bg-surface2 px-1 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(<ul key={`u${blocks.length}`} className="ml-4 list-disc space-y-0.5">{items.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) { bullets.push(line.slice(2)); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-1.5 break-words text-sm leading-relaxed">{blocks}</div>;
}
