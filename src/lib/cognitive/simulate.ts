import { Rng } from "@/lib/rng";
import { START_LEVEL, rawScore, stepLevel } from "./adaptive";
import { fluidKind, memoryKind, MAX_RAW, PLAN, spatialKind } from "./plan";
import { compositeRaw, percentileOf, type Norms } from "./scoring";
import { COG_SECTIONS, type CogSection, type Level } from "./types";

/**
 * Seeded norms: a synthetic sample of trainers taking the test.
 *
 * Each trainer has a general ability g ~ N(0, 1) and a section ability
 * θ_s = ρ·g + √(1−ρ²)·ε_s (ρ = 0.72, so sections correlate about 0.5, as
 * cognitive batteries do). Items follow a three-parameter logistic model:
 * P(right) = c + (1−c) / (1 + e^(−a(θ−b))), with difficulty b fixed by the
 * item's level (−1.6 … +1.6), discrimination a = 1.3, a guessing floor c of
 * one over the options (spans have almost none), and a 4% chance of a lapse
 * on any item. The adaptive sections are played out exactly as the test
 * plays them (src/lib/cognitive/adaptive.ts, plan.ts). The speed section's
 * hits are Poisson with mean 38·e^(0.3θ) and its false taps Poisson with
 * mean 2·e^(−0.5θ); the raw score is hits − false taps.
 *
 * The output is each section's raw-score CDF and the half-percentile
 * quantiles of the composite (the mean section z-score), see scoring.ts.
 * `scripts/cognitive-norms.ts` writes it to src/data/cognitive-norms.json;
 * real results logged anonymously (migration 0044) can re-fit it later.
 */

export const NORM_METHOD =
  "Synthetic sample: g ~ N(0,1); section ability = 0.72·g + 0.694·ε; 3PL items (a = 1.3, b by level −1.6…+1.6, c = 1/options) with 4% lapses, " +
  "adaptive stepping as in the test; speed hits ~ Poisson(38·e^(0.3θ)), false taps ~ Poisson(2·e^(−0.5θ)), raw = hits − false taps. " +
  "Tables: per-section raw CDF, composite = mean section z, half-percentile quantiles.";

const RHO = 0.72;
const DISCRIMINATION = 1.3;
const LAPSE = 0.04;
const LEVEL_B: Record<Level, number> = { 1: -1.6, 2: -0.8, 3: 0, 4: 0.8, 5: 1.6 };

/** Guessing floor and an extra difficulty offset per item kind. */
const KINDS: Record<string, { c: number; offset: number }> = {
  matrix: { c: 1 / 6, offset: 0 },
  number: { c: 1 / 6, offset: 0.1 },
  forward: { c: 0.02, offset: -0.2 },
  reverse: { c: 0.02, offset: 0.4 },
  arith: { c: 1 / 5, offset: 0 },
  rotation: { c: 1 / 5, offset: -0.1 },
  path: { c: 1 / 6, offset: 0.1 },
  pile: { c: 1 / 6, offset: 0.2 },
};

function gaussian(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(rng: Rng, mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

export function pRight(theta: number, level: Level, kind: string): number {
  const { c, offset } = KINDS[kind];
  const b = LEVEL_B[level] + offset;
  return (1 - LAPSE) * (c + (1 - c) / (1 + Math.exp(-DISCRIMINATION * (theta - b))));
}

const KIND_OF: Record<Exclude<CogSection, "speed">, (i: number) => string> = { fluid: fluidKind, memory: memoryKind, spatial: spatialKind };

/** One trainer's raw score in an adaptive section. */
export function playAdaptive(rng: Rng, theta: number, section: Exclude<CogSection, "speed">): number {
  const results: { level: Level; correct: boolean }[] = [];
  let level: Level = START_LEVEL;
  for (let i = 0; i < PLAN[section].items; i++) {
    const correct = rng.chance(pRight(theta, level, KIND_OF[section](i)));
    results.push({ level, correct });
    level = stepLevel(level, correct);
  }
  return rawScore(results);
}

export function playSpeed(rng: Rng, theta: number): number {
  const hits = poisson(rng, 38 * Math.exp(0.3 * theta));
  const falseTaps = poisson(rng, 2 * Math.exp(-0.5 * theta));
  return Math.max(0, Math.min(MAX_RAW.speed, hits - falseTaps));
}

export function simulateNorms(seed: string, n: number): Norms {
  const rng = new Rng(`norms:${seed}`);
  const raws: Record<CogSection, number[]> = { fluid: [], memory: [], speed: [], spatial: [] };
  for (let i = 0; i < n; i++) {
    const g = gaussian(rng);
    const theta = () => RHO * g + Math.sqrt(1 - RHO * RHO) * gaussian(rng);
    raws.fluid.push(playAdaptive(rng, theta(), "fluid"));
    raws.memory.push(playAdaptive(rng, theta(), "memory"));
    raws.speed.push(playSpeed(rng, theta()));
    raws.spatial.push(playAdaptive(rng, theta(), "spatial"));
  }
  const sections = {} as Norms["sections"];
  for (const k of COG_SECTIONS) {
    const counts = new Array<number>(MAX_RAW[k] + 1).fill(0);
    for (const r of raws[k]) counts[r]++;
    let acc = 0;
    sections[k] = { cdf: counts.map((c) => +((acc += c) / n).toFixed(6)) };
  }
  const composites: number[] = [];
  for (let i = 0; i < n; i++) {
    const pcts = {} as Record<CogSection, number>;
    for (const k of COG_SECTIONS) pcts[k] = percentileOf(sections[k], raws[k][i]);
    composites.push(compositeRaw(pcts));
  }
  composites.sort((a, b) => a - b);
  const quantiles: number[] = [];
  for (let q = 0; q <= 200; q++) {
    const pos = (q / 200) * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    quantiles.push(+(composites[lo] + (composites[hi] - composites[lo]) * (pos - lo)).toFixed(5));
  }
  return { v: 1, seed, n, method: NORM_METHOD, sections, composite: { quantiles } };
}
