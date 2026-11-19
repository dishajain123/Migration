import { AlertTriangle, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAiStore } from '@/stores/aiStore';

/** Tells the user why AI-backed features cannot run yet, instead of letting them fail unexplained. */
export function AiStatusBanner() {
  const { overview, status, error, load } = useAiStore();
  const { pathname } = useLocation();
  useEffect(() => { if (status === 'idle') void load(); }, [status, load]);
  if (pathname === '/ai-settings' || status === 'idle' || status === 'loading') return null;
  if (status === 'error') {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-border bg-warnbg px-4 py-1.5 text-xs text-warn md:px-6">
        <AlertTriangle size={13} className="shrink-0" /> <span className="min-w-0">{error}</span>
      </div>
    );
  }
  if (overview?.active) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-warnbg px-4 py-1.5 text-xs text-warn md:px-6">
      <Sparkles size={13} className="shrink-0" />
      <span>No AI provider is configured, so AI-backed features are unavailable. <Link to="/ai-settings" className="font-medium underline">Open AI Settings</Link></span>
    </div>
  );
}
