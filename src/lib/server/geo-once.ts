import "server-only";
import type { NextRequest } from "next/server";
import { normalizeProgress } from "@/lib/progress-merge";
import { loadProgress } from "./accounts";
import { sessionTokenHash, userFromRequest } from "./auth";
import { geoDailyShots } from "./geo";
import { geoStatsKey, playedDailyRound } from "./geo-round-scores";

/**
 * The Daily and the Weekly are played once: a browser is held to it by the
 * cookie the start sets, and a signed-in trainer also by what their account
 * already holds, on any device: the progress it keeps (the Daily's or the
 * Weekly's score, once one is finished) and, for the Daily, the rounds logged
 * under the account (a round of it graded). Nothing new is stored for it.
 */

/** The account check never holds a start up longer than this: past it (or on any error) the start goes ahead. */
const CHECK_MS = 2_000;

/** Whether the signed-in trainer behind a request has already played (or started) this Daily or this Weekly. Guests: false. */
export async function playedOnAccount(request: NextRequest, game: { daily: string } | { weekly: string }): Promise<boolean> {
  if (!sessionTokenHash(request)) return false;
  const check = (async () => {
    const user = await userFromRequest(request);
    if (!user) return false;
    const key = "daily" in game ? `geo-daily:${game.daily}` : `geo-weekly:${game.weekly}`;
    if (normalizeProgress(await loadProgress(user.id))?.best[key] !== undefined) return true;
    return "daily" in game ? playedDailyRound(geoStatsKey(`u:${user.id}`), game.daily, geoDailyShots(game.daily)) : false;
  })().catch(() => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((done) => (timer = setTimeout(() => done(false), CHECK_MS)));
  return Promise.race([check, late]).finally(() => clearTimeout(timer));
}
