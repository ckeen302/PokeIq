/**
 * PokéGuessr exact spots: the piecewise alignment of one area. Our atlas is
 * our own drawing of each region: a route keeps its neighbours and its rough
 * shape, but the drawing stretches some stretches more than others, and one
 * smooth fit of a whole region can't follow that (a thin-plate spline through
 * every junction of a region, each junction predicted from the others, misses
 * by 10 to 18 px at the median). So each area is fitted on its own, piece by
 * piece, from control points known on both maps:
 *
 *  - every connection of the area in the game (scripts/geo/spot-world.ts):
 *    the edge it shares with a neighbouring place ↔ where the two places'
 *    areas meet on our map. The edge fixes where the area ends on that side;
 *    a short edge (a side road joining halfway along) also fixes a point
 *    along the side.
 *  - every door or cave mouth on the area that leads to a place drawn next to
 *    it on our map (Mt. Moon on Route 4, Viridian Forest's gate on Route 2):
 *    the warp ↔ where the two places' areas meet. It fixes a point along the
 *    area's long axis.
 *  - a side with neither ends at the area's mask box.
 *
 * Game x and y each map to our map through a piecewise-linear function with a
 * knot at every such point (a route drawn with one stretch longer than
 * another follows it). The gate (`fitLocal`'s `ok`):
 *  - at least two control points, pinning both ends of the area's long axis
 *    (a connection on that side, or a point in that end's outer third), or
 *    two sides of a squarish area;
 *  - every control point lands within GATE.CONTROL_PX of our map's with the
 *    fit as made (two neighbours on one side, the cross-axis of a side road);
 *  - each point knot, left out of the fit, still lands within GATE.LOO_PX
 *    (no control point disagrees grossly with the others: the wrong place, a
 *    drawing that doesn't follow the game);
 *  - the knots run the same way on both maps (no fold);
 *  - the game map, carried over, lies on the area's mask (precision) and
 *    covers it (recall).
 * A spot then has to land on the mask (`onMask`). An area that fails keeps
 * area scoring for all its shots.
 */
import type { Px } from "./spot-align";

/** Gate thresholds (world-map px). */
export const WARP_GATE = {
  /** Every control point lands this close to our map's, with the fit as made. */
  CONTROL_PX: 5,
  /** A point knot left out still lands this close (a gross disagreement fails the area). */
  LOO_PX: 12,
  /** Share of the carried-over game map on the area's mask (within MASK_TOL of a mask point). */
  MIN_PRECISION: 0.8,
  /** Share of the area's mask points with carried-over game map nearby. */
  MIN_RECALL: 0.75,
  /** "On the mask": within this many px of a mask point. */
  MASK_TOL: 5,
  /** A shared edge shorter than this share of the area's side also fixes a point along it. */
  SHORT_EDGE: 0.5,
  /** Two places meet where their mask points are within this many px. */
  MEET_PX: 10,
  /** An area this elongated (long side / short side) must be pinned at both ends of its long axis. */
  ELONGATED: 1.5,
};

/**
 * Where two places meet on our map: the middle of every pair of their mask
 * points that are next to each other (within `reach` px), averaged; null if
 * they don't touch.
 */
export function meetingPoint(a: Px[], b: Px[], reach = WARP_GATE.MEET_PX): Px | null {
  let [sx, sy, n] = [0, 0, 0];
  for (const p of a)
    for (const q of b)
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= reach) {
        sx += (p[0] + q[0]) / 2;
        sy += (p[1] + q[1]) / 2;
        n++;
      }
  return n ? [sx / n, sy / n] : null;
}

export type Side = "north" | "south" | "west" | "east";

/** A connection of the area. */
export interface EdgeControl {
  kind: "edge";
  label: string;
  /** The area's side the neighbour joins. */
  side: Side;
  /** Game-world px: the edge's coordinate across the side (y for north / south) and its extent along it. */
  edge: number;
  from: number;
  to: number;
  /** Where the two places meet on our map. */
  world: Px;
}

