import type { WorldPlan } from "./world";

/**
 * Where everything stands in Castelia City at dusk (Pokémon Sizes' second
 * city): our own design in the spirit of Unova's great harbour city, laid
 * round the same line as Lumiose, so the camera, the glide, the finale and
 * the videos work unchanged.
 *
 * - The line starts at the waterfront and walks up the main street (+x,
 *   z = 0): a deep canyon of skyscrapers on a grid of blocks, cut by cross
 *   streets; Narrow Street (an old brick alley) and Mall Street (a lit
 *   pedestrian street) open off its far side near the start.
 * - It ends in Central Plaza (the plan's plaza): the giants stand on the
 *   ring among the towers, a ring of skyscrapers inside it round the
 *   fountain at the centre and another round the plaza's edge.
 * - The waterfront: a promenade where the main street begins, and along
 *   the north shore the piers into the bay, Liberty Garden's lighthouse
 *   island offshore and the long Skyarrow Bridge reaching out over the
 *   water, all where the finale looks. The city is a peninsula: water on
 *   three sides, the land running on into the haze.
 *
 * Pure and unit-tested; the scene (components/sizes/scene/castelia) builds
 * what this plans.
 */

/** The main street's cross-section (|z| in metres from the line). */
export const CASTELIA_STREET = {
  /** Paved median the line stands on. */
  median: 7,
  /** Carriageway out to the kerb. */
  road: 22,
  /** Facades (the canyon walls). */
  facade: 30,
} as const;

/** The block grid: pitch along x and z, and the width of a cross street. */
export const GRID = { px: 112, pz: 100, street: 18 } as const;

export type FacadeKind = 0 | 1 | 2 | 3 | 4 | 5;
/** 0 blue glass curtain wall, 1 warm stone with punched windows, 2 white ribbon windows, 3 dark glass with gold piers, 4 green glass, 5 old brick. */
export const FACADE_KINDS = 6;

export type Crown = "flat" | "spire" | "stepped" | "lit" | "slant";

