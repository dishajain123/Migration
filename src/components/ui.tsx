import MuiAlert from '@mui/material/Alert';
import MuiButton from '@mui/material/Button';
import MuiChip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import MuiTab from '@mui/material/Tab';
import MuiTabs from '@mui/material/Tabs';
import NativeSelect from '@mui/material/NativeSelect';
import OutlinedInput from '@mui/material/OutlinedInput';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, Inbox, RefreshCw } from 'lucide-react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { InfoTip } from '@/components/InfoTip';
import type { AsyncState } from '@/hooks/useAsync';
import type { ApiMeta } from '@/types';

/*
 * Shared primitives, built on MUI (styling/behaviour) and Motion (entrances, stagger, count-up).
 * Colours come from the CSS variables in index.css, so light/dark theming is unchanged. Exports and props are the same as
 * the earlier hand-written versions, so no screen needs editing. All Motion animation honours reduced-motion (MuiProvider).
 */

const EASE = [0.22, 1, 0.36, 1] as const;

// ---- button ----
export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'icon';

const variantSx = {
  default: { bgcolor: 'var(--primary)', color: 'var(--primaryfg)', '&:hover': { bgcolor: 'var(--primary)', opacity: 0.9 } },
  outline: { border: '1px solid var(--border)', bgcolor: 'var(--surface)', color: 'var(--fg)', '&:hover': { bgcolor: 'var(--surface2)' } },
  ghost: { color: 'inherit', '&:hover': { bgcolor: 'var(--surface2)' } },
  danger: { bgcolor: 'var(--bad)', color: '#ffffff', '&:hover': { bgcolor: 'var(--bad)', opacity: 0.9 } },
  success: { bgcolor: 'var(--ok)', color: 'var(--bg)', '&:hover': { bgcolor: 'var(--ok)', opacity: 0.9 } },
} as const;
const sizeSx = {
  sm: { height: 32, px: '12px' },
  md: { height: 36, px: '16px' },
  icon: { height: 32, width: 32, minWidth: 0, p: 0 },
} as const;

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & { variant?: ButtonVariant; size?: ButtonSize };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'md', ...p }, ref) {
  return (
    <MuiButton
      ref={ref}
      disableElevation
      sx={{
        gap: '6px', borderRadius: '6px', fontSize: 14, fontWeight: 500, lineHeight: 1.25, whiteSpace: 'nowrap',
        transition: 'transform 140ms ease, background-color 140ms ease, opacity 140ms ease, box-shadow 140ms ease',
        '&:hover': { transform: 'translateY(-1px)' },
        '&:active': { transform: 'translateY(0) scale(0.96)' },
        '&.Mui-disabled': { opacity: 0.5, pointerEvents: 'none', color: 'inherit' },
        '&:focus-visible': { outline: '2px solid var(--primary)', outlineOffset: 1 },
        ...variantSx[variant],
        ...sizeSx[size],
      }}
      {...p}
    />
  );
});

// ---- card ----
const MotionPaper = motion.create(Paper);

/** Fades and rises into place when it first appears. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <MotionPaper
      variant="outlined"
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      sx={{ bgcolor: 'var(--surface)', color: 'inherit', borderColor: 'var(--border)', borderRadius: '8px', backgroundImage: 'none', transition: 'box-shadow 200ms ease, border-color 200ms ease' }}
    >
      {children}
    </MotionPaper>
  );
}
export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
      <div className="min-w-[12rem] flex-1">
        <div className="text-sm font-semibold [overflow-wrap:break-word]">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-muted" title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</div>}
      </div>
      {right && <div className="min-w-0 max-w-full">{right}</div>}
    </div>
  );
}

// ---- badge ----
const badgeTone = {
  neutral: { bg: 'var(--surface2)', fg: 'var(--muted)' }, ok: { bg: 'var(--okbg)', fg: 'var(--ok)' }, warn: { bg: 'var(--warnbg)', fg: 'var(--warn)' },
  bad: { bg: 'var(--badbg)', fg: 'var(--bad)' }, info: { bg: 'var(--infobg)', fg: 'var(--info)' }, primary: { bg: 'var(--primarybg)', fg: 'var(--primary)' },
} as const;
export type Tone = keyof typeof badgeTone;

const MotionChip = motion.create(MuiChip);
function chipSx(tone: Tone) {
  return { height: 'auto', borderRadius: '4px', bgcolor: badgeTone[tone].bg, color: badgeTone[tone].fg, fontSize: 11, fontWeight: 500, '& .MuiChip-label': { px: '6px', py: '2px', lineHeight: 1.45 } } as const;
}
/** Pops in. */
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <MotionChip
      size="small" label={children} className={className} sx={chipSx(tone)}
      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}
    />
  );
}

