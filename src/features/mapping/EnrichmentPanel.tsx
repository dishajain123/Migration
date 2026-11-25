import { useRef, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { PROFILE_CSV_HEADER } from '@/domain/profile';
import { services } from '@/services';
import { useEnrichmentStore } from '@/stores/enrichmentStore';

/**
 * Opt-in inputs for Agent 4 (docs/PROFILE_INPUT.md). Pure workbook-only mode is the default: nothing here is used until
 * a file is loaded, and the file stays in this browser tab's memory.
 */
export function EnrichmentPanel({ table }: { table: string }) {
  const { profile, fileName, errors, warnings, loadFile, clearProfile, embeddings, setEmbeddings } = useEnrichmentStore();
  const input = useRef<HTMLInputElement>(null);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [embBusy, setEmbBusy] = useState(false);
  const [embError, setEmbError] = useState('');
  const index = embeddings[table];

  const embed = async () => {
    setEmbBusy(true); setEmbError('');
    try {
      const r = await services.ai.buildEmbeddingIndex(table, profile ?? undefined);
      if (r.data) setEmbeddings(table, r.data); else setEmbError(r.error?.message ?? 'The embedding request failed.');
    } finally { setEmbBusy(false); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { loadFile(f.name, await f.text(), share); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <Card>
      <CardHeader
        title="Profile & metadata (optional)"
        subtitle={profile ? `Active: ${profile.label ?? fileName ?? profile.id}` : 'Not loaded: suggestions use the workbook only'}
        right={<InfoTip title="Optional profile input" align="right">
          <span>A JSON or CSV file with column descriptions, glossary terms, code value sets and data profiles (distinct count, null rate, min/max, top values).</span>
          <span>It is <b>not</b> workbook data. Suggestions it influences are labelled <b>profile_enriched</b>, are not calibrated, and still need your approval.</span>
          <span>CSV header: <span className="font-mono">{PROFILE_CSV_HEADER}</span>. Full schema: docs/PROFILE_INPUT.md.</span>
        </InfoTip>}
      />
      <div className="space-y-2 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" aria-label="Profile file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{profile ? 'Replace profile file' : 'Load profile file (.json / .csv)'}</Button>
          {profile && <Button size="sm" variant="ghost" onClick={clearProfile}>Remove profile</Button>}
          <label className="flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            CSV: allow sample values to be sent to the AI provider
          </label>
        </div>
        {profile && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">profile_enriched</Badge>
            <span>{profile.columns.length} column(s), {profile.glossary.length} glossary term(s), {profile.valueSets.length} value set(s)</span>
            <Badge tone={profile.shareSampleValuesWithAi ? 'warn' : 'ok'}>{profile.shareSampleValuesWithAi ? 'sample values may be sent to AI' : 'sample values stay local'}</Badge>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button size="sm" variant="outline" disabled={embBusy} onClick={() => void embed()}>{embBusy ? 'Embedding…' : index ? `Recompute semantic embeddings for ${table}` : `Add semantic embeddings for ${table}`}</Button>
          {index && <><Badge tone="info">embedding_enriched</Badge><span className="text-muted">{Object.keys(index.vectors).length} columns embedded with {index.model}{index.usesProfile ? ' (including profile text)' : ''}</span></>}
          <InfoTip title="Semantic embeddings" align="right">
            <span>Sends this table's column names, types{profile ? ', profile descriptions and statistics' : ''} to your OpenAI or Gemini embedding model, then adds cosine similarity as a small scoring signal.</span>
            <span>Embeddings only support a match that already has name, workbook or profile evidence; they never create one alone. Suggestions they influence are tagged and uncalibrated.</span>
            {profile && !profile.shareSampleValuesWithAi && <span>Sample values are not included (the profile does not allow sharing them).</span>}
          </InfoTip>
        </div>
        {embError && <p role="alert" className="text-bad">{embError}</p>}
        {errors.length > 0 && <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-bad bg-badbg p-2 pl-6 text-bad">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}{errors.length > 8 && <li>{errors.length - 8} more</li>}</ul>}
        {warnings.length > 0 && <ul className="list-disc space-y-0.5 pl-6 text-warn">{warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}{warnings.length > 5 && <li>{warnings.length - 5} more</li>}</ul>}
      </div>
    </Card>
  );
}
