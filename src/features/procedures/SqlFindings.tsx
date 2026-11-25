import { Badge } from '@/components/ui';
import type { SqlAnalysis, SqlStepExplanation, SqlTableUse } from '@/types';

const ROLE_LABEL: Record<SqlTableUse['role'], string> = { read: 'read', written: 'written', 'read+written': 'read + written' };
const KIND_LABEL: Record<SqlTableUse['kind'], string> = { table: 'table', working: 'working table', 'local-temp': 'local temp' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-1 font-medium">{title}</div>{children}</div>;
}

function StepCard({ s }: { s: SqlStepExplanation }) {
  return (
    <details className="rounded-md border border-border bg-surface/50 p-2">
      <summary className="cursor-pointer">
        <Badge tone="primary">{s.type}</Badge> <span className="font-mono">{s.target || '?'}</span>
        <span className="ml-2 text-muted">lines {s.lineStart}-{s.lineEnd}</span>
        {s.condition && <Badge tone="warn">conditional</Badge>}
        {s.housekeeping && <Badge>bookkeeping</Badge>}
      </summary>
      <div className="mt-2 space-y-2">
        <p>{s.headline}</p>
        {s.comment && <p className="text-muted">Comment in source: {s.comment}</p>}
        {s.condition && <p><span className="font-medium">Runs only when:</span> <span className="font-mono">{s.condition}</span></p>}
        {s.joins.length > 0 && (
          <div><span className="font-medium">Joins:</span>
            <ul className="ml-4 list-disc">{s.joins.map((j, i) => <li key={i}>{j.kind} <span className="font-mono">{j.table}{j.alias ? ` ${j.alias}` : ''}</span>{j.on && <> on <span className="font-mono">{j.on}</span></>}</li>)}</ul>
          </div>
        )}
        {s.where && <p><span className="font-medium">Rows affected (WHERE):</span> <span className="font-mono">{s.where}</span></p>}
        {s.reads.length > 0 && <p><span className="font-medium">Reads:</span> <span className="font-mono">{s.reads.join(', ')}</span></p>}
        {s.columns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted"><tr><th className="pr-2">Column</th><th className="pr-2">Value / expression</th><th>What it does</th></tr></thead>
              <tbody>
                {s.columns.map((c) => (
                  <tr key={c.name} className="align-top border-t border-border">
                    <td className="py-1 pr-2 font-mono">{c.name}</td>
                    <td className="py-1 pr-2 font-mono whitespace-pre-wrap break-words">{c.expression || '-'}</td>
                    <td className="py-1">{c.plain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

export function SqlFindings({ a }: { a: SqlAnalysis }) {
  const main = a.steps.filter((s) => !s.housekeeping);
  const side = a.steps.filter((s) => s.housekeeping);
  return (
    <div className="space-y-4 p-3 text-xs">
      {a.mode === 'basic' && <p className="text-warn">Statement-level detail was not available for this text; showing a basic scan only.</p>}
      {a.overview.length > 0 && <Section title="What this SQL does"><ul className="space-y-1">{a.overview.map((l, i) => <li key={i}>• {l}</li>)}</ul></Section>}
      {a.variables.length > 0 && (
        <Section title="Variables declared">
          <ul className="space-y-1">{a.variables.map((v) => <li key={v.name}><span className="font-mono">{v.name}</span> <span className="text-muted">{v.type}</span>{v.definition && <> = <span className="font-mono">{v.definition}</span></>}</li>)}</ul>
        </Section>
      )}
      {a.tables.length > 0 && (
        <Section title="Tables">
          <div className="space-y-1">
            {a.tables.map((t) => (
              <div key={t.name}>
                <span className="font-mono">{t.name}</span> <Badge tone="info">{ROLE_LABEL[t.role]}</Badge> <Badge>{KIND_LABEL[t.kind]}</Badge>{' '}
                {t.kind === 'table' || t.knownInWorkbook ? <Badge tone={t.knownInWorkbook ? 'ok' : 'warn'}>{t.knownInWorkbook ? 'in workbook' : 'not in workbook'}</Badge> : <span className="text-muted">intermediate table, not expected in workbook</span>}
                {t.columnsWritten.length > 0 && <div className="ml-4 text-muted">writes: <span className="font-mono">{t.columnsWritten.join(', ')}</span></div>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {main.length > 0 && <Section title={`Statement walkthrough (${main.length})`}><div className="space-y-2">{main.map((s) => <StepCard key={s.index} s={s} />)}</div></Section>}
      {side.length > 0 && <Section title={`Status bookkeeping / CATCH (${side.length})`}><div className="space-y-2">{side.map((s) => <StepCard key={s.index} s={s} />)}</div></Section>}
      <Section title="Functions">
        {a.functionNotes.length || a.functions.length ? (
          <ul className="space-y-1">
            {a.functions.map((f) => { const n = a.functionNotes.find((x) => x.name === f); return <li key={f}><Badge>{f}</Badge> <span className="text-muted">{n?.meaning ?? ''}</span></li>; })}
          </ul>
        ) : <span className="text-muted">None</span>}
      </Section>
      <Section title="Clauses"><div className="flex flex-wrap gap-1">{a.clauses.map((f) => <Badge key={f}>{f}</Badge>)}{a.clauses.length === 0 && <span className="text-muted">None</span>}</div></Section>
      {a.changeLog.length > 0 && (
        <Section title={`Change comments in the source (${a.changeLog.length})`}>
          <ul className="space-y-1">{a.changeLog.map((c) => <li key={c.line}><span className="text-muted">line {c.line}:</span> {c.text}</li>)}</ul>
        </Section>
      )}
      {a.warnings.length > 0 && <Section title="Warnings"><ul className="space-y-1 text-warn">{a.warnings.map((w) => <li key={w}>• {w}</li>)}</ul></Section>}
    </div>
  );
}
