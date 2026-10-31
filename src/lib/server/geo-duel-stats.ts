import "server-only";
import { after } from "next/server";
import { GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import type { VersusResult, VersusStats } from "@/lib/duel-stats";
import { answerFor, regionGroupOf, worldPointOf } from "./geo";
import { geoStatsKey, logRoundScore, roundScoreStore, RoundScoresUnavailable, type PlayerRoundRow, type RoundScoreRow, type RoundScoreStore } from "./geo-round-scores";
import type { Duel } from "./duel";

/**
 * PokéGuessr duels on a trainer's record, and the public duel stats the
 * versus intro shows (duels played, how often they lock in first, their
 * strongest and toughest regions, the latest results).
 *
 * A duel's rounds are logged once, when it finishes, for each seat whose
 * trainer was signed in as the seat's name (the route stamps the seat's key
 * when they act), in `geo_round_scores` with kind 'duel' and mode 'duel' or
 * 'ranked'. No extra table: each row's `run_id` is `duel:<code>:<w|l|d>`
 * (the duel and how it went for that trainer) and `hit` says whether they
 * locked in first that round. Rounds a trainer let time out aren't logged
 * (they say nothing about a shot), as in single-player games.
 */

const RESULT_CODE: Record<VersusResult, string> = { win: "w", loss: "l", draw: "d" };
const CODE_RESULT: Record<string, VersusResult> = { w: "win", l: "loss", d: "draw" };
const RUN_RE = /^duel:([a-z0-9]+):([wld])$/;

export const duelRunId = (code: string, result: VersusResult) => `duel:${code}:${RESULT_CODE[result]}`;
export function parseDuelRun(run: string | null): { code: string; result: VersusResult } | null {
  const m = run ? RUN_RE.exec(run) : null;
  return m ? { code: m[1], result: CODE_RESULT[m[2]] } : null;
}

/** How a finished duel went for a seat. */
export function seatResult(duel: Pick<Duel, "end">, seat: number): VersusResult | null {
  if (!duel.end) return null;
  const { winner } = duel.end;
  return winner === null ? "draw" : winner === seat ? "win" : "loss";
}

/**
 * Stamps the seat's stats key when the signed-in trainer acting in it is the
 * seat's name (so a guest who types someone's name never writes to their record).
 * Returns the duel unchanged when there's nothing to stamp.
 */
export function stampStatsKey(duel: Duel, playerId: string, user: { id: string; username: string } | null): Duel {
  if (!user) return duel;
  const seat = duel.players.findIndex((p) => p.id === playerId);
  const p = duel.players[seat];
  if (!p || p.bot || p.name.toLowerCase() !== user.username.toLowerCase()) return duel;
  const key = geoStatsKey(`u:${user.id}`);
  if (p.statsKey === key) return duel;
  return { ...duel, players: duel.players.map((q, i) => (i === seat ? { ...q, statsKey: key } : q)) };
}

/** The rows a finished duel logs: every round each stamped seat guessed, in order. */
export function duelRoundRows(duel: Duel): RoundScoreRow[] {
  if (duel.status !== "finished") return [];
  const rows: RoundScoreRow[] = [];
  duel.players.forEach((p, seat) => {
    const result = seatResult(duel, seat);
    if (!p.statsKey || p.bot || !result) return;
    for (const round of duel.rounds) {
      const mine = round.guesses[seat];
      if (!round.result || !mine) continue;
      const theirs = round.guesses.find((g, s) => s !== seat && g);
      const answer = answerFor({ region: duel.region }, round.plan);
      const region = regionGroupOf(answer.region);
      rows.push({
        shot: round.plan.shot,
        score: round.result.scores[seat] ?? 0,
        mode: duel.ranked ? "ranked" : "duel",
        kind: "duel",
        player: { key: p.statsKey, name: p.name },
        game: duel.code,
        elapsedMs: Math.max(0, mine.at - round.startsAt),
        run: duelRunId(duel.code, result),
        family: answer.family,
        hit: !theirs || mine.at < theirs.at,
        pin: worldPointOf({ region: duel.region }, mine.x, mine.y),
        ...(region ? { region } : {}),
      });
    }
  });
  return rows;
}

/** After a write: when the duel just finished, its rounds go on the stamped trainers' records (after the response). Never throws. */
export function logFinishedDuel(before: Duel | undefined, duel: Duel, store: RoundScoreStore | null = roundScoreStore()): Promise<void> | void {
  if (!store || before?.status === "finished" || duel.status !== "finished") return;
  const rows = duelRoundRows(duel);
  if (!rows.length) return;
  // One at a time, so a trainer's rows keep the duel's order (their latest duel is read from the newest rows).
  const send = async () => {
    for (const row of rows) await logRoundScore(row, store);
  };
  try {
    after(send);
  } catch {
    return send();
  }
}

// ---------------------------------------------------------------------------
// The versus intro's stats
// ---------------------------------------------------------------------------

/** A region needs this many rounds before it can be someone's strongest or toughest. */
export const VERSUS_REGION_MIN_ROUNDS = 3;
const RECENT = 5;
const TOP = 3;

/** A trainer's public duel stats from their logged rounds (newest first). Regions read every pin round, not just duels. */
export function versusStatsFrom(rows: readonly PlayerRoundRow[]): VersusStats {
  const duels: { code: string; result: VersusResult }[] = [];
  const seen = new Set<string>();
  let duelRounds = 0;
  let first = 0;
  const regions = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.kind === "region-streak") continue;
    if (r.region) {
      const s = regions.get(r.region) ?? { sum: 0, n: 0 };
      s.sum += r.score;
      s.n++;
      regions.set(r.region, s);
    }
    if (r.kind !== "duel") continue;
    const run = parseDuelRun(r.run);
    if (!run) continue;
    duelRounds++;
    if (r.hit) first++;
    if (!seen.has(run.code)) {
      seen.add(run.code);
      duels.push(run);
    }
  }
  const ranked = [...regions]
    .filter(([, s]) => s.n >= VERSUS_REGION_MIN_ROUNDS)
    .map(([region, s]) => ({ region, avg: s.sum / s.n / GEO_MAX_ROUND_SCORE }))
    .sort((a, b) => b.avg - a.avg || a.region.localeCompare(b.region));
  const strongest = ranked.slice(0, TOP).map((r) => r.region);
  // The toughest come from what's left, so a trainer with few regions isn't strongest and toughest in the same place.
  const toughest = ranked
    .filter((r) => !strongest.includes(r.region))
    .reverse()
    .slice(0, TOP)
    .map((r) => r.region);
  return {
    duels: duels.length,
    guessedFirst: duelRounds ? Math.round((first / duelRounds) * 100) : null,
    strongest,
    toughest,
    recent: duels.slice(0, RECENT).map((d) => d.result),
  };
}

/** A trainer's duel stats by their stats key: null without a store or before the stats columns exist. Never throws. */
export async function versusStatsOf(key: string, store: RoundScoreStore | null = roundScoreStore()): Promise<VersusStats | null> {
  if (!store) return null;
  try {
    return versusStatsFrom(await store.ofPlayer(key));
  } catch (err) {
    if (!(err instanceof RoundScoresUnavailable)) console.error("[geo-duel-stats] not read:", err);
    return null;
  }
}
