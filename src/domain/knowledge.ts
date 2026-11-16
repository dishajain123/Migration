import type { DocInput, KnowledgeChunk, MappingRow, PlatformTopic, ProcSource, ProcTrace, SourceRef, WorkbookModel } from '@/types';
import { KNOWN_GAPS, NONFEED, OUT_OF_SCOPE_TABLES } from './constants';
import { buildLineage } from './lineage';
import { memo } from './memo';
import { buildCatalogue, describeKind, documentedExpressions } from './procedures';
import { allRelationships } from './relationships';
import { extractRules } from './rules';
import { colKey, mappingsBySource, mappingsByTarget, parsePrimaryKey, summarizeTable } from './selectors';

/*
 * Turns the parsed workbook (plus app docs and the platform guide) into retrievable, self-contained text chunks.
 * Nothing here invents content: every sentence is either a workbook fact, a count derived from workbook rows,
 * or an explicit "Not provided in workbook". Each chunk carries source references for citation.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const list = (items: string[], max: number) => (items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max} more)` : items.join(', '));
const plural = (n: number, w: string) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;

function tally<T>(items: T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return Array.from(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const typesText = (items: MappingRow[]) => tally(items, (m) => m.mapType || 'UNSPECIFIED').map(([k, v]) => `${k} ${num(v)}`).join(', ');
const NOT_PROVIDED = 'Not provided in workbook';

function tableChunks(model: WorkbookModel): KnowledgeChunk[] {
  return model.tables.map((t) => {
    const s = summarizeTable(model, t);
    const pk = parsePrimaryKey(t.banner ?? '');
    const lines = [
      `**${t.name}** is a ${t.system === 'TRAQ' ? 'TRAQ target table' : 'CrisMac source table'} in the ${t.layer} layer.`,
      ...(t.sheet ? [`- Workbook sheet: ${t.sheet}.`] : []),
      `- Columns: ${num(t.columns.length)} listed${t.declaredColumns !== undefined && t.declaredColumns !== t.columns.length ? ` (the workbook declares ${num(t.declaredColumns)})` : ''}.`,
      ...(t.system === 'TRAQ' ? [`- ${num(s.fedColumns)} of ${num(t.columns.length)} listed columns are fed by a documented mapping.`] : []),
      ...(t.rowsInDb !== undefined ? [`- Rows in database (workbook index): ${num(t.rowsInDb)}.`] : []),
      pk.length ? `- Primary key (from the sheet banner): ${pk.join(', ')}.` : `- Primary key: ${NOT_PROVIDED}.`,
      ...(t.structureFrom ? [`- Structure taken from: ${t.structureFrom}.`] : []),
      ...(t.banner ? [`- Sheet banner: "${clip(t.banner, 220)}"`] : []),
      `- Purpose: ${NOT_PROVIDED} (the workbook documents structure and mappings, not table descriptions).`,
      ...(t.columns.length ? [`- Column names: ${list(t.columns.map((c) => c.name), 25)}.`] : []),
    ];
    return {
      id: `table:${t.name}`, kind: 'table', title: t.name, text: lines.join('\n'),
      keywords: ['table', 'columns', 'purpose', 'primary key', t.layer.toLowerCase(), t.system.toLowerCase()],
      entities: [t.name], origin: 'workbook',
      sources: [{ kind: 'table', label: t.name, sheet: t.sheet, route: '/data-model' }],
    };
  });
}

function columnChunks(model: WorkbookModel): KnowledgeChunk[] {
  const byTarget = mappingsByTarget(model);
  const bySource = mappingsBySource(model);
  const out: KnowledgeChunk[] = [];
  for (const t of model.tables) {
    for (const c of t.columns) {
      const key = colKey(t.name, c.name);
      const fedBy = byTarget.get(key) ?? [];
      const feeds = bySource.get(key) ?? [];
      const nullTxt = c.nullable === false ? 'mandatory (NOT NULL)' : c.nullable === true ? 'nullable' : 'nullability not stated';
      const lines = [`**${t.name}.${c.name}** - ${c.dataType || 'data type not stated'}; ${nullTxt}.`];
      if (c.traqOnly) lines.push('- Listed in the workbook as having no CrisMac source.');
      if (fedBy.length) lines.push(`- Fed by: ${fedBy.slice(0, 3).map((m) => `${m.sourceTable || '?'}.${m.sourceColumn || '?'} (${m.mapType || 'type not stated'})`).join('; ')}${fedBy.length > 3 ? ` (+${fedBy.length - 3} more)` : ''}.`);
      else if (t.system === 'TRAQ' && !c.traqOnly) lines.push('- No mapping row for this column was found in the workbook.');
      if (feeds.length) lines.push(`- Feeds: ${feeds.slice(0, 3).map((m) => `${m.targetTable || '?'}.${m.targetColumn || '?'} (${m.mapType || 'type not stated'})`).join('; ')}${feeds.length > 3 ? ` (+${feeds.length - 3} more)` : ''}.`);
      const remark = fedBy.find((m) => m.remark)?.remark;
      if (remark) lines.push(`- Remark: "${clip(remark, 180)}"`);
      const sources: SourceRef[] = [{ kind: 'column', label: `${t.name}.${c.name}`, sheet: c.sheet, rowNo: c.rowNo, route: '/data-model' }];
      const mp = fedBy[0] ?? feeds[0];
      if (mp) sources.push({ kind: 'mapping', label: `${mp.sourceTable} -> ${mp.targetTable}`, sheet: mp.sheet, rowNo: mp.rowNo, route: `/mapping?table=${encodeURIComponent(mp.targetTable)}` });
      out.push({
        id: `col:${c.id}`, kind: 'column', title: `${t.name}.${c.name}`, text: lines.join('\n'),
        keywords: ['column', 'field', c.dataType], entities: [c.name, `${t.name}.${c.name}`], sources, origin: 'workbook',
      });
    }
  }
  return out;
}

function unmappedChunks(model: WorkbookModel): KnowledgeChunk[] {
  const groups = new Map<string, typeof model.unmapped>();
  for (const u of model.unmapped) {
    const k = `${u.sheet}|${u.sourceTable}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  return Array.from(groups, ([k, rows]) => {
    const [sheet, table] = k.split('|');
    const unresolved = rows.filter((r) => !r.decision.trim()).length;
    return {
      id: `unmapped:${k}`, kind: 'mapping' as const, title: `CrisMac columns with no TRAQ target: ${table || sheet}`,
      text: [
        `**${table || sheet}** has ${plural(rows.length, 'CrisMac column')} with no TRAQ target (sheet ${sheet}).`,
        `- Decision recorded: ${num(rows.length - unresolved)}; blank (unresolved): ${num(unresolved)}.`,
        `- Examples: ${list(rows.map((r) => r.column), 8)}.`,
      ].join('\n'),
      keywords: ['unmapped', 'no target', 'dropped', 'decision', 'unresolved'], entities: table ? [table] : [], origin: 'workbook' as const,
      sources: [{ kind: 'mapping' as const, label: `${sheet}: no-TRAQ-target block`, sheet, rowNo: rows[0].rowNo, route: '/mapping' }],
    };
  });
}

function lineageChunks(model: WorkbookModel): KnowledgeChunk[] {
  const g = buildLineage(model, { includeNotUsed: false, internalOnly: false });
  return g.nodes.map((n) => {
    const ups = g.edges.filter((e) => e.target === n.id);
    const downs = g.edges.filter((e) => e.source === n.id);
    const fmt = (e: { count: number }, name: string) => `${name} (${plural(e.count, 'mapping')})`;
    const lines = [
      `**${n.id}** data flow, from documented feeding mappings only:`,
      ups.length ? `- Fed from: ${list(ups.map((e) => fmt(e, e.source)), 10)}.` : '- No upstream table appears in the workbook mappings.',
      downs.length ? `- Feeds: ${list(downs.map((e) => fmt(e, e.target)), 10)}.` : '- It does not feed any other table in the workbook mappings.',
    ];
    return {
      id: `lineage:${n.id}`, kind: 'lineage' as const, title: `Lineage of ${n.id}`, text: lines.join('\n'),
      keywords: ['lineage', 'data flow', 'upstream', 'downstream', 'feeds', 'source'], entities: [n.id], origin: 'derived' as const,
      sources: [{ kind: 'lineage' as const, label: `Lineage: ${n.id}`, route: `/lineage?table=${encodeURIComponent(n.id)}` }],
    };
  });
}

function mappingChunks(model: WorkbookModel): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  const byTarget = new Map<string, MappingRow[]>();
  const byEdge = new Map<string, MappingRow[]>();
  for (const m of model.mappings) {
    if (!m.targetTable) continue;
    byTarget.set(m.targetTable, [...(byTarget.get(m.targetTable) ?? []), m]);
    if (m.sourceTable && m.sourceTable !== m.targetTable) {
      const k = `${m.sourceTable}=>${m.targetTable}`;
      byEdge.set(k, [...(byEdge.get(k) ?? []), m]);
    }
  }
  for (const [tbl, rows] of byTarget) {
    const feeding = rows.filter((m) => !NONFEED.has(m.mapType.toUpperCase()) && m.targetColumn).length;
    const srcs = Array.from(new Set(rows.map((m) => m.sourceTable).filter(Boolean)));
    out.push({
      id: `map:target:${tbl}`, kind: 'mapping', title: `Mappings into ${tbl}`,
      text: [
        `**${tbl}** has ${plural(rows.length, 'mapping row')} in the workbook (${num(feeding)} actually feed a column).`,
        `- Map types: ${typesText(rows)}.`,
        `- Source tables: ${srcs.length ? list(srcs, 10) : 'none stated'}.`,
      ].join('\n'),
      keywords: ['mapping', 'mappings', 'map type', 'migration', 'crismac'], entities: [tbl], origin: 'workbook',
      sources: [{ kind: 'mapping', label: `Mappings into ${tbl}`, sheet: rows[0].sheet, rowNo: rows[0].rowNo, route: `/mapping?table=${encodeURIComponent(tbl)}` }],
    });
  }
  for (const [k, rows] of byEdge) {
    const [src, tgt] = k.split('=>');
    const samples = rows.slice(0, 6).map((m) => `- \`${m.sourceColumn || '?'}\` -> \`${m.targetColumn || '(none)'}\` (${m.mapType || 'type not stated'})`);
    out.push({
      id: `map:edge:${k}`, kind: 'mapping', title: `${src} -> ${tgt}`,
      text: [`**${src} -> ${tgt}**: ${plural(rows.length, 'mapping row')} (${typesText(rows)}).`, ...samples, ...(rows.length > 6 ? [`- (+${rows.length - 6} more rows)`] : [])].join('\n'),
      keywords: ['mapping', 'source to target', 'columns'], entities: [], origin: 'workbook',
      sources: [{ kind: 'mapping', label: `${src} -> ${tgt}`, sheet: rows[0].sheet, rowNo: rows[0].rowNo, route: `/mapping?table=${encodeURIComponent(tgt)}` }],
    });
  }
  for (const d of documentedExpressions(model)) {
    out.push({
      id: `expr:${d.id}`, kind: 'mapping', title: `Documented expression for ${d.targetTable}.${d.targetColumn}`,
      text: `**${d.targetTable}.${d.targetColumn}** has this expression documented in the workbook (verbatim, not interpreted):\n- "${clip(d.expression, 420)}"`,
      keywords: ['expression', 'logic', 'transformation', 'derived', 'formula'], entities: [`${d.targetTable}.${d.targetColumn}`], origin: 'workbook',
      sources: [{ kind: 'mapping', label: `${d.targetTable}.${d.targetColumn}`, sheet: d.sheet, rowNo: d.rowNo, route: '/procedures' }],
    });
  }
  return out;
}

function procSourceChunks(procs: ProcSource[], traces: ProcTrace[]): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  for (const p of procs) {
    const t = traces.find((x) => x.proc === p.name);
    const real = p.steps.filter((s) => !s.housekeeping);
    const route = '/procedures';
    const src = (label: string, line?: number): SourceRef => ({ kind: 'procedure', label, sheet: p.file, rowNo: line, route });
    out.push({
      id: `procsrc:${p.name}`, kind: 'procedure', title: `PRO.${p.name} (source SQL)`,
      text: [
        `**PRO.${p.name}** is a sample CrisMac stored procedure, stage ${p.stage || 'not stated'} in the execution order (${num(p.lineCount)} lines, ${plural(real.length, 'statement')}).`,
        ...(p.descriptions.length ? [`- Description in its header: ${clip(p.descriptions.join(' / '), 260)}`] : []),
        ...(p.params.length ? [`- Parameters: ${p.params.map((x) => `${x.name} ${x.type}`).join(', ')}.`] : []),
        `- Writes: ${p.tablesWritten.length ? list(p.tablesWritten.map((w) => `${w.table} (${w.columns.length} columns)`), 8) : 'no permanent or working tables'}.`,
        `- Reads: ${p.tablesRead.length ? list(p.tablesRead, 10) : 'none'}.`,
        ...(p.calls.length ? [`- Calls: ${list(p.calls, 8)}.`] : []),
        ...(t ? [t.status === 'traceable'
          ? `- TRAQ link: ${plural(t.links.length, 'written column')} match TRAQ column names and ${plural(t.daRules.length, 'FPM_DA_RULES row')} relate to it (name matching, not a translation).`
          : '- TRAQ link: none documented. No written column or FPM_DA_RULES row ties it to a TRAQ column; its outputs may belong to tables outside the migration scope.'] : []),
        `- ${plural(p.changeLog.length, 'dated change comment')} and ${plural(p.testCases.length, 'named test scenario')} in the source. Full SQL is on the Source procedures tab.`,
      ].join('\n'),
      keywords: ['procedure', 'stored procedure', 'sql', 'source', 'logic', 'business logic', 'stage', 'asset classification', 'npa'],
      entities: [p.name, `PRO.${p.name}`], origin: 'workbook', sources: [src(`PRO.${p.name}`)],
    });
    if (p.testCases.length) {
      out.push({
        id: `procsrc:${p.name}:tests`, kind: 'procedure', title: `Test scenarios in PRO.${p.name}`,
        text: [`**PRO.${p.name}** names these test scenarios in its header (RefCustomerID: scenario):`, ...p.testCases.slice(0, 40).map((c) => `- ${c.id}: ${c.text}`), ...(p.testCases.length > 40 ? [`- (+${p.testCases.length - 40} more)`] : [])].join('\n'),
        keywords: ['test case', 'test scenario', 'scenarios', 'degradation', 'always std'], entities: [p.name], origin: 'workbook', sources: [src(`PRO.${p.name} header`, 1)],
      });
    }
    if (p.changeLog.length) {
      out.push({
        id: `procsrc:${p.name}:changes`, kind: 'procedure', title: `Change comments in PRO.${p.name}`,
        text: [`**PRO.${p.name}** has dated change comments (verbatim):`, ...p.changeLog.slice(0, 12).map((c) => `- line ${c.line}: ${c.text}`), ...(p.changeLog.length > 12 ? [`- (+${p.changeLog.length - 12} more)`] : [])].join('\n'),
        keywords: ['change history', 'changes', 'comments', 'modified', 'implemented', 'as per'], entities: [p.name], origin: 'workbook', sources: [src(`PRO.${p.name} comments`, p.changeLog[0].line)],
      });
    }
    const byCol = new Map<string, { table: string; column: string; steps: typeof p.steps }>();
    for (const s of real) {
      if (s.tableKind === 'local-temp') continue;
      for (const c of s.columns) {
        const k = `${s.table}.${c.name}`;
        const e = byCol.get(k) ?? { table: s.table, column: c.name, steps: [] };
        if (!e.steps.includes(s)) e.steps.push(s);
        byCol.set(k, e);
      }
    }
    for (const [k, e] of byCol) {
      const links = t?.links.filter((l) => l.procTable === e.table && l.procColumn === e.column) ?? [];
      const lines = e.steps.slice(0, 3).map((s) => {
        const expr = s.columns.find((c) => c.name === e.column)?.expression;
        return `- statement #${s.index} (${s.type}, lines ${s.lineStart}-${s.lineEnd})${expr ? `: \`${clip(expr, 200)}\`` : ''}${s.guard ? ` when ${clip(s.guard, 140)}` : ''}`;
      });
      out.push({
        id: `procsrc:${p.name}:col:${k}`, kind: 'procedure', title: `${k} in PRO.${p.name}`,
        text: [
          `**${k}** is assigned by PRO.${p.name} in ${plural(e.steps.length, 'statement')}:`, ...lines, ...(e.steps.length > 3 ? [`- (+${e.steps.length - 3} more)`] : []),
          ...(links.length ? [`- TRAQ column with the same name: ${list(links.map((l) => `${l.traqTable}.${l.traqColumn}`), 4)}.`] : []),
        ].join('\n'),
        keywords: ['assigned', 'set', 'expression', 'logic', 'column', 'derivation'], entities: [e.column, k, `PRO.${p.name}`.toUpperCase()],
        origin: 'workbook', sources: [src(`${k} (PRO.${p.name})`, e.steps[0].lineStart), ...links.slice(0, 1).map((l): SourceRef => ({ kind: 'column', label: `${l.traqTable}.${l.traqColumn}`, route: '/data-model' }))],
      });
    }
  }
  if (procs.length) {
    out.push({
      id: 'procsrc:overview', kind: 'procedure', title: 'Sample source procedures (SQL provided)',
      text: [
        `${plural(procs.length, 'sample CrisMac stored procedure')} are supplied with SQL beside the workbook, in execution order: ${procs.map((p) => `${p.stage} ${p.name}`).join('; ')}.`,
        `- ${plural(traces.filter((t) => t.status === 'traceable').length, 'procedure')} can be tied to TRAQ columns or FPM_DA_RULES rows by name; the others have no documented TRAQ target.`,
        '- Use the Source procedures tab on the Procedure Analyzer to read each statement, the columns it assigns and the conditions around it.',
      ].join('\n'),
      keywords: ['procedures', 'stored procedures', 'sql provided', 'how many procedures', 'execution order', 'sample', 'asset classification', 'npa', 'sma'], entities: [], origin: 'workbook',
      sources: [{ kind: 'procedure', label: 'Source procedures', route: '/procedures' }],
    });
  }
  return out;
}

function procedureChunks(model: WorkbookModel, sqlNames: Set<string>): KnowledgeChunk[] {
  const objs = buildCatalogue(model);
  const out: KnowledgeChunk[] = objs.map((o) => {
    const ref = o.references[0];
    const hasSql = sqlNames.has(o.name.replace(/^PRO\./i, '').toLowerCase());
    return {
      id: `proc:${o.id}`, kind: 'procedure', title: o.name,
      text: [
        `**${o.name}** - ${describeKind(o.kind)}.`,
        `- Referenced ${num(o.references.length)} time(s) on: ${list(o.sheets, 6)}.`,
        o.operations.length ? `- Operation keywords in the surrounding text: ${o.operations.join(', ')}.` : '- No INSERT/UPDATE/MERGE/DELETE keywords appear in the surrounding text.',
        o.mentionedTables.length ? `- Tables mentioned alongside it: ${list(o.mentionedTables, 10)}.` : '- No tables are named alongside it.',
        hasSql ? '- SQL body: not in the workbook, but a sample SQL file is provided (see the Source procedures tab).' : `- SQL body: ${NOT_PROVIDED}, so no logic beyond the above can be stated.`,
        ...(ref ? [`- Example reference (${ref.sheet}, row ${ref.rowNo}): "${clip(ref.snippet, 260)}"`] : []),
      ].join('\n'),
      keywords: ['procedure', 'stored procedure', 'view', 'workflow', 'logic', 'etl', o.kind],
      entities: [o.name], origin: 'workbook',
      sources: o.references.slice(0, 3).map((r) => ({ kind: 'procedure' as const, label: o.name, sheet: r.sheet, rowNo: r.rowNo, route: '/procedures' })),
    };
  });
  const byKind = tally(objs, (o) => o.kind).map(([k, v]) => `${k} ${num(v)}`).join(', ');
  out.push({
    id: 'proc:overview', kind: 'procedure', title: 'Procedures and objects referenced in the workbook',
    text: [
      `The workbook references ${plural(objs.length, 'procedure/view/mapping object')} by name${byKind ? ` (${byKind})` : ''}.`,
      `- Stored-procedure, view and DI-mapping SQL bodies: ${NOT_PROVIDED}. Only names and prose/expressions in remark cells exist.`,
      objs.length ? `- Examples: ${list(objs.map((o) => o.name), 10)}.` : '- No objects were detected.',
    ].join('\n'),
    keywords: ['procedures', 'stored procedures', 'sql', 'views', 'workflows', 'business logic', 'how many'], entities: [], origin: 'workbook',
    sources: [{ kind: 'procedure', label: 'Procedure catalogue', route: '/procedures' }],
  });
  return out;
}

function ruleChunks(model: WorkbookModel): KnowledgeChunk[] {
  const rules = extractRules(model).filter((r) => r.kind !== 'derivation');
  const groups = new Map<string, typeof rules>();
  for (const r of rules) groups.set(`${r.table}|${r.kind}`, [...(groups.get(`${r.table}|${r.kind}`) ?? []), r]);
  const out: KnowledgeChunk[] = Array.from(groups, ([k, rs]) => {
    const [table, kind] = k.split('|');
    const body = kind === 'mandatory'
      ? [`- Mandatory columns: ${list(rs.map((r) => r.column ?? ''), 30)}.`]
      : rs.slice(0, 8).map((r) => `- ${clip(r.text, 220)}`).concat(rs.length > 8 ? [`- (+${rs.length - 8} more)`] : []);
    return {
      id: `rule:${k}`, kind: 'rule' as const, title: `${kind} rules for ${table}`,
      text: [`**${table}** has ${plural(rs.length, `${kind} rule`)} extracted from the workbook:`, ...body].join('\n'),
      keywords: ['rule', 'rules', 'validation', 'business rule', kind], entities: [table], origin: 'workbook' as const,
      sources: [{ kind: 'rule' as const, label: `${kind} rules: ${table}`, sheet: rs[0].sheet, rowNo: rs[0].rowNo, route: '/rules' }],
    };
  });
  for (const d of model.daRules) {
    out.push({
      id: `da:${d.rowNo}`, kind: 'rule', title: `FPM_DA_RULES: ${d.column}`,
      text: [
        `**${d.column}** (FCT_PRODUCT_MASTER derived attribute; run ${d.run || '?'}, ${d.kind || 'kind not stated'}, ${d.ruleType || 'rule type not stated'}; in force from ${d.inForceFrom || 'date not stated'}${d.version ? `; version ${d.version}` : ''}).`,
        `- Logic: ${clip(d.logic || NOT_PROVIDED, 420)}`,
        ...(d.reads ? [`- Reads: ${clip(d.reads, 160)}`] : []),
        ...(d.crismac ? [`- CrisMac origin: ${clip(d.crismac, 160)}`] : []),
      ].join('\n'),
      keywords: ['derived attribute', 'rule', 'logic', 'fpm_da_rules', 'derivation'], entities: [d.column, `FCT_PRODUCT_MASTER.${d.column}`], origin: 'workbook',
      sources: [{ kind: 'rule', label: `FPM_DA_RULES: ${d.column}`, sheet: 'FPM_DA_RULES', rowNo: d.rowNo, route: '/rules' }],
    });
  }
  for (const r of model.decisionRows) {
    out.push({
      id: `dt:${r.rowNo}`, kind: 'rule', title: `NPA_ID decision row ${r.row}: ${r.name}`,
      text: [
        `**NPA_ID decision row ${r.row} - ${r.name}** (result: ${r.result || 'not stated'}).`,
        ...(r.meaning ? [`- Meaning: ${clip(r.meaning, 300)}`] : []),
        ...(r.conditions ? [`- Conditions: ${clip(r.conditions, 300)}`] : []),
        ...(r.crismac ? [`- CrisMac origin: ${clip(r.crismac, 160)}`] : []),
      ].join('\n'),
      keywords: ['npa_id', 'decision', 'derived attribute', 'rule'], entities: ['NPA_ID'], origin: 'workbook',
      sources: [{ kind: 'rule', label: `FPM_DA_RULES: NPA_ID row ${r.row}`, sheet: 'FPM_DA_RULES', rowNo: r.rowNo, route: '/rules' }],
    });
  }
  const all = extractRules(model);
  const kinds = tally(all, (r) => r.kind).map(([k, v]) => `${k} ${num(v)}`).join(', ');
  out.push({
    id: 'rule:overview', kind: 'rule', title: 'Business rules extracted from the workbook',
    text: [
      `${plural(all.length, 'business rule')} are extracted deterministically from workbook cells (${kinds || 'none'}).`,
      '- Each rule keeps its worksheet and row. Rules can be approved or rejected on the Rules & Validation screen; validation checks C1-C7 are metadata checks, not AI output.',
    ].join('\n'),
    keywords: ['business rules', 'validation', 'how many', 'approve', 'checks'], entities: [], origin: 'derived',
    sources: [{ kind: 'rule', label: 'Rules & Validation', route: '/rules' }],
  });
  return out;
}

function relationshipChunks(model: WorkbookModel): KnowledgeChunk[] {
  const rels = allRelationships(model);
  const byTable = new Map<string, typeof rels>();
  for (const r of rels) {
    for (const t of new Set([r.fromTable, r.toTable])) byTable.set(t, [...(byTable.get(t) ?? []), r]);
  }
  return Array.from(byTable, ([t, rs]) => ({
    id: `rel:${t}`, kind: 'relationship' as const, title: `Relationships of ${t}`,
    text: [
      `**${t}** relationships derived from LOOKUP/JOIN mappings (the workbook has no physical foreign-key list):`,
      ...rs.slice(0, 12).map((r) => `- \`${r.fromTable}.${r.fromColumn}\` -> \`${r.toTable}.${r.toColumn}\` (${r.kind})`),
      ...(rs.length > 12 ? [`- (+${rs.length - 12} more)`] : []),
    ].join('\n'),
    keywords: ['relationship', 'foreign key', 'join', 'lookup', 'dimension', 'related'], entities: [t], origin: 'derived' as const,
    sources: [{ kind: 'relationship' as const, label: `Relationships: ${t}`, sheet: rs[0].sheet, rowNo: rs[0].rowNo, route: '/data-model' }],
  }));
}

function scopeAndGlossaryChunks(model: WorkbookModel): KnowledgeChunk[] {
  const traq = model.tables.filter((t) => t.system === 'TRAQ');
  const src = model.tables.filter((t) => t.system === 'CrisMac');
  const inScope = model.sheets.filter((s) => s.inScope);
  const out: KnowledgeChunk[] = [];
  out.push({
    id: 'scope:main', kind: 'scope', title: 'Migration scope and workbook sheets',
    text: [
      '**Scope**: tables up to and including FCT_PRODUCT_MASTER, and their dependencies.',
      `- Loaded from the workbook: ${plural(traq.length, 'TRAQ table')}, ${plural(src.length, 'CrisMac source table')}, ${plural(model.tables.reduce((n, t) => n + t.columns.length, 0), 'column')}, ${plural(model.mappings.length, 'mapping row')}.`,
      `- In-scope sheets (${num(inScope.length)}): ${list(inScope.map((s) => s.name), 40)}.`,
      `- Out of scope (downstream of FCT_PRODUCT_MASTER): ${OUT_OF_SCOPE_TABLES.join(', ')}.`,
    ].join('\n'),
    keywords: ['scope', 'in scope', 'out of scope', 'sheets', 'worksheets', 'how many tables', 'fct_product_master', 'npa'],
    entities: OUT_OF_SCOPE_TABLES, origin: 'workbook',
    sources: [{ kind: 'scope', label: 'Data Model > Scope & gaps', route: '/data-model' }],
  });
  out.push({
    id: 'gap:overview', kind: 'gap', title: 'Known gaps in the workbook',
    text: ['**Known gaps** (the app shows "Not provided in workbook" rather than guessing):', ...KNOWN_GAPS.map((g) => `- ${g}`)].join('\n'),
    keywords: ['gaps', 'missing', 'limitations', 'not provided', 'caveats', 'unknown', 'sql bodies', 'foreign key'], entities: [], origin: 'workbook',
    sources: [{ kind: 'gap', label: 'Data Model > Scope & gaps', route: '/data-model' }],
  });
  out.push({
    id: 'glossary:systems', kind: 'glossary', title: 'What are CrisMac and TRAQ?',
    text: [
      '**CrisMac** is the migration source system and **TRAQ** is the migration target; the workbook maps CrisMac columns to TRAQ columns.',
      `- The workbook lists ${plural(src.length, 'CrisMac source table')} and ${plural(traq.length, 'TRAQ table')}.`,
      `- Full names of the two applications and their business purpose: ${NOT_PROVIDED}.`,
    ].join('\n'),
    keywords: ['crismac', 'traq', 'what is', 'application', 'overview', 'architecture', 'system', 'source', 'target'], entities: [], origin: 'workbook',
    sources: [{ kind: 'glossary', label: 'Workbook: CrisMac to TRAQ', route: '/' }],
  });
  const layers = tally(model.tables, (t) => t.layer);
  out.push({
    id: 'glossary:layers', kind: 'glossary', title: 'TRAQ data architecture: layers',
    text: [
      '**Data layers** present in the workbook (from the LAYER column of the index, with table counts):',
      ...layers.map(([l, n]) => `- ${l}: ${plural(n, 'table')}`),
      `- What each layer is for beyond this grouping: ${NOT_PROVIDED}. Open Data Flow & Lineage to see how mappings move data between tables.`,
    ].join('\n'),
    keywords: ['layer', 'layers', 'architecture', 'data model', 'staging', 'mart', 'reception', 'traq architecture'], entities: [], origin: 'derived',
    sources: [{ kind: 'glossary', label: 'Table layers', route: '/data-model' }, { kind: 'lineage', label: 'Data Flow & Lineage', route: '/lineage' }],
  });
  for (const [l] of layers) {
    const ts = model.tables.filter((t) => t.layer === l);
    out.push({
      id: `glossary:layer:${l}`, kind: 'glossary', title: `${l} layer tables`,
      text: [`**${l} layer** has ${plural(ts.length, 'table')}: ${list(ts.map((t) => t.name), 30)}.`, `- Role of this layer: ${NOT_PROVIDED}.`].join('\n'),
      keywords: ['layer', l.toLowerCase(), 'tables in', 'which tables'], entities: [], origin: 'derived',
      sources: [{ kind: 'glossary', label: `${l} layer`, route: '/data-model' }],
    });
  }
  const mt = tally(model.mappings, (m) => m.mapType || 'UNSPECIFIED');
  out.push({
    id: 'glossary:maptypes', kind: 'glossary', title: 'Map types used in the workbook',
    text: [
      '**Map types** observed in the MAP TYPE column, with row counts:',
      ...mt.map(([k, v]) => `- ${k}: ${num(v)}${NONFEED.has(k.toUpperCase()) ? ' (does not feed a target column)' : ''}`),
      `- Formal definitions of each map type: ${NOT_PROVIDED}.`,
    ].join('\n'),
    keywords: ['map type', 'direct', 'derived', 'lookup', 'constant', 'join', 'not fed', 'not used', 'meaning'], entities: [], origin: 'workbook',
    sources: [{ kind: 'glossary', label: 'MAP TYPE column', route: '/mapping' }],
  });
  return out;
}

function platformChunks(topics: PlatformTopic[]): KnowledgeChunk[] {
  return topics.map((p) => ({
    id: `platform:${p.id}`, kind: 'platform' as const, title: p.title, text: p.text, keywords: p.keywords, entities: [], origin: 'documentation' as const,
    sources: [{ kind: 'platform' as const, label: `Platform guide: ${p.title}`, route: p.route }],
  }));
}

function cleanDoc(lines: string[]): string {
  const kept: string[] = [];
  for (const raw of lines) {
    let l = raw.replace(/\s+$/, '');
    if (/^\s*```/.test(l)) continue;
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-') && l.includes('|')) continue;
    if (/^\s*\|.*\|\s*$/.test(l)) l = `- ${l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' - ')}`;
    l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function docChunks(doc: DocInput): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  let heading = doc.file;
  let buf: string[] = [];
  const flush = () => {
    const body = cleanDoc(buf);
    buf = [];
    if (body.length < 40) return;
    const pieces: string[] = [];
    let cur = '';
    for (const para of body.split('\n\n')) {
      if (cur && cur.length + para.length > 900) { pieces.push(cur); cur = para; } else cur = cur ? `${cur}\n\n${para}` : para;
    }
    if (cur) pieces.push(cur);
    pieces.forEach((p, i) => {
      const title = `${doc.file} > ${heading}${pieces.length > 1 ? ` (${i + 1}/${pieces.length})` : ''}`;
      out.push({
        id: `doc:${doc.file}:${out.length}`, kind: 'documentation', title, text: p, keywords: [heading], entities: [], origin: 'documentation',
        sources: [{ kind: 'documentation', label: `${doc.file} > ${heading}` }],
      });
    });
  };
  for (const line of doc.content.replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); heading = h[2].trim(); } else buf.push(line);
  }
  flush();
  return out;
}

/** All retrievable knowledge. Memoised per parsed workbook. */
export function buildKnowledge(
  model: WorkbookModel, extras: { docs: DocInput[]; platform: PlatformTopic[]; procs?: ProcSource[]; traces?: ProcTrace[] },
): KnowledgeChunk[] {
  const procs = extras.procs ?? [];
  return memo(model, 'knowledge', () => [
    ...tableChunks(model), ...columnChunks(model), ...unmappedChunks(model), ...lineageChunks(model), ...mappingChunks(model),
    ...procedureChunks(model, new Set(procs.map((p) => p.name.toLowerCase()))), ...procSourceChunks(procs, extras.traces ?? []), ...ruleChunks(model), ...relationshipChunks(model), ...scopeAndGlossaryChunks(model),
    ...platformChunks(extras.platform), ...extras.docs.flatMap(docChunks),
  ]);
}

/** Example questions built from real object names so they always return grounded answers. */
export function suggestedQuestions(model: WorkbookModel): string[] {
  const traq = model.tables.filter((t) => t.system === 'TRAQ');
  const fpm = traq.find((t) => t.name === 'FCT_PRODUCT_MASTER') ?? traq[0];
  const stg = traq.find((t) => t.layer === 'STAGING');
  const out = ['What is the scope of this migration?', 'What are CrisMac and TRAQ?', 'What gaps exist in the workbook?'];
  if (fpm) out.push(`What columns does ${fpm.name} have?`);
  if (stg) out.push(`Where does ${stg.name} get its data?`);
  if (fpm) out.push(`What business rules apply to ${fpm.name}?`);
  out.push('Which procedures are referenced in the workbook?', 'How do I review a mapping?');
  return out;
}
