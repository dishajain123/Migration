import { Boxes, FileCode2, GitBranch, LayoutDashboard, Menu, Moon, Network, ShieldCheck, Sun, Table2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/stores/themeStore';
import { ErrorBoundary } from './ErrorBoundary';
import { Badge, Button } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/data-model', label: '1 · Data Model', icon: Table2 },
  { to: '/lineage', label: '2 · Data Flow & Lineage', icon: GitBranch },
  { to: '/procedures', label: '3 · Procedure Analyzer', icon: FileCode2 },
  { to: '/mapping', label: '4 · Mapping Engine', icon: Network },
  { to: '/rules', label: '5 · Rules & Validation', icon: ShieldCheck },
];

export function Layout() {
  const { theme, toggle } = useThemeStore();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <Boxes size={20} className="text-primary" />
            <div>
              <div className="text-sm font-semibold leading-tight">CrisMAC → TRAQ</div>
              <div className="text-[11px] text-muted">Migration Intelligence</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-auto p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm', isActive ? 'bg-primarybg font-medium text-primary' : 'text-muted hover:bg-surface2 hover:text-fg')}
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-[11px] text-muted">
          Frontend demo. Agent outputs are deterministic or labelled <span className="font-medium text-warn">Simulated</span>; no AI service is called.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2.5 md:px-6">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <Button variant="outline" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></Button>
            <Badge tone="info">Scope: up to FCT_PRODUCT_MASTER</Badge>
            <span className="hidden truncate lg:inline">Source of truth: CrisMac_to_TRAQ_Combined.csv</span>
          </div>
          <Button variant="outline" size="sm" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} {theme === 'dark' ? 'Light' : 'Dark'}
          </Button>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
