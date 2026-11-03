import { KERB_R, LANE_W, LANES, RUN_OUT, START_100_X, X0, lapLength, loopPoint, measureRadius, type Distance, type TrackPoint } from "./track";

/**
 * Pool lanes: a swimmer's lane (lib/race/gait: Pokémon that can't move on
 * land) becomes a water channel set into the track, along exactly the
 * stretch that runner covers, from behind its start to the end of the
 * run-out. Pure and unit-tested; the scene draws the same regions in its
 * shaders (scene/pool.ts mirrors `poolAt`).
 *
 * The channel sits inside the lane's painted lines (they become its white
 * coping) and is as deep as its biggest swimmer needs. A swimmer too big
 * for a lane channel (water on both sides of it, its body never touching
 * the track) swims in the big pool instead: a channel inside the kerb, as
 * wide as its swimmers need, along the same stretch of the loop, each
 * swimmer abreast of where its lane would put it.
 */

/** Gap between the lane lines and the water (m): the coping. */
export const POOL_INSET = 0.045;
/** The water's surface, below the track (m). */
export const WATER_Y = -0.1;
/** A 100 m pool starts this far behind the start line (m). */
export const POOL_X0 = START_100_X - 3;

/** Lane mode: 0 dry, else the race distance's code (1: 100 m, 2: 200 m, 3: 400 m). */
export const poolMode = (d: Distance) => (d === 100 ? 1 : d === 200 ? 2 : 3);

/** Modes for lanes 1–8. */
export function poolModes(swimLanes: number[], d: Distance): number[] {
  const m = new Array<number>(LANES).fill(0);
  for (const l of swimLanes) if (l >= 1 && l <= LANES) m[l - 1] = poolMode(d);
  return m;
}

/** Water width of a lane channel (m). */
export const LANE_WATER = LANE_W - 2 * POOL_INSET;

/** How wide a swimmer's body is across its lane (m): its figure's depth, about half its longest side (lib/race/figure's sculpted back). */
export const beamOf = (w: number, h: number) => 0.5 * Math.max(w, h);

/** Water each side of a swimmer (m): room for its tail beat (about a tenth of its length) and a margin. */
export const waterAround = (w: number, h: number) => 0.1 * beamOf(w, h) + 0.06 * Math.max(w, h) + 0.05;

/** A swimmer too big for a lane channel swims in the big pool. */
export const needsBigPool = (w: number, h: number) => clipsUnderwater(h) || beamOf(w, h) + 2 * waterAround(w, h) > LANE_WATER;

/** Grass between the kerb and the big pool (m). */
export const BIG_POOL_GAP = 0.9;

/** The big pool: a channel inside the kerb, `lo` … `hi` metres across from the kerb (negative: the infield), along the stretch of the loop its race covers. */
export interface BigPool {
  mode: number;
  lo: number;
  hi: number;
  /** Where each of its swimmers swims: lane → metres across from the kerb (its middle). */
  lanes: Record<number, number>;
  /** How far round bend 1 the run-out goes (radians). */
  runOut: number;
  /** How far behind the start the water begins (m: room for the longest swimmer's body). */
  back: number;
}

/** The big pool for a race's swimmers (null if they all fit their lanes). Its swimmers side by side, the lowest lane nearest the kerb. */
export function bigPoolFor(swimmers: { lane: number; w: number; h: number }[], d: Distance): BigPool | null {
  const big = swimmers.filter((s) => needsBigPool(s.w, s.h)).sort((a, b) => a.lane - b.lane);
  if (!big.length) return null;
  const lanes: Record<number, number> = {};
  let edge = -BIG_POOL_GAP;
  for (const s of big) {
    // (Round the bends a long body's ends swing out from the curve: a chord's sagitta, len² / 8r.)
    const len = Math.max(s.w, s.h);
    const b = beamOf(s.w, s.h), m = waterAround(s.w, s.h) + (len * len) / (8 * 25);
    lanes[s.lane] = edge - m - b / 2;
    edge -= b + 2 * m;
  }
  const reach = Math.max(...big.map((s) => Math.max(s.w, s.h))) / 2 + 1;
  return { mode: poolMode(d), lo: edge, hi: -BIG_POOL_GAP, lanes, runOut: Math.min(Math.PI / 2 - 0.02, (RUN_OUT + reach) / (KERB_R + (edge - BIG_POOL_GAP) / 2)), back: reach };
}

/**
 * Where a big-pool swimmer is after `s` metres: abreast of its lane's
 * runner (the same angle round the bends, the same x on the straights),
 * `across` metres from the kerb. Past the line it carries on round bend 1
 * inside the kerb rather than straight into the run-out.
 */
export function bigPoolPoint(lane: number, d: Distance, s: number, across: number): TrackPoint {
  const r = KERB_R + across;
  if (s >= d) return loopPoint(s - d, r, r);
  if (d === 100) return { x: X0 - 100 + Math.max(0, s), z: r, dx: 1, dz: 0, bend: false };
  return loopPoint(lapLength(lane) - d + Math.max(0, s), measureRadius(lane), r);
}

