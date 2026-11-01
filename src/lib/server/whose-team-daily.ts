import "server-only";
import { Rng } from "@/lib/rng";
import { buildQuestion, type Question } from "@/engines";
import type { SessionSpec } from "@/lib/session-types";
import { TEAM_DAILY_FROM } from "@/lib/whose-team";
import { deriveSeed } from "./crypto";

/**
 * The Daily Challenge's Whose Team Is This? round: from TEAM_DAILY_FROM on,
 * the daily's last question is a Normal round (the whole team shown). It is
 * drawn from its own seeded stream, so questions 1–9 of every daily, and all
 * ten of the dailies before that date, are exactly what they were.
 * Keyed on the seed, so a challenge replay of a daily gets the same round.
 */

export { TEAM_DAILY_FROM };
export const TEAM_DAILY_INDEX = 9;

const DAILY_SEED = /^daily:(\d{4}-\d{2}-\d{2})$/;

export function isTeamDailySlot(spec: Pick<SessionSpec, "module" | "seed" | "format">, index: number): boolean {
  if (spec.module !== "mixed" || spec.format !== "classic" || index !== TEAM_DAILY_INDEX) return false;
  const date = DAILY_SEED.exec(spec.seed)?.[1];
  return date !== undefined && date >= TEAM_DAILY_FROM;
}

const cache = new Map<string, Question>();

export function dailyTeamQuestion(spec: Pick<SessionSpec, "seed">): Question {
  let q = cache.get(spec.seed);
  if (!q) {
    q = buildQuestion("whose-team", new Rng(deriveSeed("daily-team", spec.seed)), { difficulty: "medium", used: new Set() });
    cache.set(spec.seed, q);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return q;
}
