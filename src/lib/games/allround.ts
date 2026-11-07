import type { Athlete } from "./athlete";
import { TABLES } from "./constants";
import { MARK_EVENTS, type MarkEvent } from "./events";
import { highJumpMark } from "./highjump";
import { liftMark } from "./lift";
import { longJumpMark } from "./longjump";
import { sprintMark } from "./sprint";
import { swimMark } from "./swim";
import { javelinMark, shotMark } from "./throws";

/**
 * The all-around: one score from every event with a mark, the way a
 * decathlon is scored. Points use World Athletics' combined-events formula,
 * A·(B − T)^C for times and A·(M − B)^C for marks (jumps in cm), with the
 * real decathlon constants for the 100 m, 400 m, long jump, high jump, shot
 * put and javelin and ours, of the same form, for the 200 m, the lift and
 * the swims (constants.ts). A mark past the table's zero scores 0. The best
 * all-rounder is the Champion of the Games. Pure and unit-tested.
 */

export function eventPoints(id: MarkEvent, mark: number | null | undefined): number {
  if (mark == null || !Number.isFinite(mark)) return 0;
  const t = TABLES[id];
  if (t.unit === "s") return mark >= t.B ? 0 : Math.floor(t.A * Math.pow(t.B - mark, t.C));
  const m = t.unit === "cm" ? Math.floor(mark * 100 + 1e-7) : mark;
  return m <= t.B ? 0 : Math.floor(t.A * Math.pow(m - t.B, t.C));
}

export type Marks = Partial<Record<MarkEvent, number | null>>;

export function allAroundPoints(marks: Marks): { total: number; points: Record<MarkEvent, number> } {
  const points = {} as Record<MarkEvent, number>;
  let total = 0;
  for (const id of MARK_EVENTS) {
    points[id] = eventPoints(id, marks[id]);
    total += points[id];
  }
  return { total, points };
}

/** An athlete's neutral marks in every event (the records). */
export function neutralMarks(a: Athlete): Record<MarkEvent, number | null> {
  const shot = shotMark(a), jav = javelinMark(a), lift = liftMark(a);
  return {
    "100m": sprintMark(a, "100m"),
    "200m": sprintMark(a, "200m"),
    "400m": sprintMark(a, "400m"),
    "long-jump": longJumpMark(a),
    "high-jump": highJumpMark(a),
    "shot-put": shot > 0 ? shot : null,
    javelin: jav > 0 ? jav : null,
    weightlifting: lift >= 2 ? lift : null,
    "50m-freestyle": swimMark(a, "50m-freestyle"),
    "100m-freestyle": swimMark(a, "100m-freestyle"),
  };
}