/** Whether a ground point is in the big pool. The scene's shaders compute the same. */
export function bigPoolAt(x: number, z: number, g: BigPool | null): boolean {
  if (!g) return false;
  const ax = Math.abs(x);
  const across = ax <= X0 ? Math.abs(z) - KERB_R : Math.hypot(ax - X0, z) - KERB_R;
  if (across > g.lo && across < g.hi) {
    const home = ax <= X0 && z > 0;
    const runOut = x > X0 && z > 0 && Math.atan2(x - X0, z) < g.runOut;
    // (A 200 m's water starts a body's length back down the back straight.)
    const lead = g.mode === 2 && z < 0 && x >= -X0 && x < -X0 + g.back;
    if (g.mode === 3 || home || runOut || (g.mode === 2 && x < -X0) || lead) return true;
  }
  // The 100 m's straight, past bend 2 to a body's length behind its start.
  const ah = z - KERB_R;
  return g.mode === 1 && x < -X0 && x > START_100_X - g.back && ah > g.lo && ah < g.hi;
}

/** Walls of the big pool: its inner and outer edges along its stretch, and its ends. */
export function bigPoolWalls(g: BigPool, seg = 1.5): Wall[] {
  const walls: Wall[] = [];
  for (const [a, inward] of [[g.hi, -1], [g.lo, 1]] as const) {
    const r = KERB_R + a;
    const pts: Wall["pts"] = [];
    const arc = (cx: number, a0: number, a1: number) => {
      // Angle measured from +z towards +x about (cx, 0).
      const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / seg));
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        const ox = Math.sin(t), oz = Math.cos(t);
        pts.push({ x: cx + r * ox, z: r * oz, nx: ox * inward, nz: oz * inward });
      }
    };
    const line = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / seg));
      for (let i = 0; i <= n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, nx, nz });
    };
    if (g.mode === 3) {
      // The whole loop: bend 1, back straight, bend 2, home straight.
      arc(X0, 0, Math.PI);
      line(X0, -r, -X0, -r, 0, -inward);
      arc(-X0, Math.PI, 2 * Math.PI);
      line(-X0, r, X0, r, 0, inward);
    } else {
      if (g.mode === 2) {
        line(-X0 + g.back, -r, -X0, -r, 0, -inward);
        arc(-X0, Math.PI, 2 * Math.PI);
      }
      line(g.mode === 1 ? START_100_X - g.back : -X0, r, X0, r, 0, inward);
      arc(X0, 0, g.runOut);
    }
    walls.push({ pts });
  }
  if (g.mode !== 3) {
    const rIn = KERB_R + g.lo, rOut = KERB_R + g.hi;
    // The far end round bend 1, and the start: across the straight (100 m) or where bend 2 meets the back straight (200 m).
    const s = Math.sin(g.runOut), c = Math.cos(g.runOut);
    walls.push({ pts: [{ x: X0 + rIn * s, z: rIn * c, nx: -c, nz: s }, { x: X0 + rOut * s, z: rOut * c, nx: -c, nz: s }] });
    if (g.mode === 1) walls.push({ pts: [{ x: START_100_X - g.back, z: rIn, nx: 1, nz: 0 }, { x: START_100_X - g.back, z: rOut, nx: 1, nz: 0 }] });
    else walls.push({ pts: [{ x: -X0 + g.back, z: -rIn, nx: -1, nz: 0 }, { x: -X0 + g.back, z: -rOut, nx: -1, nz: 0 }] });
  }
  return walls;
}

/** Whether a ground point (x, z) is in a pool channel. The scene's shaders compute the same. */
export function poolAt(x: number, z: number, modes: number[]): boolean {
  const ax = Math.abs(x);
  const across = ax <= X0 ? Math.abs(z) - KERB_R : Math.hypot(ax - X0, z) - KERB_R;
  if (across > 0 && across < LANES * LANE_W) {
    const L = Math.floor(across / LANE_W);
    const m = modes[L] ?? 0;
    const f = across - L * LANE_W;
    if (m > 0 && f > POOL_INSET && f < LANE_W - POOL_INSET) {
      const home = ax <= X0 && z > 0;
      const bend2 = x < -X0;
      if (m === 3 || (m === 2 && (home || bend2)) || home) return true;
    }
  }
  const ah = z - KERB_R;
  if (ah > 0 && ah < LANES * LANE_W && ((x > X0 && x < X0 + RUN_OUT) || (x < -X0 && x > POOL_X0))) {
    const L = Math.floor(ah / LANE_W);
    const m = modes[L] ?? 0;
    const f = ah - L * LANE_W;
    if (m > 0 && f > POOL_INSET && f < LANE_W - POOL_INSET && (x > X0 || m === 1)) return true;
  }
  return false;
}

