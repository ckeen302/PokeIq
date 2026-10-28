import { Rng } from "@/lib/rng";
import { LOOKALIKES, TYPES } from "./materials";
import type { Glyph, SpeedRow } from "./types";

/**
 * Processing speed: 75 seconds of rows. Each row shows a target (a type
 * icon or a Pokémon) and six candidates, one to three of which match; tap
 * every match. The row advances once every match is found (or on skip).
 *
 * Raw score = hits − false taps (never below 0): correct per 75 s with an
 * accuracy penalty. Shown as correct per second on the result page.
 */

export const SPEED_MS = 75_000;
export const SPEED_ROW = 6;

const glyphKey = (g: Glyph) => (g.k === "type" ? `t:${g.t}` : `m:${g.id}`);
export const sameGlyph = (a: Glyph, b: Glyph) => glyphKey(a) === glyphKey(b);

export function speedRow(seed: string, index: number): SpeedRow {
  const rng = new Rng(`speed:${seed}:${index}`);
  const matches = rng.int(1, 3);
  let target: Glyph;
  let pool: Glyph[];
  if (index % 2 === 0) {
    const types = rng.sample(TYPES, 5);
    target = { k: "type", t: types[0] };
    pool = types.slice(1).map((t) => ({ k: "type", t }));
  } else {
    const family = rng.pick(LOOKALIKES);
    const ids = rng.shuffle(family);
    target = { k: "mon", id: ids[0] };
    pool = ids.slice(1).map((id) => ({ k: "mon", id }));
  }
  const row: Glyph[] = [];
  for (let i = 0; i < matches; i++) row.push(target);
  while (row.length < SPEED_ROW) row.push(rng.pick(pool));
  const shuffled = rng.shuffle(row);
  return { id: `sr:${seed}:${index}`, target, row: shuffled, matches: shuffled.map((g, i) => (sameGlyph(g, target) ? i : -1)).filter((i) => i >= 0) };
}

export function speedRaw(hits: number, falseTaps: number): number {
  return Math.max(0, hits - falseTaps);
}
