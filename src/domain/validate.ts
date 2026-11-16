import type { MappingRow, Severity, ValidationReport, ValidationRequest, ValidationResult, WorkbookModel } from '@/types';
import { memo } from './memo';
import { colKey, fedKeySet, feedingMappings, isLoadPathTable } from './selectors';
import { compat } from './typeUtils';

/*
 * Deterministic metadata checks over the workbook mappings. No real data is read and no AI is involved.
 */

interface Bucket { checked: number; bad: string[] }
const MAX_ITEMS = 50;

function emit(
  results: ValidationResult[], checkId: string, check: string, buckets: Map<string, Bucket>, badSeverity: Severity,
  passMsg: (b: Bucket) => string, badMsg: (b: Bucket) => string,
) {
  for (const [table, b] of buckets) {
    if (b.checked === 0) continue;
    const flagged = b.bad.length;
    results.push({
      id: `${checkId}:${table}`, checkId, check, table, severity: flagged ? badSeverity : 'pass',
      message: flagged ? badMsg(b) : passMsg(b), checked: b.checked, flagged, items: b.bad.slice(0, MAX_ITEMS),
    });
  }
}

function bucket(map: Map<string, Bucket>, key: string): Bucket {
  let b = map.get(key);
  if (!b) { b = { checked: 0, bad: [] }; map.set(key, b); }
  return b;
}

export function runValidation(model: WorkbookModel, req: ValidationRequest = { reviewed: [] }): ValidationReport {
  const base = memo(model, 'validation-base', () => computeBase(model));
  const results = [...base];

  // C7: human-reviewed (approved/manual) mappings from the review workflow
  const c7 = new Map<string, Bucket>();
  for (const r of req.reviewed) {
    const b = bucket(c7, r.targetTable);
    b.checked++;
    const cmp = compat(r.sourceType, r.targetType);
    if (cmp.level === 'warn' || cmp.level === 'incompatible') b.bad.push(`${r.targetColumn} <- ${r.sourceTable}.${r.sourceColumn}: ${cmp.note}`);
  }
  emit(results, 'C7', 'Reviewed mapping type compatibility', c7, 'warn',
    (b) => `${b.checked} reviewed mapping(s) type-compatible`, (b) => `${b.bad.length} of ${b.checked} reviewed mapping(s) need attention`);

  const totals = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) totals[r.severity] += 1;
  return {
    results, totals, generatedAt: new Date().toISOString(),
    basis: 'Deterministic checks over workbook mapping metadata (no data profiling, no AI).',
  };
}

function computeBase(model: WorkbookModel): ValidationResult[] {
  const results: ValidationResult[] = [];
  const fed = fedKeySet(model);

  // C1: mandatory (NOT NULL) target columns must be fed
  const c1 = new Map<string, Bucket>();
  for (const t of model.tables) {
    if (!isLoadPathTable(t)) continue;
    for (const c of t.columns) {
      if (c.nullable !== false || c.traqOnly) continue;
      const b = bucket(c1, t.name);
      b.checked++;
      if (!fed.has(colKey(t.name, c.name))) b.bad.push(c.name);
    }
  }
  emit(results, 'C1', 'Mandatory columns are fed', c1, 'fail',
    (b) => `All ${b.checked} NOT NULL column(s) have a feeding mapping`, (b) => `${b.bad.length} NOT NULL column(s) have no feeding mapping`);

  const feeding = feedingMappings(model);
  const direct = (m: MappingRow) => ['DIRECT', 'RENAME', ''].includes(m.mapType.toUpperCase()) && !!m.sourceType && !!m.targetType;

  // C2: string truncation (DIRECT-type mappings only)
  const c2 = new Map<string, Bucket>();
  // C3: type-family mismatch
  const c3 = new Map<string, Bucket>();
  for (const m of feeding) {
    if (!direct(m)) continue;
    const cmp = compat(m.sourceType, m.targetType);
    if (cmp.level === 'unknown') continue;
    const label = `${m.targetColumn} <- ${m.sourceTable}.${m.sourceColumn} (${m.sourceType} -> ${m.targetType})`;
    const b2 = bucket(c2, m.targetTable);
    b2.checked++;
    if (cmp.level === 'warn' && /truncation/i.test(cmp.note)) b2.bad.push(label);
    const b3 = bucket(c3, m.targetTable);
    b3.checked++;
    if ((cmp.level === 'warn' && !/truncation/i.test(cmp.note)) || cmp.level === 'incompatible') b3.bad.push(`${label}: ${cmp.note}`);
  }
  emit(results, 'C2', 'No string truncation on direct mappings', c2, 'warn',
    (b) => `${b.checked} direct mapping(s) fit the target length`, (b) => `${b.bad.length} mapping(s) may truncate`);
  emit(results, 'C3', 'Type family compatible on direct mappings', c3, 'warn',
    (b) => `${b.checked} direct mapping(s) type-compatible`, (b) => `${b.bad.length} mapping(s) need a cast or are incompatible`);

  // C4: target collisions flagged in the workbook
  const c4 = new Map<string, Bucket>();
  for (const m of model.mappings) {
    if (!m.targetTable) continue;
    const b = bucket(c4, m.targetTable);
    if (!m.targetColumn) continue;
    b.checked++;
    if (/TARGET COLLISION/i.test(m.remark)) b.bad.push(`${m.targetColumn} (${m.sheet} row ${m.rowNo})`);
  }
  emit(results, 'C4', 'No unresolved target collisions', c4, 'warn',
    (b) => `No collisions flagged across ${b.checked} mapping(s)`, (b) => `${b.bad.length} unresolved collision flag(s) in workbook`);

  // C5: unresolved decisions for columns with no TRAQ target
  const c5 = new Map<string, Bucket>();
  for (const u of model.unmapped) {
    const b = bucket(c5, u.sheet);
    b.checked++;
    if (!u.decision && !u.traqColumn) b.bad.push(`${u.sourceTable}.${u.column}`);
  }
  emit(results, 'C5', 'Columns with no TRAQ target have a decision', c5, 'warn',
    (b) => `All ${b.checked} listed column(s) have a decision`, (b) => `${b.bad.length} of ${b.checked} column(s) have no decision`);

  // C6: mappings explicitly marked "confirmation required"
  const c6 = new Map<string, Bucket>();
  for (const m of model.mappings) {
    if (!m.targetTable) continue;
    const b = bucket(c6, m.targetTable);
    b.checked++;
    if (/confirmation/i.test(m.mapType) || /confirmation (required|need)/i.test(m.remark)) b.bad.push(`${m.targetColumn || '(table)'} (${m.sheet} row ${m.rowNo})`);
  }
  for (const [k, b] of c6) if (b.bad.length === 0) c6.delete(k);
  emit(results, 'C6', 'No mappings awaiting confirmation', c6, 'warn', () => '', (b) => `${b.bad.length} mapping(s) marked as awaiting confirmation`);

  return results;
}