export interface Tower {
  /** Centre of the footprint, its size (w along the tower's own x, d along its z) and turn (radians, about y). */
  x: number;
  z: number;
  w: number;
  d: number;
  yaw: number;
  /** Roof height (m, without a spire) and its podium's height (0: none). */
  h: number;
  podium: number;
  /** Setbacks above the podium (1–3 tiers). */
  tiers: number;
  /** Round towers are drawn as a 12-sided prism. */
  round: boolean;
  kind: FacadeKind;
  crown: Crown;
  seed: number;
  /** Where it stands: on the main street (near: the camera's side), round the plaza, inside the ring, a block of the grid. */
  role: "far" | "near" | "plaza" | "inner" | "block" | "narrow" | "harbour";
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface CasteliaPlan {
  towers: Tower[];
  /** Raised pavements (each block's footprint plus its pavement). */
  blocks: Rect[];
  /** Land: x from west (the waterfront) to east, z from south to north; water all round but the east. */
  land: Rect;
  /** The waterfront promenade between the shore and the first blocks. */
  promenade: Rect;
  /** Each pier from where it leaves the quay (x, z), out over the water in direction `dir` (radians from +x towards +z), `len` long. */
  piers: { x: number; z: number; dir: number; len: number; w: number; sheds: boolean }[];
  island: { x: number; z: number; r: number };
  bridge: { x0: number; z0: number; x1: number; z1: number; deck: number; width: number; pylons: number[] };
  /** The cross streets that open off the far side of the main street (x of their middle, width). */
  mall: { x: number; w: number; z0: number; z1: number };
  narrow: { x: number; w: number; z0: number; z1: number };
  /** Central Plaza: the fountain's plaza at the ring's centre, the inner towers round it, the plaza's own edge. */
  centre: { x: number; z: number; r: number };
  inner: { r0: number; r1: number };
  edge: number;
  /** Streets the cars drive on (centre lines). */
  roads: { x0: number; z0: number; x1: number; z1: number; w: number }[];
}

/** The ring's radius a plan without big figures still keeps round its plaza's centre (world.ts RING_MIN_R). */
const RING_R = 150;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Distance from (x, z) to the nearest point of a rectangle (0 inside). */
export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Castelia round a line's plan. `detail` (0..1, QUALITY.blocks) thins the
 * far blocks on lighter qualities; the main street, the plaza and the
 * waterfront are always whole.
 */
export function planCastelia(plan: WorldPlan, detail = 1): CasteliaPlan {
  const S = CASTELIA_STREET;
  const C = { x: plan.plaza.cx, z: plan.plaza.cz };
  const R = plan.plaza.r;
  const ringR = plan.ring?.r ?? RING_R;
  const towers: Tower[] = [];
  const blocks: Rect[] = [];
  const roads: CasteliaPlan["roads"] = [];
  let seed = 1;

  // ---- The waterfront, the land and the water.
  // West of the main street's start, and of the plaza (a big ring's plaza reaches further west than the street).
  const shoreW = Math.min(plan.x0 - 70, C.x - R - 110);
  const firstX = shoreW + 80;
  const zN = Math.max(C.z + R + 260, 560);
  const zS = Math.min(C.z - R - 210, -330);
  const xE = C.x + R + 4000;
  const land: Rect = { x0: shoreW, x1: xE, z0: zS, z1: zN };
  // Where the Skyarrow Bridge leaves the north shore (its abutment stands on the last row of the grid).
  const bx0 = shoreW + 420, bz0 = zN - 30;
  const promenade: Rect = { x0: shoreW, x1: firstX, z0: zS, z1: zN };

  // ---- Central Plaza: the fountain's plaza, the ring of towers inside the giants' ring, the plaza's edge.
  const centreR = 66;
  const inner = { r0: centreR + 10, r1: Math.max(centreR + 34, ringR - 28) };
  const edge = R + 12;
  // The camera's side opened up (a giant on the straight, in a stat order): nothing stands there.
  const openZ = plan.open ? -plan.open : -Infinity;

  // ---- The block grid: cross streets every GRID.px from the waterfront, rows every GRID.pz off the main street.
  const cols: [number, number][] = [];
  for (let x = firstX; x < C.x + R + 1400; x += GRID.px) cols.push([x, x + GRID.px - GRID.street]);
  const rowsN: [number, number][] = [];
  for (let z = S.facade; z + 30 < zN - 40; z += GRID.pz) rowsN.push([z, Math.min(z + GRID.pz - GRID.street, zN - 40)]);
  const rowsS: [number, number][] = [];
  for (let z = -S.facade; z - 30 > zS + 40; z -= GRID.pz) rowsS.push([Math.max(z - GRID.pz + GRID.street, zS + 40), z]);

  // Narrow Street and Mall Street: the far side's first cross streets past the line's start.
  const after = (x: number) => cols.findIndex(([a]) => a > x);
  const nk = Math.max(0, after(plan.lineStart + 30) - 1);
  const ncol = cols[nk];
  const narrow = { x: (ncol[0] + ncol[1]) / 2, w: 8, z0: S.facade, z1: rowsN[Math.min(1, rowsN.length - 1)][1] };
  const mk = Math.min(cols.length - 1, nk + 2);
  const mall = { x: cols[mk][0] - GRID.street / 2, w: GRID.street, z0: S.facade, z1: rowsN[Math.min(2, rowsN.length - 1)][1] };

  /** Lots to leave empty: the plaza with its towers and the street round them, the camera's open side. */
  const clearOf = (r: Rect) => {
    if (rectDistance(r, C.x, C.z) < edge + 40 + GRID.street) return false;
    if (openZ > -Infinity && r.z1 > openZ && r.z0 < 0) return false;
    if (rectDistance(r, bx0, bz0) < 36) return false;
    return true;
  };

  /** Fills a lot with a tower (or two). */
  const lot = (r: Rect, role: Tower["role"], hMin: number, hMax: number, flush: boolean, tall = false) => {
    const rr = rng(seed++ * 7919 + 17);
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const ins = flush ? 0.4 : 1 + rr() * 4;
    // A few supertalls stand out of the main street's walls.
    const h = (hMin + (hMax - hMin) * Math.pow(rr(), 1.35)) * (tall && rr() < 0.06 ? 1.45 : 1);
    const kind = role === "narrow" ? 5 : (Math.floor(rr() * 5) as FacadeKind);
    const round = !flush && rr() < 0.12 && w > 34 && d > 34;
    const crowns: Crown[] = ["flat", "flat", "stepped", "spire", "lit", "slant", "lit"];
    const crown = role === "narrow" || role === "harbour" ? "flat" : crowns[Math.floor(rr() * crowns.length)];
    towers.push({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: w - ins * 2, d: d - ins * 2, yaw: 0, h, podium: h > 70 && rr() < 0.6 ? 10 + rr() * 14 : 0, tiers: h > 120 ? 2 + Math.floor(rr() * 2) : h > 60 ? 1 + Math.floor(rr() * 2) : 1, round, kind, crown, seed: seed * 31 + 7, role });
  };

  /** A block: one tower, two side by side or four, flush with the streets round it. */
  const block = (b: Rect, role: Tower["role"], hMin: number, hMax: number, tall: boolean, key: number) => {
    // Seeded by where the block is, so thinning far blocks never changes the others.
    seed = key * 8 + 1;
    blocks.push({ x0: b.x0 - 4, x1: b.x1 + 4, z0: b.z0 - 4, z1: b.z1 + 4 });
    const rr = rng(seed * 104729 + 3);
    const split = rr();
    const parts: Rect[] = [];
    const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
    if (split < 0.3) parts.push(b);
    else if (split < 0.65) parts.push({ ...b, x1: mx - 3 }, { ...b, x0: mx + 3 });
    else parts.push({ x0: b.x0, x1: mx - 3, z0: b.z0, z1: mz - 3 }, { x0: mx + 3, x1: b.x1, z0: b.z0, z1: mz - 3 }, { x0: b.x0, x1: mx - 3, z0: mz + 3, z1: b.z1 }, { x0: mx + 3, x1: b.x1, z0: mz + 3, z1: b.z1 });
    for (const p of parts) if (clearOf(p)) lot(p, role, hMin, hMax, true, tall);
  };

  // Main street and grid. Heights fall away from the main street and the plaza; the waterfront's first column is low (harbour buildings).
  for (let ci = 0; ci < cols.length; ci++) {
    const [a, b] = cols[ci];
    for (const [rows, side] of [[rowsN, 1], [rowsS, -1]] as const) {
      for (let ri = 0; ri < rows.length; ri++) {
        const [z0, z1] = rows[ri];
        const r: Rect = { x0: a, x1: b, z0, z1 };
        const distPlaza = Math.max(0, rectDistance(r, C.x, C.z) - edge);
        // The skyline rises from the waterfront to Central Plaza and falls away behind the main street: from the finale's height the city steps down to the bay.
        const rise = clamp((Math.min(a, C.x) - firstX) / Math.max(200, C.x - R - firstX), 0, 1);
        // North of the plaza the city stays lower (the finales look that way, over it to the bay).
        const core = Math.pow(rise, 0.9) * Math.exp(-ri / 2.6) * 0.75 + Math.exp(-distPlaza / 420) * 0.5 * (z0 > C.z + R * 0.3 ? 0.4 : 1);
        // Far blocks thin out on lighter qualities (the haze takes them anyway).
        const far = ri >= 2 && distPlaza > 300;
        if (far && detail < 1) {
          const keep = rng(ci * 977 + ri * 131 + (side > 0 ? 1 : 2))();
          if (keep > 0.35 + 0.65 * detail) continue;
        }
        const harbour = ci === 0 && ri < 2;
        const role: Tower["role"] = harbour ? "harbour" : ri === 0 ? (side > 0 ? "far" : "near") : "block";
        // The waterfronts (the first column, the row on the north shore) are low: warehouses and old offices by the water.
        const shore = ci === 0 || (side > 0 && z1 > zN - 150);
        const hMax = shore ? 34 : 34 + 196 * Math.min(1, core);
        const hMin = shore ? 12 : 18 + 46 * Math.min(1, core);
        // Narrow Street: an old brick alley through the far side's first rows.
        if (ci === nk && side > 0 && ri <= 1) {
          blocks.push({ x0: a - 4, x1: b + 4, z0: z0 - 4, z1: z1 + 4 });
          seed = ((ci * 64 + ri) * 2) * 8 + 1;
          const nx0 = narrow.x - narrow.w / 2, nx1 = narrow.x + narrow.w / 2;
          for (const p of [{ x0: a, x1: nx0, z0, z1 }, { x0: nx1, x1: b, z0, z1 }]) {
            // Old buildings of five to nine floors, three or four to a side.
            const n = 3;
            for (let k = 0; k < n; k++) {
              const q = { x0: p.x0, x1: p.x1, z0: z0 + ((z1 - z0) * k) / n + (k ? 1 : 0), z1: z0 + ((z1 - z0) * (k + 1)) / n - (k < n - 1 ? 1 : 0) };
              if (clearOf(q)) lot(q, "narrow", 18, 32, true);
            }
          }
          continue;
        }
        block(r, role, hMin, hMax, !shore && rise > 0.4, (ci * 64 + ri) * 2 + (side > 0 ? 0 : 1));
      }
    }
  }

  // The plaza's edge: a ring of towers facing it, open where the main street comes in and at three avenues.
  const entry = Math.atan2(0 - C.z, plan.x1 - C.x);
  const gaps: [number, number][] = [];
  {
    const half = S.facade + 6;
    const s0 = Math.asin(clamp((half) / edge, -1, 1));
    gaps.push([entry - s0 - 0.04, entry + s0 + 0.04]);
    for (let k = 1; k <= 3; k++) {
      const a = entry + (k * Math.PI * 2) / 4;
      const h = Math.asin(Math.min(1, 14 / edge));
      gaps.push([a - h, a + h]);
    }
  }
  const inGap = (a: number) => gaps.some(([g0, g1]) => { const k = norm(a - g0); return k >= 0 && k <= g1 - g0; });
  seed = 1_000_003;
  const ringTowers = (r0: number, depth: number, role: Tower["role"], hMin: number, hMax: number, spokes: number[], spokeW: number) => {
    const rm = r0 + depth / 2;
    const n = Math.max(6, Math.round((Math.PI * 2 * rm) / 46));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + entry;
      const span = (Math.PI * 2 * rm) / n;
      if (role === "plaza" && (inGap(a - (span * 0.45) / rm) || inGap(a + (span * 0.45) / rm) || inGap(a))) continue;
      if (spokes.some((s) => Math.abs(norm(a - s + Math.PI) - Math.PI) * rm < spokeW + span / 2)) continue;
      const rr = rng(seed++ * 6151 + 5);
      const x = C.x + Math.cos(a) * rm, z = C.z + Math.sin(a) * rm;
      // Clear of the main street where it comes into the plaza (it may meet the ring at a slant).
      if (x < plan.x1 + 80 && Math.abs(z) - Math.hypot(span, depth) / 2 < S.facade + 2) continue;
      if (z - depth / 2 < openZ + 10 && openZ > -Infinity && z < 0) continue;
      // The plaza's far side from where the finales look (north round to west) is lower, so the bay shows over it.
      const far = role === "plaza" ? 1 - smoothstep(70, 100, Math.abs((((a * 180) / Math.PI - 125 + 540) % 360) - 180)) : 0;
      const h = (hMin * (1 - 0.4 * far)) + (hMax * (1 - 0.55 * far) - hMin * (1 - 0.4 * far)) * Math.pow(rr(), 1.1);
      const crowns: Crown[] = ["spire", "lit", "stepped", "slant", "lit", "flat"];
      towers.push({ x, z, w: span - 7, d: depth, yaw: Math.PI / 2 - a, h, podium: rr() < 0.5 ? 12 + rr() * 10 : 0, tiers: 2 + Math.floor(rr() * 2), round: rr() < 0.18, kind: Math.floor(rr() * 5) as FacadeKind, crown: crowns[Math.floor(rr() * crowns.length)], seed: seed * 17 + 3, role });
    }
  };
  ringTowers(edge, 40, "plaza", 60, 170, [], 0);
  // Inside the giants' ring, round the fountain: the tallest of the skyline (open on four walks from the ring to the fountain).
  const walks = [0, 1, 2, 3].map((k) => entry + Math.PI / 4 + (k * Math.PI) / 2);
  // First, round the fountain, four slender landmark towers between the walks (the city's tallest: seen from the finale behind the giants, as a landmark is in Lumiose); a bigger ring has rings of towers out from them.
  {
    const rm = Math.min(inner.r0 + 22, (inner.r0 + inner.r1) / 2);
    const side = Math.min(34, (inner.r1 - inner.r0) * 0.9);
    if (inner.r1 - inner.r0 >= 24) {
      for (let k = 0; k < 4; k++) {
        const a = entry + (k * Math.PI) / 2;
        const rr = rng(seed++ * 6151 + 11);
        const crowns: Crown[] = ["spire", "lit", "spire", "stepped"];
        towers.push({ x: C.x + Math.cos(a) * rm, z: C.z + Math.sin(a) * rm, w: side, d: side, yaw: Math.PI / 2 - a, h: 230 + rr() * 90, podium: 0, tiers: 3, round: k % 2 === 1, kind: ([0, 3, 4, 0] as FacadeKind[])[k], crown: crowns[k], seed: seed * 17 + 5, role: "inner" });
      }
    }
  }
  for (let r0 = inner.r0 + 34 + GRID.street, k = 1; inner.r1 - r0 >= 24; r0 += 50 + GRID.street, k++) ringTowers(r0, Math.min(50, inner.r1 - r0), "inner", Math.max(70, 160 - k * 22), Math.max(120, 300 - k * 40), walks, 10);

