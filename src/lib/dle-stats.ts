import { DLE_MAX_GUESSES } from "./dle-types";

/**
 * Pokédle's stats, worked out from the daily results alone (never practice
 * or the archive), so they need no stored counters and survive syncing:
 *
 * - the play streak counts days in a row with the daily finished, won or
 *   lost; the win streak, days in a row solved;
 * - every 7 days of play streak earn a streak freeze (2 at most); a missed
 *   day spends one automatically, and both streaks carry on past it.
 */
export interface DleResultLike {
  guesses: number[];
  solved: boolean;
  over: boolean;
  hard?: boolean;
}

export const DLE_FREEZE_EVERY = 7;
export const DLE_MAX_FREEZES = 2;

export interface DleStats {
  played: number;
  wins: number;
  /** 0–100, rounded. */
  winPct: number;
  playStreak: number;
  bestPlayStreak: number;
  winStreak: number;
  bestWinStreak: number;
  /** Freezes held now. */
  freezes: number;
  /** The missed days a freeze covered. */
  frozenDays: string[];
  /** A freeze covered a day of the current play streak. */
  savedByFreeze: boolean;
  /** Wins by guess count: [0] is a first-guess solve. */
  distribution: number[];
  losses: number;
  hardWins: number;
  /** Today's daily is finished. */
  doneToday: boolean;
  /** A play streak that ends unless today's daily is finished. */
  atRisk: boolean;
}

const DAY_MS = 86_400_000;
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** `maxGuesses`: the format's guesses (8 for Classic, 9 for the Squirdle-style daily), the distribution's length. */
export function dleStats(results: Readonly<Record<string, DleResultLike>>, today: string, maxGuesses: number = DLE_MAX_GUESSES): DleStats {
  const finished = Object.keys(results)
    .filter((d) => d <= today && results[d].over)
    .sort();
  const stats: DleStats = {
    played: finished.length,
    wins: 0,
    winPct: 0,
    playStreak: 0,
    bestPlayStreak: 0,
    winStreak: 0,
    bestWinStreak: 0,
    freezes: 0,
    frozenDays: [],
    savedByFreeze: false,
    distribution: Array<number>(maxGuesses).fill(0),
    losses: 0,
    hardWins: 0,
    doneToday: results[today]?.over === true,
    atRisk: false,
  };
  for (const d of finished) {
    const r = results[d];
    if (r.solved) {
      stats.wins++;
      const n = Math.min(Math.max(r.guesses.length, 1), maxGuesses);
      stats.distribution[n - 1]++;
      if (r.hard) stats.hardWins++;
    } else stats.losses++;
  }
  stats.winPct = stats.played ? Math.round((100 * stats.wins) / stats.played) : 0;

  if (finished.length) {
    for (let d = finished[0]; d <= today; d = nextDate(d)) {
      const r = results[d];
      if (r?.over) {
        stats.playStreak++;
        stats.winStreak = r.solved ? stats.winStreak + 1 : 0;
        if (stats.playStreak % DLE_FREEZE_EVERY === 0) stats.freezes = Math.min(DLE_MAX_FREEZES, stats.freezes + 1);
      } else if (d !== today) {
        // A missed day (today still has time).
        if (stats.playStreak > 0 && stats.freezes > 0) {
          stats.freezes--;
          stats.frozenDays.push(d);
          stats.savedByFreeze = true;
        } else {
          stats.playStreak = 0;
          stats.winStreak = 0;
          stats.savedByFreeze = false;
        }
      }
      stats.bestPlayStreak = Math.max(stats.bestPlayStreak, stats.playStreak);
      stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.winStreak);
    }
  }
  stats.atRisk = !stats.doneToday && stats.playStreak > 0;
  return stats;
}
