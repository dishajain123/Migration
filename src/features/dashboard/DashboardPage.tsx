import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AsyncView, Badge, Card, CardHeader, OriginBadge, PageHeader, Progress, SimulatedBadge, Stat } from '@/components/ui';
import { computeReadiness } from '@/domain/dashboard';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useReviewStore } from '@/stores/reviewStore';

const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 } };

export function DashboardPage() {
  const state = useAsync(() => services.dashboard.getSummary(), []);
  const mappingDecisions = useReviewStore((s) => s.mappingDecisions);
  const manual = useReviewStore((s) => s.manualMappings);
  const ruleDecisions = useReviewStore((s) => s.ruleDecisions);
  const procs = useReviewStore((s) => s.proceduresAnalysed);

  return (
    <div>
      <PageHeader
        title="Migration Overview"
        description="Everything on this page is computed from the workbook CSV, from the Simulated mapping heuristic (labelled), or from your own review actions (stored in this browser)."
        right={<OriginBadge meta={state.meta} />}
      />
      <AsyncView state={state}>
        {(s) => {
          const decided = Object.keys(mappingDecisions).length;
          const rulesDecided = Object.keys(ruleDecisions).length;
          const analysed = Object.values(procs).filter(Boolean).length;
          const r = computeReadiness(s, { suggestionsDecided: decided, rulesDecided, proceduresAnalysed: analysed });
          const pendingReviews = Math.max(0, s.suggestions - decided);
          const vTotal = s.validation.pass + s.validation.warn + s.validation.fail;
          const lowest = s.coverage.byTable.slice(0, 12);
          const steps = [
            { to: '/data-model', label: 'Understand data models', done: s.tables.total > 0, detail: `${s.tables.traq} TRAQ + ${s.tables.source} source tables` },
            { to: '/lineage', label: 'Trace lineage', done: s.mappings.feeding > 0, detail: `${s.mappings.feeding.toLocaleString()} feeding mappings` },
            { to: '/procedures', label: 'Analyse procedures', done: analysed > 0, detail: `${analysed}/${s.procedures.total} marked analysed` },
            { to: '/mapping', label: 'Review mappings', done: decided + manual.length > 0, detail: `${decided}/${s.suggestions} suggestions decided` },
            { to: '/rules', label: 'Approve rules and validate', done: rulesDecided > 0, detail: `${rulesDecided}/${s.rules.total} rules decided` },
          ];
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Tables in scope" value={s.tables.total} hint={`${s.tables.traq} TRAQ / ${s.tables.source} source feeds`} tag={<Badge tone="ok">Workbook</Badge>} />
                <Stat label="Documented mappings" value={s.mappings.total.toLocaleString()} hint={`${s.mappings.feeding.toLocaleString()} feed a target column`} tag={<Badge tone="ok">Workbook</Badge>} />
                <Stat label="Column coverage" value={`${s.coverage.pct}%`} hint={`${s.coverage.fed.toLocaleString()} of ${s.coverage.total.toLocaleString()} load-path columns fed`} tag={<Badge tone="ok">Workbook</Badge>} />
                <Stat label="Pending reviews" value={pendingReviews.toLocaleString()} hint="Mapping suggestions awaiting a decision" tag={<SimulatedBadge />} />
                <Stat label="Procedures catalogued" value={s.procedures.total} hint={`${analysed} marked analysed (by you)`} tag={<Badge tone="info">User-tracked</Badge>} />
                <Stat label="Business rules" value={s.rules.total.toLocaleString()} hint={`${rulesDecided} approved/rejected`} tag={<Badge tone="ok">Workbook</Badge>} />
                <Stat label="Validation" value={`${s.validation.pass}/${vTotal}`} hint={`${s.validation.warn} warnings, ${s.validation.fail} failures`} tag={<Badge tone="ok">Deterministic</Badge>} />
                <Stat label="Unresolved decisions" value={s.unresolvedDecisions.toLocaleString()} hint={`of ${s.unmappedSource.toLocaleString()} source columns with no TRAQ target`} tag={<Badge tone="ok">Workbook</Badge>} />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader title="Migration readiness" subtitle="Computed score - not an AI assessment" />
                  <div className="space-y-3 p-4">
                    <div className="text-4xl font-semibold tabular-nums">{r.score}<span className="text-lg text-muted"> / 100</span></div>
                    <Progress value={r.score} tone={r.score >= 75 ? 'ok' : r.score >= 40 ? 'warn' : 'bad'} />
                    <dl className="space-y-1 text-xs">
                      <div className="flex justify-between"><dt className="text-muted">Column coverage</dt><dd>{r.coveragePct}%</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Validation pass rate</dt><dd>{r.validationPassPct}%</dd></div>
                      <div className="flex justify-between"><dt className="text-muted">Review completion</dt><dd>{r.reviewPct}%</dd></div>
                    </dl>
                    <p className="text-[11px] text-muted">{r.formula}</p>
                  </div>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader title="Lowest-coverage tables" subtitle="Fed columns / columns that should be fed (staging + MART)" />
                  <div className="h-72 p-2">
                    <ResponsiveContainer>
                      <BarChart data={lowest} layout="vertical" margin={{ left: 40, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 11 }} unit="%" />
                        <YAxis type="category" dataKey="table" width={170} tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                        <Tooltip {...tip} formatter={(v) => `${String(v)}%`} />
                        <Bar dataKey="pct" fill="var(--primary)" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                  <CardHeader title="Validation results" subtitle="Per check x table" />
                  <div className="h-56">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={[{ name: 'Pass', value: s.validation.pass, c: 'var(--ok)' }, { name: 'Warn', value: s.validation.warn, c: 'var(--warn)' }, { name: 'Fail', value: s.validation.fail, c: 'var(--bad)' }]}
                          dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}
                        >
                          {['var(--ok)', 'var(--warn)', 'var(--bad)'].map((c) => <Cell key={c} fill={c} />)}
                        </Pie>
                        <Tooltip {...tip} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader title="Mappings by type" subtitle="Top 10 MAP TYPE values" />
                  <div className="h-56 p-2">
                    <ResponsiveContainer>
                      <BarChart data={s.mappings.byMapType} margin={{ left: 0, right: 8 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} />
                        <Tooltip {...tip} />
                        <Bar dataKey="value" fill="var(--info)" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader title="Migration workflow" subtitle="Work through the five agents in order; progress is stored in this browser" />
                <div className="grid gap-2 p-3 md:grid-cols-5">
                  {steps.map((st, i) => (
                    <Link key={st.to} to={st.to} className="group rounded-md border border-border p-3 hover:bg-surface2">
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        {st.done ? <CheckCircle2 size={14} className="text-ok" /> : <Circle size={14} />} Step {i + 1}
                      </div>
                      <div className="mt-1 text-sm font-medium">{st.label}</div>
                      <div className="mt-0.5 text-xs text-muted">{st.detail}</div>
                      <div className="mt-2 flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100">Open <ArrowRight size={12} /></div>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          );
        }}
      </AsyncView>
    </div>
  );
}
