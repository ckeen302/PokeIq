/**
 * PokéGuessr exact spots: the path fallback for an area whose fit failed the
 * gate (scripts/geo/spot-warp.ts) because our drawing bends or stretches the
 * route differently from the game. A position on the game's map is carried
 * by its progress along the route between its two exits (the two control
 * points farthest apart on the game's map) and its sideways offset from that
 * line, onto our area's centreline between the same two exits (the shortest
 * way through the area's mask points), at the same progress and offset
 * (scaled by the two lengths).
 *
 * It's only trusted when there's a third control point (a connection or a
 * door, from pret's map data) to hold out: every held-out control point must
 * land within HOLDOUT_PX of where our map has it. Areas with only their two
 * exits stay unaligned (area-scored).
 */
import type { Px } from "./spot-align";
import type { Control } from "./spot-warp";

export const PATH_GATE = {
  /** A held-out control point lands this close to our map's (px). */
  HOLDOUT_PX: 5,
  /** Mask points this close (× the grid spacing) are joined into the area's graph. */
  LINK: 1.6,
};

export interface PathFit {
  ok: boolean;
  reasons: string[];
  controls: { label: string; px: number }[];
  /** Game px → world px, and the progress along the route (0 at one exit, 1 at the other). */
  toWorld: (x: number, y: number) => Px;
  progress: (x: number, y: number) => number;
}

const gamePoint = (c: Control): Px => (c.kind === "point" ? c.game : c.side === "north" || c.side === "south" ? [(c.from + c.to) / 2, c.edge] : [c.edge, (c.from + c.to) / 2]);
const dist = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The shortest way from a to b through the mask's points (Dijkstra over neighbouring grid points), ends included. */
function centreline(mask: Px[], a: Px, b: Px): Px[] | null {
  if (mask.length < 2) return null;
  let spacing = Infinity;
  for (let i = 0; i < Math.min(mask.length, 400); i++) for (let j = 0; j < mask.length; j++) if (i !== j) spacing = Math.min(spacing, dist(mask[i], mask[j]) || Infinity);
  const link = spacing * PATH_GATE.LINK;
  const start = mask.reduce((bi, p, i) => (dist(p, a) < dist(mask[bi], a) ? i : bi), 0);
  const end = mask.reduce((bi, p, i) => (dist(p, b) < dist(mask[bi], b) ? i : bi), 0);
  const d = new Array(mask.length).fill(Infinity);
  const prev = new Array(mask.length).fill(-1);
  const done = new Array(mask.length).fill(false);
  d[start] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < mask.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || u === end) break;
    done[u] = true;
    for (let v = 0; v < mask.length; v++) {
      if (done[v]) continue;
      const w = dist(mask[u], mask[v]);
      if (w <= link && d[u] + w < d[v]) {
        d[v] = d[u] + w;
        prev[v] = u;
      }
    }
  }
  if (d[end] === Infinity) return null;
  const nodes: Px[] = [];
  for (let i = end; i >= 0; i = prev[i]) nodes.unshift(mask[i]);
  // Smoothed (the grid's staircase), its ends on the exits themselves.
  const smooth = nodes.map((p, i) => {
    const q = nodes.slice(Math.max(0, i - 2), i + 3);
    return [q.reduce((s, r) => s + r[0], 0) / q.length, q.reduce((s, r) => s + r[1], 0) / q.length] as Px;
  });
  return [a, ...smooth.slice(1, -1), b];
}

/** The point at arc-length fraction t of a polyline (clamped), and the unit normal there (to the left of the way). */
function along(line: Px[], t: number): { p: Px; n: Px; length: number } {
  const seg = line.slice(1).map((p, i) => dist(line[i], p));
  const length = seg.reduce((s, v) => s + v, 0);
  let target = Math.min(1, Math.max(0, t)) * length;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, target / seg[i]) : 0;
      const [a, b] = [line[i], line[i + 1]];
      const dx = (b[0] - a[0]) / (seg[i] || 1);
      const dy = (b[1] - a[1]) / (seg[i] || 1);
      return { p: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], n: [dy, -dx], length };
    }
    target -= seg[i];
  }
  return { p: line[line.length - 1], n: [0, 0], length };
}

export function fitPath(controls: Control[], mask: Px[]): PathFit | null {
  if (controls.length < 3) return null;
  const pts = controls.map((c) => ({ label: c.label, g: gamePoint(c), w: c.world }));
  let [ia, ib] = [0, 1];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (dist(pts[i].g, pts[j].g) > dist(pts[ia].g, pts[ib].g)) [ia, ib] = [i, j];
  const A = pts[ia];
  const B = pts[ib];
  const line = centreline(mask, A.w, B.w);
  const L = dist(A.g, B.g);
  if (!line || L < 1) return null;
  const u: Px = [(B.g[0] - A.g[0]) / L, (B.g[1] - A.g[1]) / L];
  const progress = (x: number, y: number) => ((x - A.g[0]) * u[0] + (y - A.g[1]) * u[1]) / L;
  const toWorld = (x: number, y: number): Px => {
    const t = progress(x, y);
    // Left of the way on the game's map (y down): the same sign convention as along()'s normal.
    const lat = ((x - A.g[0]) * u[1] - (y - A.g[1]) * u[0]) / L;
    const at = along(line, t);
    return [at.p[0] + at.n[0] * lat * at.length, at.p[1] + at.n[1] * lat * at.length];
  };
  const held = pts.filter((_, i) => i !== ia && i !== ib).map((p) => ({ label: p.label, px: Math.round(dist(toWorld(...p.g), p.w) * 10) / 10, t: progress(...p.g) }));
  const reasons: string[] = [];
  for (const h of held) {
    if (h.px > PATH_GATE.HOLDOUT_PX) reasons.push(`path: held-out ${h.label} lands ${h.px}px off`);
    if (h.t < -0.05 || h.t > 1.05) reasons.push(`path: held-out ${h.label} lies past the exits`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    controls: [{ label: `exit ${A.label}`, px: 0 }, { label: `exit ${B.label}`, px: 0 }, ...held.map((h) => ({ label: `held out ${h.label}`, px: h.px }))],
    toWorld,
    progress,
  };
}
