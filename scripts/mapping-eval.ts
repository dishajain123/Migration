/*
 * Baseline evaluation of Agent 4's suggester against the workbook's own documented mappings, and (optionally) against
 * the human decisions stored by the gateway.
 *   npm run eval:mapping                                   holdout report
 *   npm run eval:mapping -- --misses                       also list wrong / missed cases
 *   npm run eval:mapping -- --folds=10                     change k
 *   npm run eval:mapping -- --decisions=server/.data/mapping-decisions.json
 *                                                          also compare with approved / rejected decisions
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateAgainstDecisions, formatDecisionReport } from '../src/domain/decisionEval';
import { formatReport, runHoldout } from '../src/domain/mappingEval';
import { parseWorkbookCsv } from '../src/domain/parse';
import type { MappingDecisionRecord } from '../src/types/decisions';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const csv = readFileSync(fileURLToPath(new URL('../public/data/CrisMac_to_TRAQ_Combined.csv', import.meta.url)), 'utf8');
const model = parseWorkbookCsv(csv);
const report = runHoldout(model, Number(arg('folds') ?? 5));
console.log(formatReport(report));

if (process.argv.includes('--misses')) {
  console.log('\nWrong or missed:');
  for (const r of report.results.filter((x) => !x.correct)) {
    console.log(`  ${r.id}  truth=${r.truth}  ${r.reachable ? '' : '[not in pool] '}status=${r.status}${r.predicted ? `  predicted=${r.predicted} (${((r.rawScore ?? 0) * 100).toFixed(0)}%)` : ''}`);
  }
}

const decisionsFile = arg('decisions');
if (decisionsFile) {
  if (!existsSync(decisionsFile)) {
    console.error(`\nNo decisions file at ${decisionsFile}. Approve or reject mappings in Agent 4 with the gateway running first.`);
    process.exitCode = 1;
  } else {
    const raw = JSON.parse(readFileSync(decisionsFile, 'utf8')) as { users?: Record<string, Record<string, MappingDecisionRecord>> };
    const all = Object.values(raw.users ?? {}).flatMap((u) => Object.values(u));
    console.log(`\n${formatDecisionReport(evaluateAgainstDecisions(model, all))}`);
  }
}
