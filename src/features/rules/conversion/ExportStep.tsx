import { AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ExportMenu } from '@/components/ExportMenu';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, Button, Card, CardHeader, Input, Select, Stat } from '@/components/ui';
import {
  conversionReportDoc, demoFields, effectiveFields, incompleteReasons, rulesInScope, splitByReadiness, templateRow, traqRuleDoc, validateForExport, type ExportScope,
} from '@/domain/ruleConversion/templates';
import { decisionCounts } from '@/domain/ruleConversion/views';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/cn';
import { downloadDoc } from '@/lib/download';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { AiRuleConvert } from './AiRuleConvert';
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
  const [scope, setScope] = useState<ExportScope>('demo');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const template = templates.find((t) => t.id === templateId) ?? templates[0];
  const batch = settings.effectiveStartDate;
  const inScope = useMemo(() => rulesInScope(rules, edits, scope), [rules, edits, scope]);
  const demo = scope === 'demo';
  const demoOpen = useMemo(() => (demo ? inScope.filter((r) => incompleteReasons(r, edits[r.id]).length > 0).length : 0), [demo, inScope, edits]);
  const checks = useMemo(() => validateForExport(template, inScope, edits, batch, demo), [template, inScope, edits, batch, demo]);
  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const counts = decisionCounts(rules, edits);
  const split = useMemo(() => splitByReadiness(rules, edits), [rules, edits]);
  const notReady = useMemo(() => split.pending.filter((p) => edits[p.rule.id]?.decision !== 'rejected' && (p.rule.target.chosen || edits[p.rule.id]?.decision === 'approved')), [split, edits]);
  const blocked = inScope.length === 0 || errors.length > 0;
  const now = () => new Date().toISOString();

  const download = (format: 'csv' | 'xlsx') => {
    try {
      const out = downloadDoc(format, traqRuleDoc(template, inScope, edits, batch, now(), demo), template.id === 'dd-export' ? 'traq_dd_export' : 'traq_fpm_da_rules');
      setStatus({ ok: true, text: `Downloaded ${out.filename} with ${out.rows} rule(s).` });
    } catch (e) {
      setStatus({ ok: false, text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  return (
    <div className="space-y-4">
      <AiRuleConvert rules={rules} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Rules" value={rules.length} />
        <Stat label="Converted" value={rules.filter((r) => r.status === 'converted').length} hint="no open issues" />
        <Stat label="Needs review" value={rules.filter((r) => r.status === 'needs-review').length} />
        <Stat label="Failed" value={rules.filter((r) => r.status === 'failed').length} hint="no TRAQ target" />
        <Stat label="Ready for TRAQ" value={split.ready.length} hint="approved, every column confirmed" />
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
                <option value="validated">Validated TRAQ rules only ({split.ready.length})</option>
                <option value="approved">Approved, even with unconfirmed mappings ({counts.approved})</option>
                <option value="approved-and-pending">Approved and pending (not rejected or failed)</option>
                <option value="demo">Demo: all rules, unmapped ones show CrisMac logic ({rules.length})</option>
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

          {demo && (
            <div role="note" className="flex items-start gap-2 rounded-md border border-warn bg-warnbg px-3 py-2 text-xs">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
              <span><b>Demo file.</b> {demoOpen} of {inScope.length} rule(s) are not fully mapped, so their expression keeps the TRAQ translation and shows each unmapped column, parameter or unsupported part as the CrisMac text, with a comment listing them. Nothing is guessed for those parts, and the rows are not valid TRAQ syntax. Use "Validated TRAQ rules only" for a file to load into TRAQ.</span>
            </div>
          )}
          <Validation inScope={inScope.length} errors={errors} warnings={warnings} onOpenRule={onOpenRule} />
          <p className="text-xs text-muted">The Export menu above (top right) downloads the complete report instead: every rule with its Ready / Pending status, the reasons, the original CrisMac logic beside the TRAQ expression, and every column mapping.</p>
          <NotReady items={notReady} onOpenRule={onOpenRule} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Preview" subtitle={`${template.name} · first ${Math.min(PREVIEW_ROWS, inScope.length)} of ${inScope.length} row(s), exactly as they will be written (* = mandatory)`} />
        {inScope.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{scope === 'validated' ? 'No rule is Ready yet. Approve rules in step 4 (every column must be confirmed), or widen the scope.' : scope === 'approved' ? 'No approved rules yet. Approve rules in step 4, or include pending rules.' : 'No rules in scope.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface2 text-muted"><tr>{template.columns.map((c) => <th key={c.header} className="px-2 py-2 align-bottom font-medium" title={c.hint}>{c.header}{c.mandatory ? '*' : ''}</th>)}</tr></thead>
              <tbody>
                {inScope.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    {templateRow(template, demo ? demoFields(r, edits[r.id], batch) : effectiveFields(r, edits[r.id], batch)).map((v, i) => {
                      const wide = ['expression', 'explanation', 'crismac', 'reads'].includes(template.columns[i].field);
                      return (
                        <td key={template.columns[i].header} className={cn('px-2 py-1.5', wide ? 'min-w-[10rem] max-w-[22rem]' : 'max-w-[9rem]', i === template.columns.findIndex((c) => c.field === 'expression') && 'font-mono text-[10.5px]', !v && template.columns[i].mandatory && 'bg-badbg')}>
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

function NotReady({ items, onOpenRule }: { items: { rule: ConvertedRule; reasons: string[] }[]; onOpenRule: (id: string) => void }) {
  if (items.length === 0) return null;
  const list = items.slice(0, 25);
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm"><AlertTriangle size={14} className="text-warn" /> {items.length} rule(s) with a TRAQ target are not Ready and are not in the validated file</div>
      <ul className="max-h-56 divide-y divide-border overflow-auto text-xs">
        {list.map(({ rule, reasons }) => (
          <li key={rule.id} className="flex items-start gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1"><span className="font-mono">{rule.crismacTable}.{rule.crismacColumn}</span> <span className="text-muted">({rule.procedure})</span>: {reasons.slice(0, 3).join('; ')}{reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ''}</span>
            <button type="button" className="shrink-0 text-primary hover:underline" onClick={() => onOpenRule(rule.id)}>Open rule</button>
          </li>
        ))}
      </ul>
      {items.length > list.length && <p className="px-3 py-1.5 text-[11px] text-muted">Showing {list.length} of {items.length}. The complete export lists all of them.</p>}
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