/** The channel's walls as polylines on the ground (each point: x, z, and the wall's normal into the water). */
export interface Wall {
  pts: { x: number; z: number; nx: number; nz: number }[];
}

/** Walls of one lane's channel: both sides along its stretch and the ends across it. */
export function poolWalls(lane: number, d: Distance, seg = 1.5): Wall[] {
  const m = poolMode(d);
  const rIn = KERB_R + LANE_W * (lane - 1) + POOL_INSET, rOut = KERB_R + LANE_W * lane - POOL_INSET;
  const walls: Wall[] = [];
  const straight = (x0: number, x1: number, zSign: number) => {
    for (const [r, inward] of [[rIn, 1], [rOut, -1]] as const) {
      const pts = [];
      const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / seg));
      for (let i = 0; i <= n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: zSign * r, nx: 0, nz: zSign * inward });
      walls.push({ pts });
    }
  };
  const bend = (cx: number) => {
    for (const [r, inward] of [[rIn, 1], [rOut, -1]] as const) {
      const pts = [];
      const n = Math.ceil((Math.PI * r) / seg);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI;
        const s = cx > 0 ? 1 : -1;
        const ox = s * Math.sin(a), oz = Math.cos(a);
        pts.push({ x: cx + r * ox, z: r * oz, nx: ox * inward, nz: oz * inward });
      }
      walls.push({ pts });
    }
  };
  const across = (x: number, zSign: number, nx: number) => {
    walls.push({ pts: [{ x, z: zSign * rIn, nx, nz: 0 }, { x, z: zSign * rOut, nx, nz: 0 }] });
  };
  // The home straight and run-out are always in it.
  straight(-X0, X0 + RUN_OUT, 1);
  across(X0 + RUN_OUT, 1, -1);
  if (m === 1) {
    straight(POOL_X0, -X0, 1);
    across(POOL_X0, 1, 1);
  } else {
    bend(-X0);
    if (m === 2) across(-X0, -1, -1);
    else { straight(-X0, X0, -1); bend(X0); }
  }
  return walls;
}

/** Ground rectangle the lanes' channels (and the big pool) lie in: [x0, z0, x1, z1]. */
export function poolBounds(modes: number[], big: BigPool | null = null): [number, number, number, number] {
  const lanes = modes.map((m, i) => (m ? i + 1 : 0)).filter(Boolean);
  if (big) {
    const r = KERB_R + big.hi + 0.5;
    const b: [number, number, number, number] = big.mode === 1 ? [START_100_X - big.back - 0.5, -0.5, X0 + r + 0.5, r] : [-X0 - r, -r, X0 + r + 0.5, r];
    if (!lanes.length) return b;
    const l = poolBounds(modes);
    return [Math.min(b[0], l[0]), Math.min(b[1], l[1]), Math.max(b[2], l[2]), Math.max(b[3], l[3])];
  }
  if (!lanes.length) return [0, 0, 0, 0];
  const rOut = KERB_R + LANE_W * Math.max(...lanes);
  const rIn = KERB_R + LANE_W * (Math.min(...lanes) - 1);
  const m = Math.max(...modes);
  if (m === 1) return [POOL_X0 - 0.5, rIn - 0.5, X0 + RUN_OUT + 0.5, rOut + 0.5];
  if (m === 2) return [-X0 - rOut - 0.5, -rOut - 0.5, X0 + RUN_OUT + 0.5, rOut + 0.5];
  return [-X0 - rOut - 0.5, -rOut - 0.5, X0 + RUN_OUT + 0.5, rOut + 0.5];
}

/** Above this height (m) a swimmer is a giant: it rides low, and what is under the water is hidden. */
export const GIANT_H = 1.2;

/** Share of a swimmer's height under the water: about 45% for a fish, up to 70% for a whale, which shows only its back. */
export const submergeShare = (h: number) => {
  const t = Math.max(0, Math.min(1, (h - GIANT_H) / (4 - GIANT_H)));
  return 0.45 + 0.25 * t * t * (3 - 2 * t);
};

/** Giants are cut at the surface (their lane is far narrower than they are). */
export const clipsUnderwater = (h: number) => h > GIANT_H;

/** How deep the channel is (m): deep enough for its small swimmers to float clear of the floor; deep and dark for a giant. */
export const poolDepth = (heights: number[]) => Math.max(0.8, Math.min(2.6, ...heights.map((h) => (clipsUnderwater(h) ? 2.6 : submergeShare(h) * h + 0.35))));

/** How dark the deep water is (0 clear … 1 a giant's deep channel). */
export const deepTint = (heights: number[]) => Math.max(0, Math.min(1, (Math.max(0, ...heights) - 0.8) / 3));

/** How far below the track a swimmer of height h rides (m). */
export const swimmerY = (h: number) => WATER_Y - submergeShare(h) * h;
