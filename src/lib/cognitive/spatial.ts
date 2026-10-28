import { Rng } from "@/lib/rng";
import { MON_IDS } from "./materials";
import type { Level, PathItem, PileItem, RotationItem } from "./types";

/**
 * Spatial items: mental rotation of a sprite (the one that is turned, not
 * mirrored), the shortest route on a small generated map, and counting the
 * Poké Balls in a stacked pile, hidden ones included.
 */

const ROTATION_MS = 40_000;
const PATH_MS = 45_000;
const PILE_MS = 45_000;
export const SPATIAL_OPTIONS = 6;

/** Rotation angles by level: small turns are easy, near-180 ones hard. */
const ANGLES: Record<Level, number[]> = { 1: [45, 315], 2: [90, 270], 3: [120, 240], 4: [150, 210], 5: [135, 180, 225] };

export function rotationItem(seed: string, level: Level): RotationItem {
  const rng = new Rng(`rot:${seed}`);
  const monId = rng.pick(MON_IDS);
  const rot = rng.pick(ANGLES[level]);
  const n = level >= 4 ? 6 : 4;
  // Distractors: the mirror image at the same and nearby angles.
  const mirrors = rng.shuffle([rot, (rot + 45) % 360, (rot + 315) % 360, (rot + 90) % 360, (rot + 270) % 360, (rot + 180) % 360]).slice(0, n - 1);
  const options = rng.shuffle([{ rot, flip: false }, ...mirrors.map((r) => ({ rot: r, flip: true }))]);
  return { kind: "rotation", id: `rt:${seed}`, level, timeMs: ROTATION_MS, rule: `turned ${rot}°`, monId, options, answer: options.findIndex((o) => !o.flip) };
}

/** Breadth-first shortest path on the grid, or -1. */
export function shortestPath(size: number, walls: readonly boolean[], start: number, goal: number): number {
  const dist = new Array<number>(size * size).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (cur === goal) return dist[cur];
    const r = Math.floor(cur / size);
    const c = cur % size;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const nxt = nr * size + nc;
      if (walls[nxt] || dist[nxt] >= 0) continue;
      dist[nxt] = dist[cur] + 1;
      queue.push(nxt);
    }
  }
  return -1;
}

const PATH_SIZE: Record<Level, number> = { 1: 4, 2: 4, 3: 5, 4: 5, 5: 6 };
const PATH_WALLS: Record<Level, number> = { 1: 0.18, 2: 0.28, 3: 0.3, 4: 0.34, 5: 0.36 };

export function pathItem(seed: string, level: Level): PathItem {
  const rng = new Rng(`path:${seed}`);
  const size = PATH_SIZE[level];
  for (let attempt = 0; ; attempt++) {
    const walls = Array.from({ length: size * size }, () => rng.chance(PATH_WALLS[level]));
    const start = rng.int(0, size - 1) * size; // left edge
    const goal = rng.int(0, size - 1) * size + size - 1; // right edge
    walls[start] = walls[goal] = false;
    const steps = shortestPath(size, walls, start, goal);
    const manhattan = Math.abs(Math.floor(start / size) - Math.floor(goal / size)) + size - 1;
    // A real detour at the harder levels, so counting squares isn't enough.
    if (steps < 0 || (level >= 2 && steps === manhattan && attempt < 200)) continue;
    const options = pickNumbers(rng, steps, [steps + 2, steps - 2, steps + 4, steps - 4, manhattan, steps + 6, steps - 6, steps + 8], 1);
    return { kind: "path", id: `pt:${seed}`, level, timeMs: PATH_MS, rule: `${steps} steps`, size, walls, start, goal, options, answer: options.indexOf(steps) };
  }
}

/** Options: the answer and five distinct distractors (from `near` first), shuffled. */
function pickNumbers(rng: Rng, answer: number, near: number[], min: number): number[] {
  const seen = new Set<number>([answer]);
  const out: number[] = [];
  for (const v of [...near, answer + 1, answer - 1, answer + 3, answer - 3, answer + 5, answer + 7, answer + 9]) {
    if (v < min || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length === SPATIAL_OPTIONS - 1) break;
  }
  return rng.shuffle([answer, ...out]);
}

const PILES: Record<Level, [number, number][][]> = {
  1: [[[2, 2], [1, 1]], [[3, 1], [2, 1]], [[2, 3], [1, 2]]],
  2: [[[3, 3], [2, 2], [1, 1]], [[3, 2], [2, 1]], [[4, 2], [3, 1]]],
  3: [[[4, 4], [3, 3], [2, 2], [1, 1]], [[4, 3], [3, 2], [2, 1]], [[3, 3], [2, 2]]],
  4: [[[5, 4], [4, 3], [3, 2], [2, 1]], [[4, 4], [3, 3], [2, 2]], [[5, 3], [4, 2], [3, 1]]],
  5: [[[5, 5], [4, 4], [3, 3], [2, 2], [1, 1]], [[6, 4], [5, 3], [4, 2], [3, 1]], [[5, 4], [4, 3], [3, 2]]],
};

export const pileCount = (layers: readonly [number, number][]) => layers.reduce((s, [r, c]) => s + r * c, 0);

export function pileItem(seed: string, level: Level): PileItem {
  const rng = new Rng(`pile:${seed}`);
  const layers = rng.pick(PILES[level]);
  const total = pileCount(layers);
  const visible = layers.reduce((s, [r, c]) => s + r + c - 1, 0) + layers.length - 1;
  const options = pickNumbers(rng, total, [total - 1, total + 1, total - layers[0][0], total + layers[0][1], visible, total - 2, total + 2], 1);
  return { kind: "pile", id: `pl:${seed}`, level, timeMs: PILE_MS, rule: `${total} balls`, layers, options, answer: options.indexOf(total) };
}
