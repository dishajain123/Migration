import type { BusinessRule, RuleKind, WorkbookModel } from '@/types';
import { memo } from './memo';
import { feedingMappings, isLoadPathTable, parsePrimaryKey } from './selectors';

const clip = (s: string, n = 260) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Extract rules deterministically from workbook cells. Every rule carries its sheet/row provenance. */
export function extractRules(model: WorkbookModel): BusinessRule[] {
  return memo(model, 'rules', () => {
    const rules: BusinessRule[] = [];
    const push = (r: Omit<BusinessRule, 'origin'> & { origin?: BusinessRule['origin'] }) => rules.push({ origin: 'workbook', ...r });

    // mandatory
    for (const t of model.tables) {
      if (!isLoadPathTable(t)) continue;
      for (const c of t.columns) {
        if (c.nullable === false && !c.traqOnly) {
          push({ id: `mand:${c.id}`, kind: 'mandatory', table: t.name, column: c.name, text: `${t.name}.${c.name} is mandatory (NOT NULL${c.dataType ? `, ${c.dataType}` : ''}).`, sheet: c.sheet, rowNo: c.rowNo });
        }
      }
      // primary keys stated in banners
      const pk = parsePrimaryKey(t.banner ?? '');
      if (pk.length) push({ id: `pk:${t.name}`, kind: 'constraint', table: t.name, text: `Primary key (${pk.join(', ')}) as stated in the sheet banner.`, sheet: t.sheet ?? t.name, rowNo: 2 });
    }

    // mapping-derived rules
    for (const m of feedingMappings(model)) {
      const mt = m.mapType.toUpperCase();
      const base = { table: m.targetTable, column: m.targetColumn, sheet: m.sheet, rowNo: m.rowNo };
      const where = `${m.targetTable}.${m.targetColumn}`;
      if (mt === 'CONSTANT') {
        push({ id: `const:${m.id}`, kind: 'constant', ...base, text: `${where} is a constant. ${clip(m.remark)}` });
      } else if (mt === 'DERIVED') {
        push({ id: `der:${m.id}`, kind: 'transform', ...base, text: `${where} is derived. ${clip(m.remark)}` });
      }
      if (/COALESCE\(|NVL\(|NULLIF/i.test(m.remark) && (mt === 'LOOKUP' || mt === 'DERIVED' || mt === 'JOIN')) {
        push({ id: `def:${m.id}`, kind: 'default', ...base, text: `${where} uses a fallback/default: ${clip(m.remark)}` });
      }
    }
    for (const m of model.mappings) {
      if (!m.targetTable || !/(must not|must be|never |primary key|unique)/i.test(m.remark)) continue;
      push({ id: `con:${m.id}`, kind: 'constraint', table: m.targetTable, column: m.targetColumn || undefined, sheet: m.sheet, rowNo: m.rowNo, text: clip(m.remark) });
    }

    // Derived Attribute rules on FCT_PRODUCT_MASTER
    for (const d of model.daRules) {
      push({ id: `da:${d.rowNo}`, kind: 'derivation', table: 'FCT_PRODUCT_MASTER', column: d.column, sheet: 'FPM_DA_RULES', rowNo: d.rowNo, text: `${d.column} (run ${d.run}, from ${d.inForceFrom}): ${clip(d.logic)}` });
    }
    for (const r of model.decisionRows) {
      push({ id: `dt:${r.rowNo}`, kind: 'derivation', table: 'FCT_PRODUCT_MASTER', column: 'NPA_ID', sheet: 'FPM_DA_RULES', rowNo: r.rowNo, text: `NPA_ID row ${r.row} "${r.name}" -> ${r.result}: ${clip(r.meaning)}` });
    }
    return rules;
  });
}

export function ruleKinds(): RuleKind[] {
  return ['mandatory', 'constant', 'default', 'transform', 'constraint', 'derivation'];
}
