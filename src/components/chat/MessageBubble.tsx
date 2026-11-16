import { AlertTriangle, Bot, RefreshCw, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ChatMessage } from '@/types';
import { Badge, Button, SimulatedBadge } from '../ui';
import { RichText } from './RichText';
import { SourceList } from './SourceList';

interface Props {
  message: ChatMessage;
  onAsk: (q: string) => void;
  onRetry: () => void;
  onNavigate?: () => void;
  isLast: boolean;
  disabled: boolean;
}

export function MessageBubble({ message, onAsk, onRetry, onNavigate, isLast, disabled }: Props) {
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
  const a = message.answer;
  return (
    <div className="flex gap-2">
      <Bot size={16} className="mt-1 shrink-0 text-primary" aria-hidden />
      <div className={cn('min-w-0 max-w-[92%] rounded-lg rounded-tl-sm border px-3 py-2', message.isError ? 'border-bad bg-badbg text-bad' : 'border-border bg-surface')}>
        {message.isError ? (
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium"><AlertTriangle size={14} /> The assistant could not answer</div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.text}</p>
            {isLast && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={disabled}><RefreshCw size={12} /> Retry</Button>}
          </div>
        ) : (
          <>
            <RichText text={message.text} />
            {a && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <SimulatedBadge label="Simulated answer" />
                  {a.kind === 'grounded' && <Badge tone="ok">Grounded in workbook / docs</Badge>}
                  {a.kind === 'not-found' && <Badge tone="warn">Not found - no guess made</Badge>}
                </div>
                <SourceList sources={a.sources} onNavigate={onNavigate} />
                {isLast && a.followUps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.followUps.map((f) => (
                      <button
                        key={f}
                        type="button"
                        disabled={disabled}
                        onClick={() => onAsk(f)}
                        className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-primary hover:bg-primarybg disabled:opacity-50"
                      >
                        {f}
                      </button>
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
