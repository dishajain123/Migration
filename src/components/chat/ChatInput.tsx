import { Mic, Send, Square } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { Button } from '../ui';
import { RecordingIndicator } from './RecordingIndicator';

const MAX_LEN = 500;

export function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const onTranscript = (t: string) => setText((prev) => (prev ? `${prev.trim()} ${t}` : t).slice(0, MAX_LEN));
  const voice = useSpeechToText(onTranscript);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <div className="border-t border-border">
      {voice.status === 'recording' && (
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <RecordingIndicator seconds={voice.seconds} interim={voice.interim} />
          <Button type="button" variant="outline" size="sm" onClick={voice.stop} className="h-6 px-2 text-[11px]"><Square size={10} /> Stop</Button>
        </div>
      )}
      {voice.status === 'error' && voice.error && <p className="px-3 pt-2 text-[11px] text-bad" role="alert">{voice.error}</p>}
      <form className="flex items-end gap-2 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {voice.isSupported && (
          <Button
            type="button" size="icon" variant={voice.status === 'recording' ? 'default' : 'outline'} className="h-9 w-9 shrink-0"
            onClick={() => (voice.status === 'recording' ? voice.stop() : voice.start())}
            disabled={disabled}
            aria-label={voice.status === 'recording' ? 'Stop recording' : 'Ask by voice'}
            title={voice.status === 'recording' ? 'Stop recording' : 'Ask by voice'}
          >
            <Mic size={15} />
          </Button>
        )}
        <textarea
          autoFocus
          rows={1}
          value={text}
          maxLength={MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about tables, mappings, rules, or how to use this app..."
          aria-label="Message"
          className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={disabled || !text.trim()} aria-label="Send message"><Send size={15} /></Button>
      </form>
    </div>
  );
}
