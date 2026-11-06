/**
 * Where everything stands in the Lumiose City tribute on /pokedex/sizes: a
 * round city with Prism Tower at the centre of a great circular plaza,
 * avenues radiating from it and five districts round it, each with its own
 * colour and a colour-themed plaza of its own.
 *
 * The line of figures walks down the Grand Boulevard (+x, z = 0), smallest
 * first, into the plaza, where it sweeps round the tower on a ring: the big
 * figures stand round Prism Tower, the camera outside the ring with the
 * tower behind them. The boulevard meets the ring on its tangent, so the
 * line only ever turns away from the camera (towards +z) and the sun, which
 * stands in front of the figures and to the camera's left, stays in front
 * of every one of them. Pure and unit-tested: the scene, the camera and the
 * tests all read the same plan.
 */

/** Cross-section of the boulevard (|z| in metres from the line). */
export const STREET = {
  /** Central promenade the line stands on. */
  promenade: 9,
  /** Plane trees along the outer pavements (the promenade stays open, so the facades and sky read behind the line). */
  trees: 29.6,
  /** Carriageway. */
  roadIn: 12,
  roadOut: 27,
  /** Facades. */
  facade: 38,
  /** Building depth behind a facade. */
  depth: 14,
} as const;

/** Haussmann block: ground floor, five floors and the frieze (m), then the mansard. */
export const CORNICE_Y = 4.4 + 15.3 + 0.8;
export const ROOF_Y = CORNICE_Y + 4.7;

/** Prism Tower to the tip of its spire, and the middle of its glowing prism (m): the scene builds it, the finale frames it whole. */
export const TOWER_H = 232;
export const PRISM_Y = 190;

/** Figures at least this big (height or width, m) are too big for the boulevard: they stand in the plaza. */
export const GIANT_M = 18;
/** Figures at least this big (height or width, m) stand on the ring round Prism Tower. */
export const RING_M = 8;
/** The ring's least radius (m): the tower's legs and the widest giant keep well clear of each other. */
export const RING_MIN_R = 150;
/** The most the ring turns (radians): past this the sun would come round behind the figures. */
export const RING_MAX_TURN = (118 * Math.PI) / 180;
/** Open paving between the ring and the buildings round the plaza (m). */
export const PLAZA_MARGIN = 120;

export interface PlacedFigure {
  x: number;
  w: number;
  h: number;
}

/** A point on the line: where it is (x, z) and which way the line runs there (radians from +x towards +z). */
export interface PathPoint {
  x: number;
  z: number;
  heading: number;
}

export interface Ring {
  /** Arc length along the line where the ring begins. */
  s0: number;
  /** Its centre (Prism Tower) and radius. */
  cx: number;
  cz: number;
  r: number;
}

/** The line's course: straight down the boulevard, then (with a ring) round the tower. `s` is the distance along the line (layoutLine's x). */
export interface LinePath {
  at(s: number): PathPoint;
  ring: Ring | null;
  /** Where Prism Tower stands (a plan's path knows; the bare straight line doesn't). */
  tower?: { x: number; z: number };
}

export function linePath(ring: Ring | null): LinePath {
  return {
    ring,
    at(s) {
      if (!ring || s <= ring.s0) return { x: s, z: 0, heading: 0 };
      const a = (s - ring.s0) / ring.r;
      return { x: ring.cx + ring.r * Math.sin(a), z: ring.cz - ring.r * Math.cos(a), heading: a };
    },
  };
}

/** The straight line (no ring): what a plan without big figures, and the camera's default, use. */
export const STRAIGHT: LinePath = linePath(null);

export interface District {
  /** Its colour's name and the colour. */
  name: string;
  color: string;
  /** The sector it fills round the tower (radians, atan2(z - cz, x - cx), a0 < a1). */
  a0: number;
  a1: number;
  /** Its colour plaza. */
  plaza: { x: number; z: number; r: number };
}

/** The five districts' colours, an original take on a city of coloured quarters. */
export const DISTRICT_COLORS: { name: string; color: string }[] = [
  { name: "vert", color: "#4fae5a" },
  { name: "bleu", color: "#3c7fd6" },
  { name: "magenta", color: "#c8479b" },
  { name: "rouge", color: "#d4473c" },
  { name: "jaune", color: "#efbd24" },
];

export interface WorldPlan {
  /** Where the boulevard begins, and where its middle meets the plaza. */
  x0: number;
  x1: number;
  /** The plaza: its centre (Prism Tower) and radius, out to the buildings round it. */
  plaza: { cx: number; cz: number; r: number };
  tower: { x: number; z: number };
  /** The line's first and last points (distance along the line). */
  lineStart: number;
  lineEnd: number;
  path: LinePath;
  ring: Ring | null;
  /** Directions (radians round the tower, atan2(z - cz, x - cx)) of the radial avenues; the first is the boulevard's own. */
  avenues: number[];
  districts: District[];
  /**
   * How far the camera's side of the boulevard is open (m from the line; 0: its street wall stands as usual). A line
   * in a stat or weight order may have a giant out on the boulevard, framed from far back: the camera's side is then
   * an open esplanade, so no building stands between the camera and the line.
   */
  open: number;
}

/** Figures at least this big (m) on the boulevard need the camera further back than the near street wall. */
export const OPEN_M = 12;

