import type { ModuleId } from "@/engines/types";
import { PLAY_MODULES, PLAYABLE_FORMATS } from "@/lib/modes";
import { NEA_CATEGORIES } from "@/lib/name-em-all/categories";

/**
 * Quiz personal bests for a trainer's profile. Quiz modes have no
 * leaderboards: each trainer's best per mode and format is shown on their
 * profile instead.
 *
 * - Quiz modes: the "<module>:<format>" best scores their progress keeps
 *   (recorded only from server-graded runs and synced to their account).
 * - Name 'em All: their checked entries in the Name 'em All store, the most
 *   named inside the standard time and the fastest full clear per category.
 */

export type PlayableFormat = (typeof PLAYABLE_FORMATS)[number];

export interface QuizBestRow {
  module: ModuleId;
  /** Best score per format; a format never played is absent. */
  scores: Partial<Record<PlayableFormat, number>>;
}

/** The Quizzes tab's modes the trainer has a best in, in the tab's order. Anything else in the map (other games' keys, bad values) is ignored. */
export function quizBests(best: unknown): QuizBestRow[] {
  if (!best || typeof best !== "object" || Array.isArray(best)) return [];
  const map = best as Record<string, unknown>;
  const rows: QuizBestRow[] = [];
  for (const mode of PLAY_MODULES) {
    const scores: QuizBestRow["scores"] = {};
    for (const format of PLAYABLE_FORMATS) {
      const v = map[`${mode}:${format}`];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) scores[format] = Math.round(v);
    }
    if (Object.keys(scores).length) rows.push({ module: mode, scores });
  }
  return rows;
}

export interface NeaBestEntry {
  scope: string;
  board: "clear" | "count";
  named: number;
  total: number;
  ms: number;
}

export interface NeaBestRow {
  category: string;
  label: string;
  total: number;
  /** Most named inside the standard time. */
  count?: { named: number; ms: number };
  /** The fastest full clear. */
  clearMs?: number;
}

const CATEGORY_ORDER = new Map(NEA_CATEGORIES.map((c, i) => [c.id, i]));

/** Name 'em All bests per category (dailies left out: each is a one-off), in the hub's order. */
export function neaBests(entries: readonly NeaBestEntry[] | null | undefined): NeaBestRow[] {
  const rows = new Map<string, NeaBestRow>();
  for (const e of entries ?? []) {
    const at = CATEGORY_ORDER.get(e.scope);
    if (at === undefined) continue;
    const row = rows.get(e.scope) ?? { category: e.scope, label: NEA_CATEGORIES[at].label, total: e.total };
    if (e.board === "count") row.count = { named: e.named, ms: e.ms };
    else row.clearMs = e.ms;
    rows.set(e.scope, row);
  }
  return [...rows.values()].sort((a, b) => CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)!);
}
