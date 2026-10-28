import { COG_SECTIONS, type CogSection } from "./types";

/**
 * Raw section scores → percentiles → scaled scores → the composite.
 *
 * A norm table is the cumulative distribution of a section's raw score over
 * the norm sample: `cdf[r]` is the share of trainers scoring r or less. The
 * percentile of raw r is the mid-rank, 100 · (cdf[r−1] + cdf[r]) / 2, so a
 * score shared by many sits in the middle of them. Scaled scores put that
 * percentile on an IQ-style scale: 100 + 15 · Φ⁻¹(p), between 55 and 145.
 *
 * The composite is the mean of the four section z-scores, placed against
 * the norm sample's own composite distribution (`composite.quantiles`, the
 * mean-z at every half percentile), then scaled the same way. That way the
 * composite's spread is the sample's, not an assumed one, and someone who is
 * average everywhere scores 100, not more or less.
 */

export interface NormTable {
  /** cdf[r] = P(raw ≤ r) for r = 0 … max. */
  cdf: number[];
}

export interface Norms {
  v: 1;
  seed: string;
  n: number;
  method: string;
  sections: Record<CogSection, NormTable>;
  composite: { quantiles: number[] };
}

export interface SectionScore {
  raw: number;
  percentile: number;
  scaled: number;
}

export interface CognitiveScores {
  sections: Record<CogSection, SectionScore>;
  composite: { score: number; percentile: number };
}

export const SCALED_MIN = 55;
export const SCALED_MAX = 145;
const PCT_MIN = 0.5;
const PCT_MAX = 99.5;

const clampPct = (p: number) => Math.min(PCT_MAX, Math.max(PCT_MIN, p));

/** Percentile (0.5–99.5) of a raw score against a table; above the table counts as its top. */
export function percentileOf(table: NormTable, raw: number): number {
  const r = Math.max(0, Math.min(table.cdf.length - 1, Math.round(raw)));
  const below = r > 0 ? table.cdf[r - 1] : 0;
  const atOrBelow = table.cdf[r];
  return clampPct(Math.round(10_000 * ((below + atOrBelow) / 2)) / 100);
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function probit(p: number): number {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (q < low) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - low) {
    const t = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  const t = q - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 7.5e-8). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? 1 - tail : tail;
}

/** A percentile on the mean-100, SD-15 scale. */
export function scaledOf(percentile: number): number {
  return Math.round(Math.min(SCALED_MAX, Math.max(SCALED_MIN, 100 + 15 * probit(clampPct(percentile) / 100))));
}

/** The mean z-score behind four section percentiles: the composite's raw value. */
export function compositeRaw(percentiles: Record<CogSection, number>): number {
  return COG_SECTIONS.reduce((s, k) => s + probit(clampPct(percentiles[k]) / 100), 0) / COG_SECTIONS.length;
}

/** Percentile of a composite raw against the sample's half-percentile quantiles (linear between them). */
export function compositePercentile(quantiles: readonly number[], raw: number): number {
  const step = 100 / (quantiles.length - 1);
  if (raw <= quantiles[0]) return PCT_MIN;
  if (raw >= quantiles[quantiles.length - 1]) return PCT_MAX;
  let i = 0;
  while (quantiles[i + 1] < raw) i++;
  const span = quantiles[i + 1] - quantiles[i];
  const frac = span > 0 ? (raw - quantiles[i]) / span : 0.5;
  return clampPct((i + frac) * step);
}

/** Where a knowledge PokéIQ (mean 100, SD 15 by construction) sits among trainers. */
export function knowledgePercentile(pokeiq: number): number {
  return clampPct(100 * phi((pokeiq - 100) / 15));
}

export function scoreTest(raw: Record<CogSection, number>, norms: Norms): CognitiveScores {
  const sections = {} as Record<CogSection, SectionScore>;
  const pcts = {} as Record<CogSection, number>;
  for (const k of COG_SECTIONS) {
    const percentile = percentileOf(norms.sections[k], raw[k]);
    pcts[k] = percentile;
    sections[k] = { raw: Math.max(0, Math.round(raw[k])), percentile, scaled: scaledOf(percentile) };
  }
  const percentile = compositePercentile(norms.composite.quantiles, compositeRaw(pcts));
  return { sections, composite: { score: scaledOf(percentile), percentile } };
}

/** "88th", "1st", "22nd". */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : v % 10 === 1 ? "st" : v % 10 === 2 ? "nd" : v % 10 === 3 ? "rd" : "th";
  return `${v}${suffix}`;
}
