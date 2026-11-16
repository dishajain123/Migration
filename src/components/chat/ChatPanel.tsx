import { Bot, Loader2, Maximize2, Minimize2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { cn } from '@/lib/cn';
import { CHAT_PANEL, useLayoutStore } from '@/stores/layoutStore';
import { useChatStore } from '@/stores/chatStore';
import { Button, SimulatedBadge } from '../ui';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { SuggestedQuestions } from './SuggestedQuestions';

type Edge = 'corner' | 'left' | 'top';

/** One resize handle. The panel is anchored bottom-right, so growing means dragging up and/or left. */
function ResizeHandle({ edge }: { edge: Edge }) {
  const { chatW, chatH, setChatSize } = useLayoutStore();
  const start = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const { handleProps } = usePointerDrag({
    cursor: edge === 'corner' ? 'nwse-resize' : edge === 'left' ? 'ew-resize' : 'ns-resize',
    onStart: (e) => { start.current = { x: e.clientX, y: e.clientY, w: chatW, h: chatH }; },
    onMove: (e) => {
      const s = start.current;
      const maxW = Math.min(CHAT_PANEL.maxW, window.innerWidth - 32);
      const maxH = window.innerHeight - 104;
      const w = edge === 'top' ? s.w : s.w + (s.x - e.clientX);
      const h = edge === 'left' ? s.h : s.h + (s.y - e.clientY);
      setChatSize(Math.min(w, maxW), Math.min(h, maxH));
    },
  });
  const pos = { corner: '-left-1 -top-1 h-4 w-4 cursor-nwse-resize', left: '-left-1 top-4 h-[calc(100%-1rem)] w-2 cursor-ew-resize', top: '-top-1 left-4 h-2 w-[calc(100%-1rem)] cursor-ns-resize' }[edge];
  return (
    <div
      aria-hidden
      {...handleProps}
      className={cn('absolute z-10 hidden touch-none sm:block', pos, edge === 'corner' && 'rounded-tl-lg hover:bg-primarybg')}
    />
  );
}

export function ChatPanel({ route, onClose }: { route: string; onClose: () => void }) {
  const { messages, pending, send, retry, clear } = useChatStore();
  const { chatW, chatH, setChatSize } = useLayoutStore();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, pending]);

  const large = chatW >= 700;
  const toggleSize = () => {
    if (large) setChatSize(CHAT_PANEL.initialW, CHAT_PANEL.initialH);
    else setChatSize(Math.min(CHAT_PANEL.maxW, window.innerWidth - 32), window.innerHeight - 120);
  };
  const style = { '--chat-w': `${chatW}px`, '--chat-h': `${chatH}px` } as CSSProperties;
  const ask = (q: string) => { void send(q, route); };
  const lastIdx = messages.length - 1;

  return (
    <section
      role="dialog"
      aria-label="Migration guide assistant"
      style={style}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed inset-x-2 bottom-20 top-16 z-40 flex flex-col rounded-lg border border-border bg-bg shadow-xl sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[var(--chat-h)] sm:w-[var(--chat-w)] sm:max-h-[calc(100vh-6.5rem)] sm:max-w-[calc(100vw-2rem)]"
    >
      <ResizeHandle edge="left" />
      <ResizeHandle edge="top" />
      <ResizeHandle edge="corner" />

      <header className="flex items-center justify-between gap-2 rounded-t-lg border-b border-border bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot size={18} className="shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">Migration guide</div>
            <div className="truncate text-[11px] text-muted">CrisMAC → TRAQ questions, answered from the workbook and docs</div>
          </div>
          <SimulatedBadge />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={toggleSize} aria-label={large ? 'Restore panel size' : 'Maximise panel'} title={large ? 'Restore size' : 'Maximise'}>
            {large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={clear} disabled={messages.length === 0 || pending} aria-label="Clear conversation" title="Clear conversation"><Trash2 size={14} /></Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close assistant" title="Close (Esc)"><X size={16} /></Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-3 text-sm">
              <p className="font-medium">New to CrisMAC or TRAQ? Ask me anything about this migration.</p>
              <p className="mt-1 text-xs text-muted">
                Answers are assembled only from the workbook-derived metadata and the project docs, with sources listed. If something is not in them, I will say so instead of guessing.
              </p>
            </div>
            <div className="text-xs font-medium text-muted">Try asking</div>
            <SuggestedQuestions route={route} onAsk={ask} disabled={pending} />
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble key={m.id} message={m} isLast={i === lastIdx} disabled={pending} onAsk={ask} onRetry={() => { void retry(route); }} onNavigate={() => { if (window.innerWidth < 640) onClose(); }} />
          ))
        )}
        {pending && (
          <div className="flex items-center gap-2 text-xs text-muted" role="status">
            <Loader2 size={14} className="animate-spin" /> Searching the workbook and docs...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <ChatInput onSend={ask} disabled={pending} />
      <div className="rounded-b-lg border-t border-border bg-surface px-3 py-1.5 text-[10px] text-muted">
        Simulated: retrieval and template answers, no AI model. History is kept for this browser tab only.
      </div>
    </section>
  );
}