/** A door or cave mouth leading to a place drawn next to the area. */
export interface PointControl {
  kind: "point";
  label: string;
  game: Px;
  world: Px;
}

export type Control = EdgeControl | PointControl;

export interface LocalFit {
  ok: boolean;
  reasons: string[];
  /** Every control point: how far it lands from our map's (px), and for a knot along the area, with it left out. */
  controls: { label: string; px: number; looPx?: number }[];
  precision: number;
  recall: number;
  /** Game-world px → world-map px. */
  toWorld: (x: number, y: number) => Px;
}

type Knot = { g: number; w: number; label?: string };

/** Piecewise linear through knots (extended past the ends with the end pieces' slopes). */
function piecewise(knots: Knot[]): (g: number) => number {
  const ks = [...knots].sort((a, b) => a.g - b.g);
  return (g: number) => {
    let i = 0;
    while (i < ks.length - 2 && g > ks[i + 1].g) i++;
    const [a, b] = [ks[i], ks[i + 1]];
    return a.w + ((g - a.g) / (b.g - a.g)) * (b.w - a.w);
  };
}

const monotone = (knots: Knot[]) => {
  const ks = [...knots].sort((a, b) => a.g - b.g);
  return ks.every((k, i) => i === 0 || (k.g > ks[i - 1].g && k.w > ks[i - 1].w));
};

const nearest = (pts: Px[], x: number, y: number) => pts.reduce((best, p) => Math.min(best, Math.hypot(p[0] - x, p[1] - y)), Infinity);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The mask's box, each point standing for a cell of the grid spacing around it. */
export function maskBox(mask: Px[]): [number, number, number, number] {
  let spacing = Infinity;
  for (let i = 0; i < mask.length; i++)
    for (let j = i + 1; j < mask.length; j++) {
      const d = Math.hypot(mask[i][0] - mask[j][0], mask[i][1] - mask[j][1]);
      if (d > 0.5 && d < spacing) spacing = d;
    }
  const half = (Number.isFinite(spacing) ? Math.min(spacing, 9) : 7) / 2;
  const xs = mask.map((p) => p[0]);
  const ys = mask.map((p) => p[1]);
  return [Math.min(...xs) - half, Math.min(...ys) - half, Math.max(...xs) + half, Math.max(...ys) + half];
}

/**
 * Fits one area (see the top of the file). `rect` is its game map in
 * game-world px (left, top, width, height), `mask` its mask in world px.
 */
