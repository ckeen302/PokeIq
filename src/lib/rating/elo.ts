/**
 * Elo as Pokémon Showdown's ladder computes it (server/ladders-local.ts and
 * pages/ladderhelp), shared by every ladder on the site. Pure functions: no
 * imports, nothing about battles or any one game.
 *
 * Everyone starts at 1000 and never drops below it; there's no ceiling. After
 * a game, newElo = oldElo + K × (score − expected), where `expected` is the
 * chance Elo gave you of winning, and K (how far one game moves you) comes
 * from your own Elo before the game and the result:
 *
 *   below 1200: a loss costs little and a win pays a lot (K from 10 up to 50
 *               for a loss, 90 down to 50 for a win, as you climb; a tie 50)
 *   1200–1350:  K = 32
 *   1350–1600:  K = 40
 *   above 1600: K = 32
 *
 * So the two players in one game move by different amounts.
 *
 * Elo above 1400 decays, once per UTC day, by how much you played that day:
 * six or more ranked games, none; one to five, a point per 100 points above
 * 1500; none, a point per 50 points above 1400. In a less popular format the
 * decay is two points less (never below none). Decay never takes Elo below
 * the floor.
 */

export const ELO_START = 1000;
export const ELO_FLOOR = 1000;

/** Ranked games in a UTC day that stop Elo decaying that day. */
export const ELO_DECAY_ACTIVE_GAMES = 6;
/** Elo decays only above this. */
export const ELO_DECAY_FROM = 1400;

/** The chance (0 to 1) Elo gives `me` of beating `foe`. */
export function eloExpected(me: number, foe: number): number {
  return 1 / (1 + 10 ** ((foe - me) / 400));
}

/** Showdown's K: from the player's own Elo before the game and the game's score (1 win, 0.5 tie, 0 loss). */
export function eloK(oldElo: number, score: number): number {
  if (oldElo < 1200) {
    if (score < 0.5) return 10 + ((oldElo - 1000) * 40) / 200;
    if (score > 0.5) return 90 - ((oldElo - 1000) * 40) / 200;
    return 50;
  }
  if (oldElo > 1350 && oldElo <= 1600) return 40;
  return 32;
}

/** The new Elo after one game against `foe` (score 1 win, 0.5 tie, 0 loss), never below the floor. */
export function eloUpdate(me: number, foe: number, score: number): number {
  const next = me + eloK(me, score) * (score - eloExpected(me, foe));
  return Math.max(ELO_FLOOR, next);
}

/**
 * Elo after one UTC day of decay, given the ranked games played that day.
 * `popular` is the format's popularity (current-gen OU and Random Battle on
 * Showdown); any other format decays two points less. Defaults to popular.
 */
export function eloDecay(elo: number, gamesThatDay: number, popular = true): number {
  if (elo <= ELO_DECAY_FROM) return elo;
  let loss: number;
  if (gamesThatDay >= ELO_DECAY_ACTIVE_GAMES) loss = 0;
  else if (gamesThatDay > 0) loss = Math.floor((elo - 1500) / 100);
  else loss = Math.floor((elo - ELO_DECAY_FROM) / 50);
  if (!popular) loss -= 2;
  if (loss <= 0) return elo;
  return Math.max(ELO_FLOOR, elo - loss);
}

/**
 * Catch-up: `days` UTC days of decay in a row, with `gamesPerDay[i]` ranked
 * games on day i (a missing entry is no games). For catching a row up on
 * every day since it was last decayed.
 */
export function eloDecayDays(elo: number, days: number, gamesPerDay: number[], popular = true): number {
  let out = elo;
  for (let i = 0; i < days; i++) {
    const games = gamesPerDay[i] ?? 0;
    const next = eloDecay(out, games, popular);
    // No games today and nothing to lose: no later day, with no games either, loses anything.
    if (next === out && games === 0 && gamesPerDay.length <= i + 1) break;
    out = next;
  }
  return out;
}
