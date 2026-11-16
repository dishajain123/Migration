import { Boxes, ChevronsLeft, ChevronsRight, FileCode2, GitBranch, LayoutDashboard, Menu, Moon, Network, ShieldCheck, Sun, Table2, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePointerDrag } from '@/hooks/usePointerDrag';
import { cn } from '@/lib/cn';
import { SIDEBAR, useLayoutStore } from '@/stores/layoutStore';
import { useThemeStore } from '@/stores/themeStore';
import { ChatWidget } from './chat/ChatWidget';
import { ErrorBoundary } from './ErrorBoundary';
import { Tooltip } from './Tooltip';
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
  const [open, setOpen] = useState(false); // mobile drawer
  const { sidebarCollapsed: collapsed, sidebarWidth, toggleSidebar, setSidebarCollapsed, setSidebarWidth } = useLayoutStore();
  const asideRef = useRef<HTMLElement>(null);
  const originLeft = useRef(0);
  useEffect(() => { setOpen(false); }, [pathname]);

  // Drag-to-resize. Dragging below the snap width collapses to icons; dragging back out re-expands.
  const { dragging, handleProps } = usePointerDrag({
    cursor: 'col-resize',
    onStart: () => { originLeft.current = asideRef.current?.getBoundingClientRect().left ?? 0; },
    onMove: (e) => {
      const w = e.clientX - originLeft.current;
      if (w < SIDEBAR.snapBelow) { setSidebarCollapsed(true); return; }
      setSidebarCollapsed(false);
      setSidebarWidth(w);
    },
  });

  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (collapsed) return; if (sidebarWidth - 16 < SIDEBAR.min) setSidebarCollapsed(true); else setSidebarWidth(sidebarWidth - 16); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (collapsed) setSidebarCollapsed(false); else setSidebarWidth(sidebarWidth + 16); }
    else if (e.key === 'Enter') { e.preventDefault(); toggleSidebar(); }
  };

  const width = collapsed ? SIDEBAR.collapsed : sidebarWidth;
  const style = { '--sb-w': `${width}px` } as CSSProperties;

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        ref={asideRef}
        style={style}
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-border bg-surface transition-[width,transform] duration-200 ease-out md:relative md:w-[var(--sb-w)] md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          dragging && 'transition-none',
        )}
      >
        <div className={cn('flex items-center justify-between gap-2 border-b border-border px-4 py-4', collapsed && 'md:flex-col md:justify-center md:px-2')}>
          <div className="flex min-w-0 items-center gap-2">
            <Boxes size={20} className="shrink-0 text-primary" />
            <div className={cn('min-w-0', collapsed && 'md:hidden')}>
              <div className="truncate text-sm font-semibold leading-tight">CrisMAC → TRAQ</div>
              <div className="truncate text-[11px] text-muted">Migration Intelligence</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={16} /></Button>
          <Button
            variant="ghost" size="icon" className="hidden shrink-0 md:inline-flex"
            onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </Button>
        </div>
        <nav className={cn('flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2', collapsed && 'md:overflow-visible')} aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <Tooltip key={to} label={label} enabled={collapsed}>
              <NavLink
                to={to}
                end={end}
                aria-label={label}
                className={({ isActive }) => cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  collapsed && 'md:justify-center md:px-0',
                  isActive ? 'bg-primarybg font-medium text-primary' : 'text-muted hover:bg-surface2 hover:text-fg',
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className={cn('min-w-0 truncate', collapsed && 'md:hidden')}>{label}</span>
              </NavLink>
            </Tooltip>
          ))}
        </nav>
        <div className={cn('border-t border-border p-3 text-[11px] text-muted', collapsed && 'md:hidden')}>
          Frontend demo. Agent outputs are deterministic or labelled <span className="font-medium text-warn">Simulated</span>; no AI service is called.
        </div>
        {/* Resize handle: a thin strip over the right border. Separate element so it never competes with nav clicks. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR.collapsed}
          aria-valuemax={SIDEBAR.max}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize. Double-click to collapse or expand."
          onDoubleClick={toggleSidebar}
          onKeyDown={onHandleKey}
          {...handleProps}
          className={cn(
            'absolute -right-1 top-0 z-40 hidden h-full w-2 cursor-col-resize touch-none md:block',
            'after:absolute after:left-1/2 after:top-0 after:h-full after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-primary focus-visible:after:bg-primary',
            dragging && 'after:bg-primary',
          )}
        />
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
      <ChatWidget />
    </div>
  );
}