export function fitLocal(rect: [number, number, number, number], mask: Px[], given: Control[], bounded: Set<Side> = new Set()): LocalFit {
  const reasons: string[] = [];
  const [gx, gy, gw, gh] = rect;
  const [bx0, by0, bx1, by1] = maskBox(mask);
  const longX = gw >= gh;
  const alongOf = (c: EdgeControl) => (c.side === "north" || c.side === "south" ? "x" : "y");
  const short = (c: EdgeControl) => (c.to - c.from) / (alongOf(c) === "x" ? gw : gh) < WARP_GATE.SHORT_EDGE;
  const ends: Record<Side, [number, number]> = {
    west: [gx, bx0],
    east: [gx + gw, bx1],
    north: [gy, by0],
    south: [gy + gh, by1],
  };

  const knotsOf = (controls: Control[]) => {
    const x: Knot[] = [];
    const y: Knot[] = [];
    const bySide: Partial<Record<Side, number[]>> = {};
    for (const c of controls) {
      if (c.kind === "point") {
        // Along the long axis only: a cave icon sits beside its route, not on it.
        (longX ? x : y).push({
          g: longX ? c.game[0] : c.game[1],
          w: longX ? c.world[0] : c.world[1],
          label: c.label,
        });
        continue;
      }
      (bySide[c.side] ??= []).push(alongOf(c) === "x" ? c.world[1] : c.world[0]);
      if (short(c))
        (alongOf(c) === "x" ? x : y).push({
          g: (c.from + c.to) / 2,
          w: alongOf(c) === "x" ? c.world[0] : c.world[1],
          label: c.label,
        });
    }
    for (const side of ["west", "east", "north", "south"] as const) {
      const ws = bySide[side];
      // Several neighbours on one side: where they meet ours, averaged; none: the mask's box.
      const k = {
        g: ends[side][0],
        w: ws?.length ? ws.reduce((s, v) => s + v, 0) / ws.length : ends[side][1],
      };
      (side === "west" || side === "east" ? x : y).push(k);
    }
    // A knot at a side's very end replaces that side's (same game coordinate).
    const dedupe = (ks: Knot[]) => ks.filter((k) => k.label || !ks.some((q) => q.label && Math.abs(q.g - k.g) < 0.5));
    return { x: dedupe(x), y: dedupe(y) };
  };
  const consistent = (controls: Control[]) => {
    const k = knotsOf(controls);
    return monotone(k.x) && monotone(k.y);
  };
  /** A door's error along the long axis under the fit through `controls`. */
  const doorErr = (d: PointControl, controls: Control[]) => {
    const k = knotsOf(controls);
    return Math.abs(piecewise(longX ? k.x : k.y)(longX ? d.game[0] : d.game[1]) - (longX ? d.world[0] : d.world[1]));
  };

  // The connections always count; a door joins only if it agrees with them (the knots still run one way, and the fit without it lands within LOO_PX of it).
  let controls: Control[] = given.filter((c) => c.kind === "edge");
  const dropped: { label: string; px: number; why: string }[] = [];
  const doors = given.filter((c): c is PointControl => c.kind === "point").sort((a, b) => doorErr(a, controls) - doorErr(b, controls));
  for (const d of doors) {
    const err = doorErr(d, controls);
    if (!consistent([...controls, d])) dropped.push({ label: d.label, px: r1(err), why: "runs the other way" });
    else if (err > WARP_GATE.LOO_PX) dropped.push({ label: d.label, px: r1(err), why: "disagrees" });
    else controls = [...controls, d];
  }
  const all = knotsOf(controls);
  if (!monotone(all.x) || !monotone(all.y)) reasons.push("control points run the other way on our map");
  const fx = piecewise(all.x);
  const fy = piecewise(all.y);
  const toWorld = (x: number, y: number): Px => [fx(x), fy(y)];

  // Pinning: which ends of each axis a control point holds (a side road or a door in that end's outer third holds it too).
  const pinned = new Set<Side>();
  const holdEnd = (t: number, x: boolean) => {
    if (t <= 1 / 3) pinned.add(x ? "west" : "north");
    if (t >= 2 / 3) pinned.add(x ? "east" : "south");
  };
  for (const c of controls) {
    if (c.kind === "point") holdEnd(longX ? (c.game[0] - gx) / gw : (c.game[1] - gy) / gh, longX);
    else {
      pinned.add(c.side);
      if (short(c)) holdEnd(alongOf(c) === "x" ? ((c.from + c.to) / 2 - gx) / gw : ((c.from + c.to) / 2 - gy) / gh, alongOf(c) === "x");
    }
  }
  // An end not held by a control point but where our area runs into another place (the drawing stops there) counts as held, if the other end is held.
  const held = (s: Side) => pinned.has(s) || bounded.has(s);
  const elongated = Math.max(gw, gh) / Math.min(gw, gh) >= WARP_GATE.ELONGATED;
  const [endA, endB]: Side[] = longX ? ["west", "east"] : ["north", "south"];
  const pinOk = elongated ? (pinned.has(endA) || pinned.has(endB)) && held(endA) && held(endB) : pinned.size >= 1 && (["west", "east", "north", "south"] as const).filter(held).length >= 2;
  if (!controls.length) reasons.push("no control points (places that meet ours on both maps)");
  else if (!pinOk) reasons.push(`not held at both ends (${[...pinned].join(", ")}${bounded.size ? `; bounded ${[...bounded].join(", ")}` : ""})`);

  const results: LocalFit["controls"] = controls.map((c) => {
    if (c.kind === "point")
      return {
        label: c.label,
        px: r1(doorErr(c, controls)),
        looPx: r1(
          doorErr(
            c,
            controls.filter((q) => q !== c)
          )
        ),
      };
    const mid = (c.from + c.to) / 2;
    const at = (f: typeof fx, g: typeof fy): Px => (alongOf(c) === "x" ? [f(mid), g(c.edge)] : [f(c.edge), g(mid)]);
    // A long shared edge only fixes the side (its middle along the side isn't a point both maps agree on).
    const err = ([px, py]: Px) => (short(c) ? Math.hypot(px - c.world[0], py - c.world[1]) : Math.abs(alongOf(c) === "x" ? py - c.world[1] : px - c.world[0]));
    if (!short(c)) return { label: c.label, px: r1(err(at(fx, fy))) };
    const k = knotsOf(controls.filter((q) => q !== c));
    return {
      label: c.label,
      px: r1(err(at(fx, fy))),
      looPx: r1(err(at(piecewise(k.x), piecewise(k.y)))),
    };
  });
  for (const r of results) if (!(r.px <= WARP_GATE.CONTROL_PX)) reasons.push(`${r.label}: ${r.px}px off`);
  for (const d of dropped) results.push({ label: `${d.label} (left out: ${d.why})`, px: d.px });

  // The game map sampled on a grid (16 samples along its long side), carried over.
  const step = Math.max(gw, gh) / 16;
  const carried: Px[] = [];
  for (let y = gy + step / 2; y < gy + gh; y += step) for (let x = gx + step / 2; x < gx + gw; x += step) carried.push(toWorld(x, y));
  const precision = carried.filter(([x, y]) => nearest(mask, x, y) <= WARP_GATE.MASK_TOL).length / Math.max(1, carried.length);
  const reach = Math.max(WARP_GATE.MASK_TOL, Math.max(bx1 - bx0, by1 - by0) / 16);
  const recall = mask.filter(([x, y]) => nearest(carried, x, y) <= reach).length / Math.max(1, mask.length);
  if (precision < WARP_GATE.MIN_PRECISION) reasons.push(`${Math.round(precision * 100)}% of the game map lands on our area`);
  if (recall < WARP_GATE.MIN_RECALL) reasons.push(`the game map covers ${Math.round(recall * 100)}% of our area`);
  return {
    ok: reasons.length === 0,
    reasons,
    controls: results,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
    toWorld,
  };
}

