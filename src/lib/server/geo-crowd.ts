import "server-only";
import { aggregateCrowd, crowdAllowed, firstPinPerPlayer, type GeoCrowd, type GeoCrowdRound } from "@/lib/geo-crowd";
import { geoRoundsOf, type GeoAnswer, type GeoResult } from "@/lib/geo-types";
import { verifyToken } from "./crypto";
import { geoDailyAnswers, mapPointOf, mapSize } from "./geo";
import { RoundScoresUnavailable, roundScoreStore, type RoundScoreStore } from "./geo-round-scores";

/**
 * The Daily's crowd map on the server: the day's logged pins (migration 0050)
 * on its five screenshots, one per trainer, moved onto the Daily's map and
 * counted into a coarse grid (src/lib/geo-crowd.ts). Read at most once per
 * CROWD_TTL_MS per day per server instance, like the daily stats. Fails
 * closed to an empty map: no store, no pin columns yet, or a read error.
 */

const CROWD_TTL_MS = 30_000;
const DAY_MS = 86_400_000;
const recent = new Map<string, { at: number; crowd: Promise<GeoCrowd> }>();
let warned = 0;

/** Clears the per-day cache (tests). */
export function clearCrowdCache() {
  recent.clear();
}

/** The date of the Daily a signed result token finished, or null (not a finished Daily, or tampered). */
export function finishedDaily(resultToken: unknown): string | null {
  if (typeof resultToken !== "string" || !resultToken) return null;
  const result = verifyToken<GeoResult>("geo-result", resultToken);
  const date = result?.spec?.daily;
  if (!result || typeof date !== "string" || result.spec.kind !== "game" || !Array.isArray(result.rounds)) return null;
  return result.rounds.length >= geoRoundsOf(result.spec) ? date : null;
}

/** The spoiler guard: may this request see `date`'s crowd map? */
export function crowdAccess(date: string, resultToken: unknown, now = Date.now()): boolean {
  return crowdAllowed(date, finishedDaily(resultToken), now);
}

async function readCrowd(date: string, store: RoundScoreStore | null): Promise<GeoCrowd> {
  const empty: GeoCrowd = { date, rounds: [] };
  const daily = geoDailyAnswers(date);
  if (!store?.dailyPins || !daily?.rounds.length) return empty;
  const shots = daily.rounds.map((r) => r.shot);
  const start = Date.parse(`${date}T00:00:00Z`);
  // A Daily is graded while its date is within a day of today in UTC.
  const rows = await store.dailyPins(shots, start - DAY_MS, start + 2 * DAY_MS);
  const { width, height } = mapSize(daily.region);
  const rounds: GeoCrowdRound[] = [];
  daily.rounds.forEach((r, i) => {
    const pins = firstPinPerPlayer(rows.filter((row) => row.shot === r.shot)).flatMap((row) => {
      const p = mapPointOf(daily.region, row.pin[0], row.pin[1]);
      return p ? [p] : [];
    });
    const round = aggregateCrowd(pins, { width, height }, i + 1);
    if (round) rounds.push(round);
  });
  return { date, rounds };
}

/** A day's crowd map (cached): call only after crowdAccess said yes. */
export function dailyCrowd(date: string, store = roundScoreStore()): Promise<GeoCrowd> {
  const now = Date.now();
  const hit = recent.get(date);
  if (hit && now - hit.at < CROWD_TTL_MS) return hit.crowd;
  if (recent.size > 20) recent.clear();
  const crowd = readCrowd(date, store).catch((err) => {
    if (!(err instanceof RoundScoresUnavailable)) console.error("[geo-crowd] read failed:", err);
    else if (Date.now() - warned > 10 * 60_000) {
      warned = Date.now();
      console.warn("[geo-crowd] off until migration 0050_geo_round_pins.sql is applied");
    }
    // A failed read isn't kept: the next request tries again.
    recent.delete(date);
    return { date, rounds: [] } as GeoCrowd;
  });
  recent.set(date, { at: now, crowd });
  return crowd;
}

/** A round's answer on the Daily's map, for the share card (after crowdAccess said yes). */
export function dailyRoundAnswer(date: string, round: number): { region: string; answer: GeoAnswer } | null {
  const daily = geoDailyAnswers(date);
  const r = daily?.rounds[round - 1];
  return daily && r ? { region: daily.region, answer: r.answer } : null;
}