/**
 * Where the ring round Prism Tower begins. "first-big": at the line's first big figure (a line that grows: the
 * Height order, smallest first). "tail": only where the rest of the line is mostly big (a line in any other order,
 * where a few giants stand among small figures: it stays on the boulevard, and a line of giants still circles the
 * tower).
 */
export type RingRule = "first-big" | "tail";

/** The first big figure from which at least half the rest of the line is big, or -1. */
function bigTail(placed: PlacedFigure[]): number {
  const big = placed.map((p) => Math.max(p.h, p.w) >= RING_M);
  let count = 0;
  let at = -1;
  // From the end back: the earliest big figure where the big ones make up at least half of what follows.
  for (let i = placed.length - 1; i >= 0; i--) {
    if (big[i]) count++;
    if (big[i] && count * 2 >= placed.length - i) at = i;
  }
  return at;
}

/** The boulevard and plaza for a line of placed figures (x is the distance along the line). */
export function planWorld(placed: PlacedFigure[], rule: RingRule = "first-big"): WorldPlan {
  const lineStart = placed.length ? placed[0].x - placed[0].w / 2 : 0;
  const lineEnd = placed.length ? placed[placed.length - 1].x + placed[placed.length - 1].w / 2 : 1;
  const first = rule === "tail" ? bigTail(placed) : placed.findIndex((p) => Math.max(p.h, p.w) >= RING_M);
  let ring: Ring | null = null;
  let cx: number, cz: number;
  if (first >= 0) {
    // The ring starts a step before the first big figure; it turns at most RING_MAX_TURN by the end of the line.
    const s0 = placed[first].x - placed[first].w / 2 - Math.max(6, placed[first].w * 0.3);
    const span = Math.max(1, lineEnd - s0 + 12);
    const widest = Math.max(...placed.slice(first).map((p) => p.w));
    const r = Math.max(RING_MIN_R, span / RING_MAX_TURN, 90 + widest * 0.45);
    ring = { s0, cx: s0, cz: r, r };
    cx = s0;
    cz = r;
  } else {
    // No big figures: the line stays on the boulevard and the plaza opens just past its end.
    cz = RING_MIN_R;
    const rp = RING_MIN_R + PLAZA_MARGIN;
    cx = lineEnd + 30 + Math.sqrt(rp * rp - cz * cz);
  }
  const rr = ring?.r ?? RING_MIN_R;
  const r = rr + PLAZA_MARGIN;
  // The boulevard's middle meets the plaza's edge here.
  const x1 = cx - Math.sqrt(Math.max(0, r * r - cz * cz));
  const x0 = Math.min(lineStart - 180, -180, x1 - 200);
  // Five ways out of the plaza: the boulevard (which meets it at this angle) and four avenues, evenly round.
  const entry = Math.atan2(0 - cz, x1 - cx);
  const avenues = [0, 1, 2, 3, 4].map((k) => wrap(entry + (k * Math.PI * 2) / 5));
  const districts: District[] = DISTRICT_COLORS.map((d, k) => {
    const a0 = entry + (k * Math.PI * 2) / 5, a1 = a0 + (Math.PI * 2) / 5;
    const am = (a0 + a1) / 2, pr = r + 205;
    return { ...d, a0, a1, plaza: { x: cx + Math.cos(am) * pr, z: cz + Math.sin(am) * pr, r: 34 } };
  });
  // A giant on the straight part of a line that doesn't grow: open the camera's side out past where the camera frames it from (about 3.5 times its size on a phone).
  const onStreet = placed.filter((p) => !ring || p.x < ring.s0).map((p) => Math.max(p.h, p.w));
  const biggest = onStreet.length ? Math.max(...onStreet) : 0;
  const open = rule === "tail" && biggest >= OPEN_M ? Math.min(1500, Math.max(160, biggest * 4)) : 0;
  return { x0, x1, plaza: { cx, cz, r }, tower: { x: cx, z: cz }, lineStart, lineEnd, path: { ...linePath(ring), tower: { x: cx, z: cz } }, ring, avenues, districts, open };
}

/** An angle in (-π, π]. */
export function wrap(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** Whether a point (x, z) is inside the plaza's open space. */
export function inPlaza(plan: WorldPlan, x: number, z: number, margin = 0): boolean {
  return Math.hypot(x - plan.plaza.cx, z - plan.plaza.cz) <= plan.plaza.r - margin;
}

/** Where a boulevard facade line (|z| = STREET.facade, or any z) meets the buildings round the plaza (x). */
export function boulevardEnd(plan: WorldPlan, z: number, out = 0): number {
  const R = plan.plaza.r + out;
  const dz = z - plan.plaza.cz;
  return plan.plaza.cx - Math.sqrt(Math.max(0, R * R - dz * dz));
}

/** The district a point is in (by its direction from the tower). */
export function districtAt(plan: WorldPlan, x: number, z: number): District {
  const a = Math.atan2(z - plan.plaza.cz, x - plan.plaza.cx);
  for (const d of plan.districts) {
    const k = wrap(a - d.a0);
    if (k >= 0 && k < d.a1 - d.a0) return d;
  }
  return plan.districts[0];
}

/** The boulevard's two sides: the district behind the line (far, +z) and the one behind the camera (near, -z). */
export function boulevardDistricts(plan: WorldPlan): { far: District; near: District } {
  // Just inside the plaza's edge on either side of the boulevard's mouth.
  const x = plan.x1 + 2;
  return { far: districtAt(plan, x, STREET.facade + 20), near: districtAt(plan, x, -STREET.facade - 20) };
}
