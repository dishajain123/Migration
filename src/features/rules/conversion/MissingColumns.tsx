import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Card, CardHeader, DataTable, Input, Select, Stat } from '@/components/ui';
import { findGaps, gapsDoc, GAP_LABEL, type ColumnGap, type GapKind, type GapReport } from '@/domain/ruleConversion/gaps';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import type { ApiResult, ConversionResult, ConvertedRule } from '@/types';

const TONE: Record<GapKind, 'bad' | 'warn' | 'info'> = { missing: 'bad', suggested: 'info', ambiguous: 'warn' };
const SHOWN_RULES = 40;

const EMPTY: ApiResult<ConversionResult> = {
  data: { rules: [], dependencies: [], stats: { total: 0, converted: 0, needsReview: 0, failed: 0, withTarget: 0, procedures: 0 }, generatedAt: '', basis: '' },
  meta: { simulated: false, requestId: '', latencyMs: 0 },
};

/**
 * A separate, read-only view of the rules that cannot be converted because a CrisMac column they use has no confirmed TRAQ
 * column. It uses the SQL uploaded in the first tab; it does not approve, map or export anything.
 */
export function MissingColumns() {
  const files = useConversionStore((s) => s.files);
  const settings = useConversionStore((s) => s.settings);
  const edits = useConversionStore((s) => s.edits);
  const mappingDecisions = useReviewStore((s) => s.mappingDecisions);
  const manualMappings = useReviewStore((s) => s.manualMappings);
  const reviewed = useMemo(() => selectReviewedMappings({ mappingDecisions, manualMappings }), [mappingDecisions, manualMappings]);
  const procedures = useMemo(() => files.flatMap((f) => (f.procedure ? [f.procedure] : [])), [files]);
  const key = `${procedures.map((p) => `${p.file}:${p.lineCount}`).join('|')}#${JSON.stringify(settings.paramValues)}#${JSON.stringify(settings.paramMappings)}#${reviewed.map((r) => `${r.id}>${r.targetTable}.${r.targetColumn}`).join(',')}`;
  const result = useAsync(
    () => (procedures.length ? services.ruleConversion.convert({ procedures, reviewed, settings }) : Promise.resolve(EMPTY)),
    [key],
  );

  if (procedures.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted">
        No CrisMac SQL has been uploaded yet. Upload or load procedures in <Link to="/rules?tab=convert" className="text-primary hover:underline">CrisMac SQL → TRAQ rules</Link>; the rules and the columns they are missing then appear here.
      </Card>
    );
  }
  return (
    <AsyncView state={result} emptyMessage="Nothing to analyse.">
      {(r) => <Gaps rules={r.rules} edits={edits} />}
    </AsyncView>
  );
}