/**
 * The sides of an area's mask that run into another place on our map (its
 * outermost points on that side within MEET_PX of another place's mask): the
 * drawing of the area stops there.
 */
export function boundedSides(mask: Px[], others: Px[][]): Set<Side> {
  const out = new Set<Side>();
  const [x0, y0, x1, y1] = maskBox(mask);
  const edge: Record<Side, (p: Px) => boolean> = {
    west: (p) => p[0] - x0 <= 6,
    east: (p) => x1 - p[0] <= 6,
    north: (p) => p[1] - y0 <= 6,
    south: (p) => y1 - p[1] <= 6,
  };
  for (const side of ["west", "east", "north", "south"] as const) {
    const outer = mask.filter(edge[side]);
    const beyond = (q: Px) => (side === "west" ? q[0] < x0 + 3 : side === "east" ? q[0] > x1 - 3 : side === "north" ? q[1] < y0 + 3 : q[1] > y1 - 3);
    if (others.some((o) => o.some((q) => beyond(q) && outer.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= WARP_GATE.MEET_PX)))) out.add(side);
  }
  return out;
}

/** Whether a carried-over spot lies on the area's mask. */
export const onMask = (mask: Px[], [x, y]: Px) => nearest(mask, x, y) <= WARP_GATE.MASK_TOL;
