import "server-only";
import { z } from "zod";
import { isPlayableConnDate } from "@/lib/connections/types";
import { PDK_CELLS, PDK_DIFFICULTIES, PDK_FAMILIES } from "@/lib/pikadoku/types";
import { dailyGrid, parseSettings, practiceGrid } from "./pikadoku";
import { masterFor } from "./pikadoku-master";

/** The request fields shared by every Pikadoku endpoint: a daily or a practice seed. */
export const gridFields = {
  date: z.string().max(10).optional(),
  difficulty: z.enum(PDK_DIFFICULTIES as [string, ...string[]]).default("normal"),
  practice: z.string().regex(/^[a-z0-9]{4,24}$/).optional(),
  /** A past daily played from the archive: never counted for the day's stats, board or streak. */
  archive: z.boolean().optional(),
  settings: z
    .object({
      unlimitedPP: z.boolean().optional(),
      softLockGuard: z.boolean().optional(),
      allowSingle: z.boolean().optional(),
      timer: z.boolean().optional(),
      families: z.array(z.enum(PDK_FAMILIES as [string, ...string[]])).max(6).optional(),
    })
    .optional(),
};

export const guessSchema = z.object({ cell: z.number().int().min(0).max(PDK_CELLS - 1), id: z.number().int().positive().max(12000) });
export const historySchema = z.array(guessSchema).max(PDK_CELLS * 40);

interface Named {
  date?: string;
  difficulty: string;
  practice?: string;
  settings?: Parameters<typeof parseSettings>[0];
}

/** The grid a request names (never its answers), or an error. */
export function resolveGrid(q: Named) {
  const settings = parseSettings(q.settings);
  const difficulty = q.difficulty as "easy" | "normal" | "expert";
  if (q.date && !q.practice) {
    if (!isPlayableConnDate(q.date)) return { error: "That daily isn't available." } as const;
    return { grid: dailyGrid(q.date, difficulty), settings, daily: true as const, key: `${q.date}:${difficulty}`, master: difficulty === "normal" ? masterFor(q.date)?.by : undefined };
  }
  if (q.practice && !q.date) return { grid: practiceGrid(q.practice, settings), settings, daily: false as const, key: `p:${q.practice}` };
  return { error: "Ask for a daily (date) or an Unlimited grid (practice)." } as const;
}
