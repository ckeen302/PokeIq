import type { LabMon, Stats6 } from "./types";

/**
 * Battle roles, scored straight from base stats (the owner's formulas):
 *
 *   Physical Sweeper = Attack + Speed
 *   Special Sweeper  = Sp. Atk + Speed
 *   Wall             = HP + Defense + Sp. Def
 *   Physical Tank    = Attack + Defense
 *   Special Tank     = Sp. Atk + Sp. Def
 *
 * Each Pokémon's score is placed against every Pokémon in the comparison
 * set (all species, plus the forms when they're on the wheel): a bar from
 * the set's lowest to its highest score, and its real rank as a percentile.
 */

export type RoleKey = "physicalSweeper" | "specialSweeper" | "wall" | "physicalTank" | "specialTank";

export interface RoleDef {
  key: RoleKey;
  /** URL value for ?sort=. */
  param: string;
  /** Stat indexes (hp 0, atk 1, def 2, spa 3, spd 4, spe 5) summed. */
  stats: number[];
}

export const ROLES: RoleDef[] = [
  { key: "physicalSweeper", param: "physical-sweeper", stats: [1, 5] },
  { key: "specialSweeper", param: "special-sweeper", stats: [3, 5] },
  { key: "wall", param: "wall", stats: [0, 2, 4] },
  { key: "physicalTank", param: "physical-tank", stats: [1, 2] },
  { key: "specialTank", param: "special-tank", stats: [3, 4] },
];

export function roleScore(stats: Stats6, role: RoleDef): number {
  let s = 0;
  for (const i of role.stats) s += stats[i];
  return s;
}

export interface RoleStanding {
  key: RoleKey;
  score: number;
  /** 0–1 along the set's range (lowest score 0, highest 1). */
  bar: number;
  /** 1 = the best; ties share the better rank. */
  rank: number;
  /** "Top x%" when x ≤ 50, else "Bottom y%": share of the set (rounded up, at least 1). */
  top: number;
  bottom: number;
}

export interface RoleTable {
  size: number;
  /** Per role: the set's scores sorted high to low, min and max. */
  sorted: Record<RoleKey, Int32Array>;
  min: Record<RoleKey, number>;
  max: Record<RoleKey, number>;
}

/** The comparison set's distributions (computed once per set). */
export function roleTable(set: readonly { stats: Stats6 }[]): RoleTable {
  const sorted = {} as Record<RoleKey, Int32Array>;
  const min = {} as Record<RoleKey, number>;
  const max = {} as Record<RoleKey, number>;
  for (const r of ROLES) {
    const a = Int32Array.from(set, (m) => roleScore(m.stats, r)).sort().reverse();
    sorted[r.key] = a;
    max[r.key] = a.length ? a[0] : 0;
    min[r.key] = a.length ? a[a.length - 1] : 0;
  }
  return { size: set.length, sorted, min, max };
}

/** How many of the (high-to-low) sorted scores are strictly greater than v. */
function countGreater(desc: Int32Array, v: number): number {
  let lo = 0, hi = desc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (desc[mid] > v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many are strictly smaller than v. */
function countLess(desc: Int32Array, v: number): number {
  let lo = 0, hi = desc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (desc[mid] >= v) lo = mid + 1;
    else hi = mid;
  }
  return desc.length - lo;
}

export function standing(stats: Stats6, table: RoleTable, role: RoleDef): RoleStanding {
  const score = roleScore(stats, role);
  const desc = table.sorted[role.key];
  const n = Math.max(1, table.size);
  const greater = countGreater(desc, score);
  const less = countLess(desc, score);
  const span = table.max[role.key] - table.min[role.key];
  return {
    key: role.key,
    score,
    bar: span > 0 ? Math.min(1, Math.max(0, (score - table.min[role.key]) / span)) : 1,
    rank: greater + 1,
    top: Math.max(1, Math.ceil(((greater + 1) / n) * 100)),
    bottom: Math.max(1, Math.ceil(((less + 1) / n) * 100)),
  };
}

/** All five roles for a Pokémon, and which one it's best at (its best percentile; ties go to the higher score). */
export function standings(m: Pick<LabMon, "stats">, table: RoleTable): { roles: RoleStanding[]; best: RoleKey } {
  const roles = ROLES.map((r) => standing(m.stats, table, r));
  let best = roles[0];
  for (const r of roles) if (r.rank < best.rank || (r.rank === best.rank && r.score > best.score)) best = r;
  return { roles, best: best.key };
}

/** The percentile as shown: "Top 4%" or, past the middle, "Bottom 12%". */
export function percentileParts(s: RoleStanding): { side: "top" | "bottom"; value: number } {
  return s.top <= 50 ? { side: "top", value: s.top } : { side: "bottom", value: s.bottom };
}
