import { GEO_FALLOFF } from "@/lib/geo-types";
import { HUNT_MAX_ROUND_SCORE, type HuntRegionId } from "./types";

/**
 * Pokémon Hunt's scoring: pure, so the server grades with it and the tests
 * prove it. Every distance is in world-map pixels (a region's map is a crop of
 * the world map, so a pixel is the same size on both); only the curve's
 * length scale (the map's diagonal) differs between the world and a region.
 */

export type Point = [number, number];

/** A real spot as the scorer sees it: its region and its area, in world pixels. */
export interface ScoreSpot {
  region: HuntRegionId;
  area: Point[];
}

export interface ScoreMap {
  /** The map's diagonal in world pixels: the curve's length scale. */
  diagonal: number;
  /** Within this many pixels of a spot's area is full points (PokéGuessr's half a town-map square). */
  perfectPx: number;
}

/** Pixels from a pin to the nearest point of an area. */
export function areaDistance(pin: Point, area: readonly Point[]): number {
  let best = Infinity;
  for (const [x, y] of area) best = Math.min(best, Math.hypot(pin[0] - x, pin[1] - y));
  return best;
}

/** PokéGuessr's curve, `max · e^(−10 · d / D)`, full points within perfectPx. */
export function curveScore(map: ScoreMap, px: number, max: number): number {
  if (!Number.isFinite(px)) return 0;
  if (px <= map.perfectPx) return max;
  return max * Math.exp((-GEO_FALLOFF * px) / map.diagonal);
}

export interface PinMatch {
  /** The region the pin was matched to, or null (no region left for it). */
  region: HuntRegionId | null;
  /** The index (into the spots given) of the nearest spot in that region. */
  spot: number | null;
  distancePx: number;
  score: number;
}

export interface MatchResult {
  pins: PinMatch[];
  /** Whole points: the sum of the pins' points, rounded once. */
  total: number;
}

/**
 * Matches pins to distinct regions to score the most, and scores each pin
 * against the nearest spot of its region. `slots` is how many pins the round
 * takes: each is worth HUNT_MAX_ROUND_SCORE / slots, and pins past the slots
 * are ignored (the client is held to them). Every assignment is tried, which
 * is cheap at three pins and ten regions, so the result is optimal and the
 * pins' order never matters.
 */
export function matchPins(map: ScoreMap, pins: readonly Point[], spots: readonly ScoreSpot[], slots: number): MatchResult {
  const share = HUNT_MAX_ROUND_SCORE / Math.max(1, slots);
  const used = pins.slice(0, Math.max(0, slots));
  const regions = [...new Set(spots.map((s) => s.region))];
  // Each pin's best spot (and its points) in each region.
  const best = used.map((pin) =>
    regions.map((region) => {
      let spot = -1;
      let px = Infinity;
      spots.forEach((s, i) => {
        if (s.region !== region) return;
        const d = areaDistance(pin, s.area);
        if (d < px) [px, spot] = [d, i];
      });
      return { spot, px, score: curveScore(map, px, share) };
    })
  );
  let bestTotal = -1;
  let bestPick: number[] = [];
  const pick: number[] = [];
  const taken = new Set<number>();
  const walk = (i: number, sum: number) => {
    if (i === used.length) {
      if (sum > bestTotal + 1e-9) [bestTotal, bestPick] = [sum, [...pick]];
      return;
    }
    let any = false;
    for (let r = 0; r < regions.length; r++) {
      if (taken.has(r)) continue;
      any = true;
      taken.add(r);
      pick.push(r);
      walk(i + 1, sum + best[i][r].score);
      pick.pop();
      taken.delete(r);
    }
    // More pins than regions: this pin goes unmatched.
    if (!any) {
      pick.push(-1);
      walk(i + 1, sum);
      pick.pop();
    }
  };
  walk(0, 0);
  const raw = used.map((_, i) => {
    const r = bestPick[i];
    return r === undefined || r < 0 ? null : { region: regions[r], ...best[i][r] };
  });
  // Whole points per pin that add up to the rounded total (largest remainder), so three perfect pins make 5,000.
  const total = Math.round(Math.max(0, bestTotal));
  const floors = raw.map((m) => (m ? Math.floor(m.score) : 0));
  let left = total - floors.reduce((s, x) => s + x, 0);
  const order = raw.map((m, i) => ({ i, frac: m ? m.score - Math.floor(m.score) : -1 })).sort((a, b) => b.frac - a.frac);
  for (const { i, frac } of order) {
    if (left <= 0 || frac < 0) break;
    floors[i] += 1;
    left -= 1;
  }
  const out = raw.map((m, i): PinMatch =>
    m ? { region: m.region, spot: m.spot, distancePx: Math.round(m.px * 10) / 10, score: floors[i] } : { region: null, spot: null, distancePx: Infinity, score: 0 }
  );
  return { pins: out, total };
}