// ---- form controls ----
export function Input({ className, value, defaultValue, onChange, disabled, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <OutlinedInput
      size="small"
      className={className}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      inputProps={rest}
      sx={{
        height: 36, fontSize: 14, bgcolor: 'var(--surface)', borderRadius: '6px',
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)', transition: 'border-color 160ms ease' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--muted)' },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--primary)', borderWidth: 2 },
        '& input': { py: 0, px: '12px', height: '100%', boxSizing: 'border-box' },
      }}
    />
  );
}
export function Select({ className, children, value, onChange, disabled, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <NativeSelect
      className={className}
      value={value}
      onChange={onChange}
      disabled={disabled}
      inputProps={rest}
      input={<OutlinedInput size="small" />}
      sx={{
        height: 36, fontSize: 14, bgcolor: 'var(--surface)', borderRadius: '6px',
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)', transition: 'border-color 160ms ease' },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--muted)' },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--primary)', borderWidth: 2 },
        '& select': { py: 0, pl: '8px', height: '100%', display: 'flex', alignItems: 'center' },
      }}
    >
      {children}
    </NativeSelect>
  );
}

// ---- tabs ----
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <MuiTabs
      value={value}
      onChange={(_e, v: T) => onChange(v)}
      sx={{ minHeight: 40, borderBottom: '1px solid var(--border)', '& .MuiTabs-flexContainer': { flexWrap: 'wrap' }, '& .MuiTabs-indicator': { bgcolor: 'var(--primary)', height: 2, borderRadius: 1 } }}
    >
      {tabs.map((t) => (
        <MuiTab
          key={t.id}
          value={t.id}
          label={t.label}
          disableRipple={false}
          sx={{ minHeight: 40, px: '12px', py: '8px', fontSize: 14, fontWeight: 500, color: 'var(--muted)', transition: 'color 160ms ease', '&:hover': { color: 'var(--fg)' }, '&.Mui-selected': { color: 'var(--primary)' } }}
        />
      ))}
    </MuiTabs>
  );
}

// ---- progress and stats ----
export function Progress({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'ok' | 'warn' | 'bad' }) {
  return (
    <LinearProgress
      variant="determinate"
      value={Math.max(0, Math.min(100, value))}
      sx={{ height: 8, borderRadius: '4px', bgcolor: 'var(--surface2)', '& .MuiLinearProgress-bar': { bgcolor: `var(--${tone})`, borderRadius: '4px', transition: 'transform 700ms cubic-bezier(0.22, 1, 0.36, 1)' } }}
    />
  );
}

