import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { AsyncView, Badge, Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { services } from '@/services';
import { useReviewStore } from '@/stores/reviewStore';

/**
 * Opened from a "map this column" link elsewhere (Agent 5). The CrisMac source column arrives fixed with all its known
 * details; the reviewer only chooses the TRAQ target table and column. Saved as an Agent 4 manual mapping.
 */
export function SourceColumnMapper({ sourceTable, sourceColumn, onDone, onOpenTable }: {
  sourceTable: string; sourceColumn: string; onDone: () => void; onOpenTable: (table: string) => void;
}) {
  const tables = useAsync(() => services.mapping.listAllTables(), []);
  const traqNames = useAsync(() => services.dataModel.listTables({ system: 'TRAQ' }), []);
  const manual = useReviewStore((s) => s.manualMappings);
  const add = useReviewStore((s) => s.addManualMapping);
  const [table, setTable] = useState('');
  const [column, setColumn] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');

  const existing = manual.filter((m) => m.sourceTable.toUpperCase() === sourceTable.toUpperCase() && m.sourceColumn.toUpperCase() === sourceColumn.toUpperCase());

  return (
    <Card className="mb-4 border-primary">
      <CardHeader title="Map a CrisMac column to TRAQ" subtitle="The source column is filled in; choose where it goes in TRAQ" right={<Button size="sm" variant="ghost" onClick={onDone}>Close</Button>} />
      <AsyncView state={tables}>
        {(all) => {
          const allowed = new Set((traqNames.data ?? []).map((t) => t.name));
          const traq = all.filter((t) => allowed.has(t.name));
          const src = all.find((t) => t.name.toUpperCase() === sourceTable.toUpperCase());
          const srcCol = src?.columns.find((c) => c.name.toUpperCase() === sourceColumn.toUpperCase());
          const cols = traq.find((t) => t.name === table)?.columns ?? [];
          const target = cols.find((c) => c.name === column);
          const save = () => {
            add({
              targetTable: table, targetColumn: column, targetType: target?.dataType ?? '',
              sourceTable, sourceColumn, sourceType: srcCol?.dataType ?? '',
              note: note || 'Entered from a missing-column link (Agent 5)',
            });
            setSaved(`${sourceTable}.${sourceColumn} → ${table}.${column}`);
            setColumn(''); setNote('');
          };
          return (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="space-y-1 text-xs">
                <div className="mb-1 font-medium">Source column (fixed)</div>
                <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                  <dt className="text-muted">Table</dt><dd className="font-mono">{sourceTable}</dd>
                  <dt className="text-muted">Column</dt><dd className="font-mono">{sourceColumn}</dd>
                  <dt className="text-muted">Data type</dt><dd className="font-mono">{srcCol?.dataType || <span className="font-sans text-muted">Not provided in workbook</span>}</dd>
                  <dt className="text-muted">In workbook</dt><dd>{srcCol ? <Badge tone="ok">listed</Badge> : <Badge tone="neutral">not listed (appears only in procedure SQL)</Badge>}</dd>
                </dl>
                {existing.length > 0 && (
                  <div className="mt-2 rounded-md border border-border p-2">
                    <div className="mb-1 font-medium">Already mapped in Agent 4</div>
                    {existing.map((m) => <div key={m.id} className="font-mono">{m.targetTable}.{m.targetColumn}</div>)}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium">Target (choose) <ArrowRight size={12} className="text-muted" /></div>
                <Select value={table} onChange={(e) => { setTable(e.target.value); setColumn(''); setSaved(''); }} aria-label="TRAQ table" className="w-full" disabled={traqNames.status === 'loading'}>
                  <option value="">{traqNames.status === 'loading' ? 'Loading tables...' : 'TRAQ table...'}</option>
                  {traq.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </Select>
                <Select value={column} onChange={(e) => { setColumn(e.target.value); setSaved(''); }} aria-label="TRAQ column" className="w-full" disabled={!table}>
                  <option value="">TRAQ column...</option>
                  {cols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.dataType || '?'})</option>)}
                </Select>
                <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" aria-label="Note" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={!table || !column} onClick={save}>Save mapping</Button>
                  {table && <Button variant="outline" onClick={() => onOpenTable(table)}>Open {table} in Agent 4</Button>}
                </div>
                {saved && <p role="status" className="text-xs text-ok">Saved {saved}. Rules that use this column pick it up when you return to Agent 5.</p>}
              </div>
            </div>
          );
        }}
      </AsyncView>
    </Card>
  );
}
