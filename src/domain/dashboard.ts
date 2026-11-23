import type { DashboardSummary, WorkbookModel } from '@/types';
import { buildCatalogue } from './procedures';
import { extractRules } from './rules';
import { countBy, feedingMappings, tableCoverage } from './selectors';
import { targetSummaries } from './suggest';
import { runValidation } from './validate';

export function buildDashboard(model: WorkbookModel): DashboardSummary {
  const traq = model.tables.filter((t) => t.system === 'TRAQ');
  const source = model.tables.filter((t) => t.system === 'CrisMac');
  const feeding = feedingMappings(model);
  const cov = tableCoverage(model);
  const fed = cov.reduce((a, r) => a + r.fed, 0);
  const total = cov.reduce((a, r) => a + r.total, 0);
  const procs = buildCatalogue(model);
  const rules = extractRules(model);
  const v = runValidation(model);
  return {
    tables: { traq: traq.length, source: source.length, total: model.tables.length, byLayer: countBy(model.tables, (t) => t.layer) },
    mappings: {
      total: model.mappings.length, feeding: feeding.length, nonFeeding: model.mappings.length - feeding.length,
      byMapType: countBy(model.mappings, (m) => m.mapType || 'UNSPECIFIED').slice(0, 10),
    },
    coverage: { fed, total, pct: total ? Math.round((fed / total) * 100) : 0, byTable: cov },
    suggestions: targetSummaries(model).reduce((a, t) => a + t.suggestions, 0),
    procedures: { total: procs.length, byKind: countBy(procs, (p) => p.kind) },
    rules: { total: rules.length, byKind: countBy(rules, (r) => r.kind) },
    validation: v.totals,
    unmappedSource: model.unmapped.length,
    unresolvedDecisions: model.unmapped.filter((u) => !u.decision && !u.traqColumn).length,
  };
}

export interface ReviewStats {
  suggestionsDecided: number;
  rulesDecided: number;
  proceduresAnalysed: number;
}

export interface Readiness {
  score: number;
  coveragePct: number;
  validationPassPct: number;
  reviewPct: number;
  formula: string;
}

/** Transparent composite score. NOT an AI assessment. */
export function computeReadiness(s: DashboardSummary, r: ReviewStats): Readiness {
  const vTotal = s.validation.pass + s.validation.warn + s.validation.fail;
  const validationPassPct = vTotal ? Math.round((s.validation.pass / vTotal) * 100) : 0;
  const denom = s.suggestions + s.rules.total + s.procedures.total;
  const reviewPct = denom ? Math.round(((r.suggestionsDecided + r.rulesDecided + r.proceduresAnalysed) / denom) * 100) : 0;
  const score = Math.round(0.5 * s.coverage.pct + 0.3 * validationPassPct + 0.2 * reviewPct);
  return {
    score, coveragePct: s.coverage.pct, validationPassPct, reviewPct,
    formula: '50% column coverage + 30% validation pass rate + 20% review completion (suggestions + rules + procedures)',
  };
}
