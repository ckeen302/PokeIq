import "server-only";
import { isCurrentConnDate } from "@/lib/connections/types";
import { betterResult } from "@/lib/pikadoku/score";
import { PDK_CELLS, type PdkDifficulty, type PdkGuess, type PdkResultResponse, type PdkSettings } from "@/lib/pikadoku/types";
import { dailyGrid, practiceGrid, ppFor, replayGuesses, revealFor } from "./pikadoku";
import { pdkElapsed, pdkPlayerKey, pdkStore, pickPct, scoreAnswers, standingOf, type PdkCounts, type PdkStore } from "./pikadoku-board";

export interface PdkFinishInput {
  /** A daily (date + difficulty) or a practice seed with its settings. */
  date?: string;
  difficulty: PdkDifficulty;
  practice?: string;
  settings: PdkSettings;
  guesses: PdkGuess[];
  giveUp?: boolean;
  /** "u:<account id>" or "d:<browser id>". */
  identity: string;
  name?: string | null;
  start?: string;
}

export type PdkFinishOutcome = { ok: true; result: PdkResultResponse } | { ok: false; status: number; error: string };

const plus = (c: PdkCounts, answers: ReadonlyMap<number, number>): PdkCounts => ({
  totals: c.totals.map((t, i) => t + (answers.has(i) ? 1 : 0)),
  picks: c.picks.map((m, i) => {
    const copy = new Map(m);
    if (answers.has(i)) copy.set(answers.get(i)!, (copy.get(answers.get(i)!) ?? 0) + 1);
    return copy;
  }),
});

/**
 * Plays the whole game again; when it's over, records it (for today's daily)
 * and returns the score, rarities, rank and the answers reveal. The reveal is
 * only built here, after the server's own replay says the game has ended.
 */
export async function finishGame(input: PdkFinishInput, store: PdkStore | null = pdkStore(), now = Date.now()): Promise<PdkFinishOutcome> {
  const daily = !!input.date && !input.practice;
  if (daily && !/^\d{4}-\d{2}-\d{2}$/.test(input.date!)) return { ok: false, status: 400, error: "Bad date." };
  const grid = daily ? dailyGrid(input.date!, input.difficulty) : practiceGrid(input.practice ?? "x", input.settings);
  let replay;
  try {
    replay = replayGuesses(grid, input.guesses, { pp: ppFor(daily, input.settings), giveUp: input.giveUp });
  } catch (err) {
    return { ok: false, status: 400, error: (err as Error).message };
  }
  if (!replay.over) return { ok: false, status: 409, error: "Finish the grid first." };
  const answers = new Map(replay.locked);
  const counted = daily && isCurrentConnDate(input.date, now);
  const player = pdkPlayerKey(input.identity);
  let counts: PdkCounts | null = null;
  let rank = null;
  let score: number | null = null;
  let pcts: (number | null)[] | null = null;
  if (store && daily) {
    let saved: boolean | null = false;
    if (counted) saved = await store.saveAnswers({ date: input.date!, difficulty: input.difficulty, player, name: input.name ?? null, answers, ms: null });
    const base = await store.counts(input.date!, input.difficulty);
    // A game that wasn't stored (an archive day) is counted in virtually; a stored one already is.
    counts = base && (counted && saved !== null ? base : plus(base, answers));
    if (counts) {
      ({ score, pcts } = scoreAnswers(counts, answers));
      if (counted) {
        const ms = pdkElapsed(input.start, `${input.date}:${input.difficulty}`, now) ?? 0;
        const mine = { player, name: input.name ?? "", solved: answers.size, score, ms };
        if (saved && input.name && ms > 0) await store.saveBoard(input.date!, input.difficulty, mine);
        const rows = (await store.board(input.date!, input.difficulty)) ?? [];
        const others = rows.filter((r) => r.player !== player);
        const merged = rows.some((r) => r.player === player) ? rows : [...others, mine].sort(betterResult);
        rank = standingOf(merged, player);
      }
    }
  }
  const c = counts;
  const reveal = revealFor(grid, replay.wrong, c ? (cell, id) => pickPct(c, cell, id) : undefined);
  return {
    ok: true,
    result: { won: replay.won, solved: answers.size, locked: Object.fromEntries(answers), pcts: pcts && pcts.length === PDK_CELLS ? pcts : null, score, rank, counted: counted && !!c, reveal },
  };
}
