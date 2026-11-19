import { AlertTriangle, Bot, Check, Copy, Loader2, RefreshCw, ShieldAlert, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { extractCitedTags } from '@/domain/citations';
import { cn } from '@/lib/cn';
import type { ChatMessage, KnowledgeKind, SourceRef } from '@/types';
import { Badge, Button } from '../ui';
import { RichText } from './RichText';
import { SourceList } from './SourceList';
import { SpeakButton } from './SpeakButton';

interface Props {
  message: ChatMessage;
  onAsk: (q: string) => void;
  onRetry: () => void;
  onNavigate?: () => void;
  isLast: boolean;
  disabled: boolean;
}

const SETTINGS_CODES = new Set(['NOT_CONFIGURED', 'MISSING_KEY', 'INVALID_KEY', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'INCOMPATIBLE', 'MODEL_NOT_FOUND']);

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted" onClick={() => void copy()} aria-label="Copy response">
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function MessageBubble({ message, onAsk, onRetry, onNavigate, isLast, disabled }: Props) {
  const ai = message.ai;
  // Show the sources the answer actually cites ([S1] ...); if it cites none, show the top few retrieved.
  const shown: SourceRef[] = useMemo(() => {
    if (!ai) return [];
    const cited = new Set(extractCitedTags(message.text));
    const pool = cited.size ? ai.sources.filter((s) => cited.has(s.tag)) : ai.sources.slice(0, 3);
    return pool.map((s) => ({ kind: s.kind as KnowledgeKind, label: `${s.tag.slice(1)} · ${s.label}`, sheet: s.sheet, rowNo: s.rowNo, route: s.route }));
  }, [ai, message.text]);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-sm text-primaryfg">
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        </div>
        <User size={16} className="mt-1 shrink-0 text-muted" aria-hidden />
      </div>
    );
  }

  const legacy = message.answer;
  return (
    <div className="flex gap-2">
      <Bot size={16} className="mt-1 shrink-0 text-primary" aria-hidden />
      <div className={cn('min-w-0 max-w-[92%] rounded-lg rounded-tl-sm border px-3 py-2', message.isError ? 'border-bad bg-badbg text-bad' : 'border-border bg-surface')}>
        {message.isError ? (
          <div role="alert">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {message.errorCode === 'BLOCKED_INPUT' || message.errorCode === 'BLOCKED_OUTPUT' ? <ShieldAlert size={14} /> : <AlertTriangle size={14} />}
              {message.errorCode === 'RATE_LIMITED' ? 'Rate limit reached'
                : message.errorCode === 'BLOCKED_INPUT' ? 'Message blocked'
                  : message.errorCode === 'BLOCKED_OUTPUT' ? 'Answer withheld'
                    : 'The assistant could not answer'}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isLast && message.errorCode !== 'BLOCKED_INPUT' && <Button variant="outline" size="sm" onClick={onRetry} disabled={disabled}><RefreshCw size={12} /> Retry</Button>}
              {message.errorCode && SETTINGS_CODES.has(message.errorCode) && <Link to="/ai-settings" onClick={onNavigate} className="text-xs font-medium underline">Open AI Settings</Link>}
            </div>
          </div>
        ) : (
          <>
            {message.streaming && !message.text ? (
              <div className="flex items-center gap-2 text-xs text-muted" role="status"><Loader2 size={13} className="animate-spin" /> Searching project knowledge and thinking...</div>
            ) : (
              <RichText text={message.text} sources={ai?.sources} />
            )}
            {message.streaming && message.text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" aria-hidden />}
            {!message.streaming && (ai || legacy) && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {ai?.provider && <Badge tone="primary">AI · {ai.provider} · {ai.model}</Badge>}
                  {ai?.kind === 'grounded' && <Badge tone="ok">Grounded in project knowledge</Badge>}
                  {ai?.kind === 'not-found' && <Badge tone="warn">Not found - no guess made</Badge>}
                  {ai?.retrieval && <Badge>{ai.retrieval === 'hybrid' ? 'Hybrid search' : 'Keyword search'}</Badge>}
                  {ai?.warning === 'fabricated-citation' && <Badge tone="warn"><ShieldAlert size={10} className="mr-0.5 inline" /> Citation could not be verified</Badge>}
                  {ai?.warning === 'unverified-claim' && <Badge tone="warn"><ShieldAlert size={10} className="mr-0.5 inline" /> Some details are unverified</Badge>}
                  {legacy && <Badge tone="warn">Simulated answer</Badge>}
                </div>
                {ai?.note && <p className="mt-1 text-[11px] text-muted">{ai.note}</p>}
                <SourceList sources={ai ? shown : legacy?.sources ?? []} onNavigate={onNavigate} />
                <div className="mt-1.5 flex items-center gap-1">
                  <CopyButton text={message.text} />
                  <SpeakButton messageId={message.id} text={message.text} sources={ai?.sources} />
                  {isLast && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted" onClick={onRetry} disabled={disabled} aria-label="Regenerate answer"><RefreshCw size={12} /> Regenerate</Button>}
                </div>
                {isLast && legacy && legacy.followUps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {legacy.followUps.map((f) => (
                      <button key={f} type="button" disabled={disabled} onClick={() => onAsk(f)} className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-primary hover:bg-primarybg disabled:opacity-50">{f}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
