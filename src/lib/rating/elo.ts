/**
 * Pokémon Showdown's Elo, as its ladders rate battles: the rating engine
 * shared by the battle ladder and ranked PokéGuessr. Client safe.
 *
 * Everyone starts at 1,000 and nobody drops below it. The K-factor follows
 * Showdown's curve: a new trainer gains a lot from a win (K 90 at 1,000)
 * and loses little from a loss (K 10), the two meeting at K 50 by 1,200;
 * then K is 32, or 40 in the 1,350–1,600 band where ladders are busiest.
 *
 * Decay runs once per UTC day, only above 1,400: nothing after six or more
 * games that day; with one to five games, one point for every 100 above
 * 1,500; with none, one point for every 50 above 1,400. It is applied
 * lazily (when a rating is read or a game is counted), never by a cron.
 */

export const ELO_START = 1000;
export const ELO_FLOOR = 1000;

/** Decay only touches ratings above this. */
export const ELO_DECAY_FROM = 1400;
/** Games in a day that stop decay altogether. */
export const ELO_DECAY_SAFE_GAMES = 6;

/** The chance (0 to 1) Elo gives `me` of beating `foe`. */
export function eloExpected(me: number, foe: number): number {
  return 1 / (1 + 10 ** ((foe - me) / 400));
}

/** Showdown's K-factor for a trainer at `oldElo` scoring `score` (1 win, ½ draw, 0 loss). */
export function eloK(oldElo: number, score: number): number {
  if (oldElo < 1200) {
    if (score < 0.5) return 10 + ((oldElo - 1000) * 40) / 200;
    if (score > 0.5) return 90 - ((oldElo - 1000) * 40) / 200;
    return 50;
  }
  if (oldElo > 1350 && oldElo <= 1600) return 40;
  return 32;
}

/** `me`'s rating after a game against `foe` scoring `score`: K from `me`'s own rating and result, never below the floor. */
export function eloUpdate(me: number, foe: number, score: number): number {
  return Math.max(ELO_FLOOR, me + eloK(me, score) * (score - eloExpected(me, foe)));
}

/**
 * One day's decay of `elo` after `gamesThatDay` games. `popular` (the
 * default) is the full curve above; a quiet ladder (`popular` false)
 * decays at half the rate, rounded down, so a small pool isn't drained.
 */
export function eloDecay(elo: number, gamesThatDay: number, popular = true): number {
  if (elo <= ELO_DECAY_FROM || gamesThatDay >= ELO_DECAY_SAFE_GAMES) return elo;
  const points = gamesThatDay > 0 ? Math.max(0, Math.floor((elo - 1500) / 100)) : Math.max(0, Math.floor((elo - ELO_DECAY_FROM) / 50));
  return Math.max(ELO_FLOOR, elo - (popular ? points : Math.floor(points / 2)));
}

/** `elo` after `days` days, with `gamesPerDay[i]` games on day i (none when absent). */
export function eloDecayDays(elo: number, days: number, gamesPerDay: number[]): number {
  let e = elo;
  for (let i = 0; i < days; i++) {
    const games = gamesPerDay[i] ?? 0;
    // Below the decay line, or short of a point with no games, nothing more can happen.
    if (e <= ELO_DECAY_FROM || (games === 0 && i >= gamesPerDay.length && e - ELO_DECAY_FROM < 50)) break;
    e = eloDecay(e, games);
  }
  return e;
}
