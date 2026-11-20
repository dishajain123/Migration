import { AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Button, Card, CardHeader, Input, Select, Stat } from '@/components/ui';
import {
  conversionReportDoc, effectiveFields, rulesInScope, templateRow, traqRuleDoc, validateForExport, type ExportScope,
} from '@/domain/ruleConversion/templates';
import { decisionCounts } from '@/domain/ruleConversion/views';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/cn';
import { downloadDoc } from '@/lib/download';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import type { ConvertedRule, RuleTemplate } from '@/types';

const PREVIEW_ROWS = 20;

export function ExportStep({ rules, onOpenRule }: { rules: ConvertedRule[]; onOpenRule: (id: string) => void }) {
  const templates = useAsync(() => services.ruleConversion.listTemplates(), []);
  return (
    <AsyncView state={templates} isEmpty={(t) => t.length === 0} emptyMessage="No TRAQ rule template found.">
      {(list) => <ExportBody rules={rules} templates={list} onOpenRule={onOpenRule} />}
    </AsyncView>
  );
}

function ExportBody({ rules, templates, onOpenRule }: { rules: ConvertedRule[]; templates: RuleTemplate[]; onOpenRule: (id: string) => void }) {
  const templateId = useConversionStore((s) => s.templateId);
  const setTemplate = useConversionStore((s) => s.setTemplate);
  const edits = useConversionStore((s) => s.edits);
  const settings = useConversionStore((s) => s.settings);
  const setSettings = useConversionStore((s) => s.setSettings);
  const [scope, setScope] = useState<ExportScope>('approved');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const batch = settings.effectiveStartDate;
  const inScope = useMemo(() => rulesInScope(rules, edits, scope), [rules, edits, scope]);
  const checks = useMemo(() => validateForExport(template, inScope, edits, batch), [template, inScope, edits, batch]);
  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const counts = decisionCounts(rules, edits);
  const blocked = inScope.length === 0 || errors.length > 0;
  const now = () => new Date().toISOString();

  const download = (format: 'csv' | 'xlsx') => {
    try {
      const out = downloadDoc(format, traqRuleDoc(template, inScope, edits, batch, now()), template.id === 'dd-export' ? 'traq_dd_export' : 'traq_fpm_da_rules');
      setStatus({ ok: true, text: `Downloaded ${out.filename} with ${out.rows} rule(s).` });
    } catch (e) {
      setStatus({ ok: false, text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Rules" value={rules.length} />
        <Stat label="Converted" value={rules.filter((r) => r.status === 'converted').length} hint="no open issues" />
        <Stat label="Needs review" value={rules.filter((r) => r.status === 'needs-review').length} />
        <Stat label="Failed" value={rules.filter((r) => r.status === 'failed').length} hint="no TRAQ target" />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="Rejected" value={counts.rejected} />
        <Stat label="Pending review" value={counts.pending} />
      </div>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-1.5">5. TRAQ rule file <InfoTip title="Which format?">
            <span>Both layouts are copied from real project files, not invented. dd_export is TRAQ's data-dictionary derivation format (one row per derived column, any table). FPM_DA_RULES is how the workbook documents the live rules on FCT_PRODUCT_MASTER.</span>
            <span>{template.mandatoryBasis}</span>
          </InfoTip></span>}
          subtitle="Only the rules in scope are written. Any error below blocks the download."
          right={<ExportMenu baseName="rule_conversion_report" getDoc={() => conversionReportDoc(rules, edits, batch, now())} disabled={rules.length === 0} />}
        />
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="TRAQ rule template">
            {templates.map((t) => (
              <button
                key={t.id} type="button" role="radio" aria-checked={t.id === template.id} onClick={() => setTemplate(t.id)}
                className={cn('rounded-lg border p-3 text-left transition-colors', t.id === template.id ? 'border-primary bg-primarybg' : 'border-border hover:bg-surface2')}
              >
                <div className="flex items-center gap-2 text-sm font-medium">{t.name}{t.provisional ? <Badge tone="warn">Provisional</Badge> : <Badge tone="ok">From project files</Badge>}</div>
                <div className="mt-1 text-xs text-muted">{t.provenance}</div>
                <div className="mt-1.5 font-mono text-[10.5px] text-muted">{t.columns.map((c) => `${c.header}${c.mandatory ? '*' : ''}`).join(' | ')}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="text-xs">
              <span className="mb-1 block font-medium">Rules to export</span>
              <Select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
                <option value="approved">Approved only ({counts.approved})</option>
                <option value="approved-and-pending">Approved and pending (not rejected or failed)</option>
              </Select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium">Effective start date</span>
              <Input type="date" value={batch} onChange={(e) => setSettings({ effectiveStartDate: e.target.value })} />
            </label>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={blocked} onClick={() => download('csv')}><FileText size={14} /> Download CSV</Button>
              <Button disabled={blocked} onClick={() => download('xlsx')}><FileSpreadsheet size={14} /> Download Excel</Button>
            </div>
          </div>

          {status && (
            <div role="status" className={cn('anim-fade flex items-center gap-2 rounded-md px-3 py-2 text-sm', status.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad')}>
              {status.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{status.text}
            </div>
          )}

          <Validation inScope={inScope.length} errors={errors} warnings={warnings} onOpenRule={onOpenRule} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Preview" subtitle={`${template.name} · first ${Math.min(PREVIEW_ROWS, inScope.length)} of ${inScope.length} row(s), exactly as they will be written (* = mandatory)`} />
        {inScope.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{scope === 'approved' ? 'No approved rules yet. Approve rules in step 4, or include pending rules.' : 'No rules in scope.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface2 text-muted"><tr>{template.columns.map((c) => <th key={c.header} className="whitespace-nowrap px-3 py-2 font-medium" title={c.hint}>{c.header}{c.mandatory ? '*' : ''}</th>)}</tr></thead>
              <tbody>
                {inScope.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    {templateRow(template, effectiveFields(r, edits[r.id], batch)).map((v, i) => {
                      const wide = ['expression', 'explanation', 'crismac', 'reads'].includes(template.columns[i].field);
                      return (
                        <td key={template.columns[i].header} className={cn('px-3 py-1.5', wide ? 'max-w-[28rem]' : 'whitespace-nowrap', i === template.columns.findIndex((c) => c.field === 'expression') && 'font-mono text-[10.5px]', !v && template.columns[i].mandatory && 'bg-badbg')}>
                          <span className={wide ? 'line-clamp-3 break-all' : ''} title={v}>{v || (template.columns[i].mandatory ? 'missing' : '')}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Validation({ inScope, errors, warnings, onOpenRule }: {
  inScope: number; errors: ReturnType<typeof validateForExport>; warnings: ReturnType<typeof validateForExport>; onOpenRule: (id: string) => void;
}) {
  if (inScope === 0) return null;
  if (errors.length === 0 && warnings.length === 0) {
    return <div className="flex items-center gap-2 rounded-md bg-okbg px-3 py-2 text-sm text-ok"><CheckCircle2 size={15} /> All {inScope} rule(s) pass the mandatory-field and placeholder checks.</div>;
  }
  const list = [...errors, ...warnings].slice(0, 40);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm">
        {errors.length > 0 && <span className="flex items-center gap-1 text-bad"><AlertCircle size={14} /> {errors.length} error(s) block the download</span>}
        {warnings.length > 0 && <span className="flex items-center gap-1 text-warn"><AlertTriangle size={14} /> {warnings.length} warning(s)</span>}
      </div>
      <ul className="max-h-64 divide-y divide-border overflow-auto text-xs">
        {list.map((c, i) => (
          <li key={`${c.ruleId}-${c.field}-${i}`} className="flex items-start gap-2 px-3 py-1.5">
            {c.severity === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0 text-bad" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />}
            <span className="min-w-0 flex-1"><span className="font-mono">{c.ruleId.split('::')[1]}</span> <span className="text-muted">({c.ruleId.split('::')[0]})</span>: {c.message}</span>
            <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => onOpenRule(c.ruleId)}>Open rule</button>
          </li>
        ))}
      </ul>
      {errors.length + warnings.length > list.length && <p className="px-3 py-1.5 text-[11px] text-muted">Showing {list.length} of {errors.length + warnings.length}.</p>}
    </div>
  );
}