  // ---- Waterfront: five piers into the bay, the island and the bridge.
  // The piers line the north shore between the waterfront and the bridge, out into the bay where the finale looks; Liberty Garden lies offshore from them.
  const piers: CasteliaPlan["piers"] = [0, 1, 2, 3, 4].map((k) => ({ x: C.x - 460 + k * 78, z: zN - 2, dir: Math.PI / 2, len: k === 2 ? 290 : 220, w: k === 2 ? 32 : 26, sheds: k !== 2 }));
  const island = { x: C.x - 260, z: zN + 620, r: 92 };
  const bAng = (45 * Math.PI) / 180;
  const bLen = 1900;
  const bridge = { x0: bx0, z0: bz0, x1: bx0 + Math.cos(bAng) * bLen, z1: bz0 + Math.sin(bAng) * bLen, deck: 46, width: 30, pylons: [0.34, 0.68] };

  // ---- Roads (cars): the main street's two carriageways and the cross streets near it.
  roads.push({ x0: firstX, z0: -(S.median + S.road) / 2, x1: plan.x1 - 6, z1: -(S.median + S.road) / 2, w: S.road - S.median });
  roads.push({ x0: firstX, z0: (S.median + S.road) / 2, x1: plan.x1 - 6, z1: (S.median + S.road) / 2, w: S.road - S.median });
  for (const [a] of cols.slice(1)) {
    const x = a - GRID.street / 2;
    if (x > plan.x1 - 30) break;
    if (Math.abs(x - mall.x) < 2) continue;
    roads.push({ x0: x, z0: -S.facade - 2, x1: x, z1: -S.facade - 220, w: GRID.street });
    roads.push({ x0: x, z0: S.facade + 2, x1: x, z1: S.facade + 220, w: GRID.street });
  }

  return { towers, blocks, land, promenade, piers, island, bridge, mall, narrow, centre: { x: C.x, z: C.z, r: centreR }, inner, edge, roads };
}

/** Deterministic pseudo-random numbers (mulberry32): the same city on every load and in every video. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a: number, b: number, x: number): number {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
}

function norm(a: number): number {
  let x = a % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x;
}
