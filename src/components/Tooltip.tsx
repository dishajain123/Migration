import type { ReactNode } from 'react';

/** CSS-only hover/focus tooltip placed to the right of its child. Used for the collapsed sidebar icons. */
export function Tooltip({ label, enabled, children }: { label: string; enabled: boolean; children: ReactNode }) {
  return (
    <div className="group relative">
      {children}
      {enabled && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-fg opacity-0 shadow-md transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 md:block"
        >
          {label}
        </span>
      )}
    </div>
  );
}
