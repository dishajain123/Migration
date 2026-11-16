import { Send } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '../ui';

const MAX_LEN = 500;

export function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('');
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
    <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
      <Button type="submit" size="icon" className="h-9 w-9" disabled={disabled || !text.trim()} aria-label="Send message"><Send size={15} /></Button>
    </form>
  );
}
