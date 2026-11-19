import { Check, FileCode2, FileOutput, GitCompareArrows, ListChecks, SearchCode } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { AsyncView, Badge, SimulatedBadge } from '@/components/ui';
import { decisionCounts } from '@/domain/ruleConversion/views';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/cn';
import { services } from '@/services';
import { useConversionStore } from '@/stores/conversionStore';
import { selectReviewedMappings, useReviewStore } from '@/stores/reviewStore';
import type { ApiResult, ConversionResult } from '@/types';
import { AnalysisStep } from './AnalysisStep';
import { ExportStep } from './ExportStep';
import { MappingStep } from './MappingStep';
import { ReviewStep } from './ReviewStep';
import { UploadStep } from './UploadStep';

type Step = 'upload' | 'analysis' | 'mapping' | 'review' | 'export';

const EMPTY: ApiResult<ConversionResult> = {
  data: { rules: [], dependencies: [], stats: { total: 0, converted: 0, needsReview: 0, failed: 0, withTarget: 0, procedures: 0 }, generatedAt: '', basis: '' },
  meta: { simulated: false, requestId: '', latencyMs: 0 },
};

/**
 * Agent 5 rule migration: CrisMac SQL -> extraction -> mapping resolution (Agent 4) -> TRAQ rules -> review -> file.
 * Shared state lives in stores (files, settings, edits here; mappings in Agent 4's review store).
 */
export function ConversionWorkspace() {
  const [step, setStep] = useState<Step>('upload');
  const [selected, setSelected] = useState('');
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
  const openRule = useCallback((id: string) => { setSelected(id); setStep('review'); }, []);

  const rules = result.data?.rules ?? [];
  const counts = decisionCounts(rules, edits);
  const mappedTargets = rules.filter((r) => r.target.chosen).length;
  const steps: { id: Step; label: string; icon: typeof FileCode2; detail: string; done: boolean; enabled: boolean }[] = [
    { id: 'upload', label: 'Upload SQL', icon: FileCode2, detail: `${files.length} file(s)`, done: procedures.length > 0, enabled: true },
    { id: 'analysis', label: 'Analyse', icon: SearchCode, detail: `${procedures.length} procedure(s)`, done: procedures.length > 0, enabled: procedures.length > 0 },
    { id: 'mapping', label: 'Map to TRAQ', icon: GitCompareArrows, detail: `${mappedTargets} of ${rules.length} with target`, done: rules.length > 0 && mappedTargets > 0, enabled: procedures.length > 0 },
    { id: 'review', label: 'Review', icon: ListChecks, detail: `${counts.approved} approved, ${counts.pending} pending`, done: counts.approved > 0, enabled: procedures.length > 0 },
    { id: 'export', label: 'Export', icon: FileOutput, detail: 'CSV / Excel', done: false, enabled: procedures.length > 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>CrisMac SQL procedures</span><span aria-hidden="true">→</span><span>business logic</span><span aria-hidden="true">→</span>
        <span>Agent 4 mappings</span><span aria-hidden="true">→</span><span>TRAQ rules</span><span aria-hidden="true">→</span><span>human review</span><span aria-hidden="true">→</span><span>Excel / CSV</span>
        <InfoTip title="Rule migration" align="right">
          <span><b>What:</b> turns the business logic in CrisMac stored procedures into TRAQ Derived Attribute rules that read and write TRAQ columns.</span>
          <span><b>How:</b> statements are parsed (Agent 3), each CrisMac column is replaced by its TRAQ column using Agent 4 and workbook mappings, and the logic is rewritten in the TRAQ expression syntax shown in FPM_DA_RULES.</span>
          <span><b>Honesty:</b> this is deterministic rule-based conversion, not AI. Anything without a documented mapping or TRAQ equivalent is flagged for you, never guessed.</span>
        </InfoTip>
        <span className="ml-auto flex items-center gap-2"><Badge tone="ok">Rule-based, no AI</Badge><SimulatedBadge label="Confidence is simulated" /></span>
      </div>

      <nav aria-label="Conversion steps" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = s.id === step;
          return (
            <button
              key={s.id} type="button" disabled={!s.enabled} aria-current={active ? 'step' : undefined} onClick={() => setStep(s.id)}
              className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'border-primary bg-primarybg shadow-sm' : 'border-border bg-surface hover:bg-surface2')}
            >
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', s.done ? 'bg-ok text-bg' : active ? 'bg-primary text-primaryfg' : 'bg-surface2 text-muted')}>
                {s.done ? <Check size={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Icon size={13} />{s.label}</span>
                <span className="block truncate text-[11px] text-muted">{s.detail}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div key={step} className="anim-fade">
        {step === 'upload' && <UploadStep onNext={() => setStep('analysis')} />}
        {step !== 'upload' && (
          <AsyncView state={result} emptyMessage="Nothing to convert yet.">
            {(r) => (
              <>
                {result.status === 'loading' && <p className="mb-2 text-xs text-muted" aria-live="polite">Re-converting with the latest mappings and settings...</p>}
                {step === 'analysis' && <AnalysisStep dependencies={r.dependencies} onNext={() => setStep('mapping')} />}
                {step === 'mapping' && <MappingStep rules={r.rules} onNext={() => setStep('review')} />}
                {step === 'review' && <ReviewStep rules={r.rules} selected={selected} onSelect={setSelected} onNext={() => setStep('export')} />}
                {step === 'export' && <ExportStep rules={r.rules} onOpenRule={openRule} />}
              </>
            )}
          </AsyncView>
        )}
      </div>
    </div>
  );
}