function Gaps({ rules, edits }: { rules: ConvertedRule[]; edits: ReturnType<typeof useConversionStore.getState>['edits'] }) {
  const report = useMemo(() => findGaps(rules, edits), [rules, edits]);
  const [kind, setKind] = useState<GapKind | ''>('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('');
  const rows = report.columns.filter((c) => (!kind || c.kind === kind) && (!q || `${c.key} ${c.suggestion}`.toLowerCase().includes(q.toLowerCase())));
  const current = report.columns.find((c) => c.key === selected) ?? rows[0];
  const s = report.stats;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Read-only. These are rules from your uploaded SQL that cannot be converted because a CrisMac column they write or read has no confirmed TRAQ column.
        Nothing is guessed: to unblock a rule, add the mapping in <Link to="/mapping" className="text-primary hover:underline">Agent 4</Link> (or the workbook) and it drops off this list.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Rules blocked" value={s.rulesWithGap} hint={`of ${s.totalRules} rules`} />
        <Stat label="Missing columns" value={s.columns} hint={`${s.writeGaps} are rule targets`} />
        <Stat label="No TRAQ column" value={s.missing} />
        <Stat label="Simulated suggestion only" value={s.suggested} />
        <Stat label="Ambiguous" value={s.ambiguous} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader
            title={<span className="flex items-center gap-1.5">Columns missing in TRAQ <InfoTip title="What counts as missing">
              <span><b>No TRAQ column:</b> neither Agent 4 nor the workbook maps it and no TRAQ column has its name.</span>
              <span><b>Simulated suggestion only:</b> Agent 4's heuristic proposes a column, but it is not a confirmed mapping.</span>
              <span><b>Ambiguous:</b> more than one documented TRAQ column.</span>
            </InfoTip></span>}
            subtitle="Most blocking first"
            right={<ExportMenu baseName="missing_columns_report" getDoc={() => gapsDoc(report, new Date().toISOString())} disabled={report.columns.length === 0} />}
          />
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            <Input placeholder="Search column..." value={q} onChange={(e) => setQ(e.target.value)} className="w-52" aria-label="Search missing columns" />
            <Select value={kind} onChange={(e) => setKind(e.target.value as GapKind | '')} aria-label="Gap type">
              <option value="">All gap types</option>{(Object.keys(GAP_LABEL) as GapKind[]).map((k) => <option key={k} value={k}>{GAP_LABEL[k]}</option>)}
            </Select>
          </div>
          <DataTable<ColumnGap>
            rows={rows} rowKey={(c) => c.key} pageSize={12} selectedKey={current?.key} onRowClick={(c) => setSelected(c.key)}
            empty={report.columns.length === 0 ? 'No gaps: every column these rules use has a confirmed TRAQ column.' : 'No column matches these filters.'}
            columns={[
              { key: 'c', header: 'CrisMac column', render: (c) => <span className="font-mono text-xs">{c.crismacTable}.{c.crismacColumn}</span> },
              { key: 'k', header: 'Gap', render: (c) => <Badge tone={TONE[c.kind]}>{GAP_LABEL[c.kind]}</Badge> },
              { key: 'n', header: 'Rules blocked', render: (c) => <span className="tabular-nums text-xs">{c.rules.length}<span className="block text-muted">{c.writtenBy} write · {c.readBy} read</span></span> },
              { key: 'u', header: 'Only blocker of', render: (c) => <span className="tabular-nums text-xs">{c.unblocks}</span> },
            ]}
          />
        </Card>

        <div className="min-w-0">{current ? <Detail gap={current} report={report} /> : <Card className="p-8 text-center text-sm text-muted">Select a column to see the rules it blocks.</Card>}</div>
      </div>
    </div>
  );
}

function Detail({ gap, report }: { gap: ColumnGap; report: GapReport }) {
  const byId = new Map(report.rules.map((r) => [r.rule.id, r]));
  return (
    <Card>
      <div className="space-y-1 border-b border-border p-4">
        <div className="font-mono text-sm font-semibold">{gap.crismacTable}.{gap.crismacColumn}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={TONE[gap.kind]}>{GAP_LABEL[gap.kind]}</Badge>
          <span className="text-muted">blocks {gap.rules.length} rule(s); mapping it alone would unblock {gap.unblocks}.</span>
        </div>
        {gap.suggestion && <p className="text-xs text-muted">Agent 4 heuristic (Simulated, not applied): <span className="font-mono">{gap.suggestion}</span></p>}
        <p className="text-xs text-muted">{gap.note}</p>
      </div>
      <ul className="max-h-[70vh] divide-y divide-border overflow-auto">
        {gap.rules.slice(0, SHOWN_RULES).map((ref) => {
          const rg = byId.get(ref.ruleId);
          if (!rg) return null;
          return (
            <li key={`${ref.ruleId}-${ref.role}`} className="p-3 text-xs">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{ref.label}</span>
                  <span className="text-muted">{ref.procedure}</span>
                  <Badge tone="neutral">{ref.role === 'writes' ? 'rule target' : 'read by rule'}</Badge>
                  {ref.otherGaps > 0 && <span className="text-muted">+{ref.otherGaps} other missing column(s)</span>}
                  <span className="text-muted">{rg.rule.traq.crismac}</span>
                </summary>
                <div className="mt-2 space-y-2">
                  {rg.gaps.length > 1 && <p>All missing in this rule: <span className="font-mono">{rg.gaps.map((g) => g.key).join(', ')}</span></p>}
                  <div><div className="mb-0.5 font-medium text-muted">Original CrisMac logic</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface2 p-2 font-mono text-[11px]">{rg.rule.crismacLogic}</pre></div>
                  <div><div className="mb-0.5 font-medium text-muted">TRAQ expression so far (unresolved parts are marked)</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface2 p-2 font-mono text-[11px]">{rg.rule.traq.expression}</pre></div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {gap.rules.length > SHOWN_RULES && <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Showing {SHOWN_RULES} of {gap.rules.length}. The Export menu lists all of them.</p>}
    </Card>
  );
}
