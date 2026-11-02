/**
 * Where everything stands in the Lumiose City tribute on /pokedex/sizes.
 * The line of figures runs along the middle of a grand boulevard (+x),
 * smallest first, towards the central plaza and Prism Tower. Figures too
 * big for the boulevard stand in the plaza. Pure and unit-tested: the
 * scene, the camera and the tests all read the same plan.
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

/** Figures at least this big (height or width, m) stand in the plaza. */
export const GIANT_M = 18;

export interface PlacedFigure {
  x: number;
  w: number;
  h: number;
}

export interface WorldPlan {
  /** Where the boulevard begins and ends (the plaza's edge). */
  x0: number;
  x1: number;
  plaza: { cx: number; r: number };
  tower: { x: number; z: number };
  /** The line's first and last points. */
  lineStart: number;
  lineEnd: number;
}

/** The boulevard and plaza for a line of placed figures (x along the line, z = 0). */
export function planWorld(placed: PlacedFigure[]): WorldPlan {
  const lineStart = placed.length ? placed[0].x - placed[0].w / 2 : 0;
  const lineEnd = placed.length ? placed[placed.length - 1].x + placed[placed.length - 1].w / 2 : 1;
  const firstGiant = placed.findIndex((p) => Math.max(p.h, p.w) >= GIANT_M);
  const plazaStart = firstGiant >= 0 ? placed[firstGiant].x - placed[firstGiant].w / 2 - 28 : lineEnd + 30;
  const span = Math.max(0, lineEnd - plazaStart);
  const r = Math.max(140, span / 2 + 50);
  const cx = plazaStart + r;
  return {
    x0: Math.min(lineStart - 180, -180),
    x1: plazaStart,
    plaza: { cx, r },
    tower: { x: cx + r * 0.3, z: r * 0.62 },
    lineStart,
    lineEnd,
  };
}

/** Whether a point (x, z) is inside the plaza's open space. */
export function inPlaza(plan: WorldPlan, x: number, z: number, margin = 0): boolean {
  return Math.hypot(x - plan.plaza.cx, z) <= plan.plaza.r - margin;
}
