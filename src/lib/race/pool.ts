import { KERB_R, LANE_W, LANES, RUN_OUT, START_100_X, X0, type Distance } from "./track";

/**
 * Pool lanes: a swimmer's lane (lib/race/gait: Pokémon that can't move on
 * land) becomes a water channel set into the track, along exactly the
 * stretch that runner covers, from behind its start to the end of the
 * run-out. Pure and unit-tested; the scene draws the same regions in its
 * shaders (scene/pool.ts mirrors `poolAt`).
 *
 * The channel sits inside the lane's painted lines (they become its white
 * coping) and is as deep as its biggest swimmer needs.
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

/** Ground rectangle the lanes' channels lie in: [x0, z0, x1, z1]. */
export function poolBounds(modes: number[]): [number, number, number, number] {
  const lanes = modes.map((m, i) => (m ? i + 1 : 0)).filter(Boolean);
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
