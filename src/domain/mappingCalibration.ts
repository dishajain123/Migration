/*
 * Confidence calibration for Agent 4. Pure maths, no workbook access.
 *
 * The engine's raw score (0.6*name + 0.25*type + 0.15*exact + context bonus) is an arbitrary weighted sum, not a
 * probability. Calibration replaces it with the empirical precision measured on held-out documented mappings
 * (see mappingEval.ts): "of the held-out predictions that scored in this band, X% named the documented source column".
 * Still a heuristic estimate (labelled Simulated in the UI), but it is now anchored to the workbook's own answers.
 */

export interface Prediction { score: number; ambiguous: boolean; correct: boolean }

export interface CalibrationBin { lo: number; hi: number; n: number; hits: number; /** monotone, smoothed precision 0-1 */ precision: number }
export interface Calibration {
  /** Number of held-out predictions the curves were fitted on. */
  n: number;
  pooled: CalibrationBin[];
  clear: CalibrationBin[];
  ambiguous: CalibrationBin[];
}
export interface CalibratedConfidence {
  /** 1-99 when calibrated; the raw score x 100 (capped) when not. */
  confidence: number;
  basis: 'calibrated' | 'uncalibrated';
  /** Held-out predictions behind the figure (0 when uncalibrated). */
  support: number;
}

export const BIN_EDGES = [0.35, 0.5, 0.65, 0.8, 1.0001];
/** A curve needs at least this many held-out predictions before it is trusted. */
export const MIN_CURVE_SUPPORT = 20;
const PRIOR_WEIGHT = 2;

/** Pool-adjacent-violators: the closest non-decreasing sequence (higher score must never mean lower precision). */
function monotone(vals: { p: number; w: number }[]): number[] {
  const blocks: { sum: number; w: number; count: number }[] = [];
  for (const v of vals) {
    blocks.push({ sum: v.p * v.w, w: v.w, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.pop();
      a.sum += b.sum; a.w += b.w; a.count += b.count;
    }
  }
  return blocks.flatMap((b) => new Array<number>(b.count).fill(b.sum / b.w));
}

function curve(preds: Prediction[]): CalibrationBin[] {
  const total = preds.length;
  const prior = total ? preds.filter((p) => p.correct).length / total : 0;
  const raw = BIN_EDGES.slice(0, -1).map((lo, i) => {
    const hi = BIN_EDGES[i + 1];
    const inBin = preds.filter((p) => p.score >= lo && p.score < hi);
    const hits = inBin.filter((p) => p.correct).length;
    const n = inBin.length;
    return { lo, hi, n, hits, smoothed: (hits + PRIOR_WEIGHT * prior) / (n + PRIOR_WEIGHT) };
  });
  const mono = monotone(raw.map((b) => ({ p: b.smoothed, w: b.n + PRIOR_WEIGHT })));
  return raw.map((b, i) => ({ lo: b.lo, hi: b.hi, n: b.n, hits: b.hits, precision: mono[i] }));
}

export function buildCalibration(preds: Prediction[]): Calibration {
  return {
    n: preds.length,
    pooled: curve(preds),
    clear: curve(preds.filter((p) => !p.ambiguous)),
    ambiguous: curve(preds.filter((p) => p.ambiguous)),
  };
}

const supportOf = (c: CalibrationBin[]) => c.reduce((s, b) => s + b.n, 0);

/** Map a raw engine score to a calibrated confidence. Falls back to the pooled curve, then to the raw score. */
export function calibrate(cal: Calibration, rawScore: number, ambiguous: boolean): CalibratedConfidence {
  const own = ambiguous ? cal.ambiguous : cal.clear;
  const use = supportOf(own) >= MIN_CURVE_SUPPORT ? own : supportOf(cal.pooled) >= MIN_CURVE_SUPPORT ? cal.pooled : undefined;
  if (!use) return { confidence: Math.max(1, Math.min(99, Math.round(rawScore * 100))), basis: 'uncalibrated', support: 0 };
  const bin = use.find((b) => rawScore >= b.lo && rawScore < b.hi) ?? (rawScore < use[0].lo ? use[0] : use[use.length - 1]);
  return { confidence: Math.max(1, Math.min(99, Math.round(bin.precision * 100))), basis: 'calibrated', support: supportOf(use) };
}
