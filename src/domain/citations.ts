/** [S#] citation tags actually used in an answer's text, in first-appearance order, de-duplicated. */
export function extractCitedTags(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\[(S\d+)\]/g), (m) => m[1])));
}
