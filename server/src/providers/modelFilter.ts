/**
 * Pure helpers that trim a provider's raw model list to chat models that are free to use and current.
 * Providers do not publish "free" or "deprecated" flags, so the rules below are conservative name/field patterns.
 */

const NON_CHAT = /(embed|whisper|tts|speech|audio|image|imagen|veo|live|guard|moderation|aqa|vision-preview|robotics|computer-use|transcribe|playai|orpheus)/i;

/** Groq: its free tier covers the hosted chat models; drop speech, guard and other non-chat models. */
export function filterGroqModels(ids: string[]): string[] {
  return ids.filter((id) => !NON_CHAT.test(id));
}

/** OpenRouter: free models carry the `:free` suffix. Newest first when creation times are known. */
export function filterOpenRouterModels(rows: { id?: string; created?: number }[]): string[] {
  return rows
    .filter((r): r is { id: string; created?: number } => !!r.id && r.id.endsWith(':free') && !NON_CHAT.test(r.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((r) => r.id);
}

/**
 * Gemini: the free API tier is the Flash family (Pro needs billing). Keep only the newest version of each
 * Flash / Flash-Lite family, no dated snapshots and no experimental, tuned or non-text models.
 */
export function filterGeminiModels(ids: string[]): string[] {
  const parsed = ids
    .filter((id) => !NON_CHAT.test(id) && !/(-exp|-\d{3}$|-\d{2}-\d{2,4}$|tuning|thinking)/i.test(id))
    .map((id) => {
      const m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash)(?:-|$)/.exec(id);
      return m ? { id, version: parseFloat(m[1]), family: m[2] } : null;
    })
    .filter((x): x is { id: string; version: number; family: string } => x !== null);
  const newest = new Map<string, number>();
  for (const p of parsed) newest.set(p.family, Math.max(newest.get(p.family) ?? 0, p.version));
  return parsed.filter((p) => p.version === newest.get(p.family)).map((p) => p.id).sort();
}