/** Counts up to a whole number; anything else is shown as given. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !Number.isInteger(to) || Math.abs(to) > 1e9) return;
    const controls = animate(0, to, { duration: 0.8, ease: 'easeOut', onUpdate: (v) => { if (ref.current) ref.current.textContent = String(Math.round(v)); } });
    return () => controls.stop();
  }, [to, reduce]);
  return <span ref={ref}>{to}</span>;
}

export function Stat({ label, value, hint, tag }: { label: string; value: ReactNode; hint?: ReactNode; tag?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{tag}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{typeof value === 'number' ? <CountUp to={value} /> : value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

// ---- labelling ----
export function SimulatedBadge({ label = 'Simulated' }: { label?: string }) {
  return (
    <span title="Simulated output - not produced by an AI model" className="inline-flex items-center gap-1 rounded bg-warnbg px-1.5 py-0.5 text-[11px] font-medium text-warn">
      <FlaskConical size={11} /> {label}
    </span>
  );
}
export function OriginBadge({ meta }: { meta: ApiMeta | null }) {
  if (!meta) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" title={meta.note}>
      {meta.simulated ? <SimulatedBadge /> : <Badge tone="ok">Workbook-derived</Badge>}
      {meta.note && <span className="hidden max-w-[28rem] truncate md:inline">{meta.note}</span>}
    </span>
  );
}

// ---- async states ----
const fadeIn = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24, ease: EASE } } as const;

export function AsyncView<T>({ state, isEmpty, emptyMessage = 'Nothing to show.', children }: {
  state: AsyncState<T>; isEmpty?: (d: T) => boolean; emptyMessage?: string; children: (d: T) => ReactNode;
}) {
  if (state.status === 'loading' && state.data === null) {
    return <motion.div {...fadeIn} className="flex items-center justify-center gap-2 p-10 text-sm text-muted"><CircularProgress size={16} thickness={5} sx={{ color: 'var(--primary)' }} /> Loading...</motion.div>;
  }
  if (state.status === 'error') {
    return (
      <motion.div {...fadeIn} className="m-4">
        <MuiAlert
          severity="error" icon={<AlertTriangle size={16} />}
          sx={{ border: '1px solid var(--bad)', bgcolor: 'var(--badbg)', color: 'var(--bad)', fontSize: 14, alignItems: 'flex-start' }}
          action={<Button variant="outline" size="sm" onClick={state.reload}><RefreshCw size={13} /> Retry</Button>}
        >
          <div className="font-medium">Something went wrong</div>
          <p className="mt-1 whitespace-pre-wrap">{state.error}</p>
        </MuiAlert>
      </motion.div>
    );
  }
  if (state.data === null) return null;
  if (isEmpty?.(state.data)) {
    return <motion.div {...fadeIn} className="flex flex-col items-center gap-2 p-10 text-sm text-muted"><Inbox size={20} />{emptyMessage}</motion.div>;
  }
  return <>{children(state.data)}</>;
}

// ---- table ----
export interface Column<T> { key: string; header: ReactNode; render: (row: T) => ReactNode; className?: string }

const MotionRow = motion.create(TableRow);
const cellSx = { p: '8px 12px', borderColor: 'var(--border)', color: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', verticalAlign: 'top', overflowWrap: 'anywhere', wordBreak: 'break-word' } as const;

/** `fixedLayout`: columns never exceed the container; give narrow columns a width class (e.g. `w-24`), the rest share what is left. */
export function DataTable<T>({ rows, columns, pageSize = 25, onRowClick, rowKey, selectedKey, empty = 'No rows.', fixedLayout }: {
  rows: T[]; columns: Column<T>[]; pageSize?: number; onRowClick?: (r: T) => void; rowKey: (r: T) => string; selectedKey?: string; empty?: string; fixedLayout?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { if (page > pages - 1) setPage(0); }, [rows.length, pages, page]);
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div>
      <div className="overflow-x-auto">
        <Table size="small" sx={{ fontSize: 14, textAlign: 'left', width: '100%', maxWidth: '100%', tableLayout: fixedLayout ? 'fixed' : 'auto' }}>
          <TableHead>
            <TableRow>
              {columns.map((c) => <TableCell key={c.key} className={c.className} sx={{ ...cellSx, bgcolor: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, fontWeight: 500, verticalAlign: 'middle' }}>{c.header}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {slice.length === 0 && <TableRow><TableCell colSpan={columns.length} sx={{ ...cellSx, p: 3, textAlign: 'center', color: 'var(--muted)', borderBottom: 0 }}>{empty}</TableCell></TableRow>}
            {slice.map((r, i) => {
              const k = rowKey(r);
              return (
                <MotionRow
                  key={k}
                  hover={!!onRowClick}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, ease: EASE, delay: Math.min(i, 12) * 0.025 }}
                  sx={{
                    cursor: onRowClick ? 'pointer' : 'default', bgcolor: selectedKey === k ? 'var(--primarybg)' : 'transparent', transition: 'background-color 140ms ease',
                    '&.MuiTableRow-hover:hover': { bgcolor: selectedKey === k ? 'var(--primarybg)' : 'var(--surface2)' },
                    '&:last-child td': { borderBottom: 0 },
                  }}
                >
                  {columns.map((c) => <TableCell key={c.key} className={c.className} sx={cellSx}>{c.render(r)}</TableCell>)}
                </MotionRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rows.length > pageSize && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
          <span>{rows.length.toLocaleString()} rows</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></Button>
            <span>Page {page + 1} / {pages}</span>
            <Button variant="outline" size="icon" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, description, right }: { title: string; description: ReactNode; right?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, ease: EASE }}
      className="mb-4 flex flex-wrap items-start justify-between gap-3"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Typography variant="h5" component="h1" sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>{title}</Typography>
        <InfoTip title="What is this screen for?"><span>{description}</span></InfoTip>
      </div>
      {right}
    </motion.div>
  );
}
