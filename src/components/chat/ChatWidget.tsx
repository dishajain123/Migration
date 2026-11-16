import { MessageCircle, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useChatStore } from '@/stores/chatStore';
import { ChatPanel } from './ChatPanel';

/** Floating launcher plus panel. Mounted once in Layout so it persists across every screen. */
export function ChatWidget() {
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);
  const { pathname } = useLocation();
  return (
    <>
      {open && <ChatPanel route={pathname} onClose={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close assistant' : 'Open migration guide assistant'}
        aria-expanded={open}
        title={open ? 'Close assistant' : 'Ask the migration guide'}
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primaryfg shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}
