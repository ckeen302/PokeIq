/**
 * Glicko-2 ratings for the battle ladder (Mark Glickman's "Example of the
 * Glicko-2 system", 2013), with GXE as Pokémon Showdown shows it.
 *
 * Every trainer has a rating, a rating deviation (RD: how sure the ladder is
 * of that rating) and a volatility (how erratic their results are). A new
 * trainer starts at 1500 ± 350; each ranked battle is one rating period with
 * one game, so ratings move after every battle. A big RD moves a rating a
 * lot; it shrinks as games come in (never below RD_FLOOR, so a rating can
 * always still move).
 *
 * GXE ("Glicko X-Act Estimate") is the chance, in percent, that a trainer
 * would beat a random trainer from the ladder, from their rating and RD: the
 * formula Showdown's ladder uses.
 */

export interface GlickoState {
  rating: number;
  rd: number;
  vol: number;
}

export const GLICKO_START: GlickoState = { rating: 1500, rd: 350, vol: 0.06 };
/** Constrains the change in volatility over time (Glickman suggests 0.3 to 1.2). */
export const GLICKO_TAU = 0.5;
/** An RD never drops below this, so a settled rating still moves. */
export const RD_FLOOR = 30;
export const RD_MAX = 350;
/** Showdown's ladder only shows a GXE (and counts a trainer as rated) once their RD is below this. */
export const GXE_RD_SHOWN = 100;

const SCALE = 173.7178;
const EPSILON = 0.000001;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/** The new rating, RD and volatility after one game against `them` (score 1 win, ½ draw, 0 loss). */
export function glickoUpdate(me: GlickoState, them: GlickoState, score: number): GlickoState {
  const mu = (me.rating - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (them.rating - 1500) / SCALE;
  const phiJ = them.rd / SCALE;
  const gJ = g(phiJ);
  const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
  const v = 1 / (gJ * gJ * e * (1 - e));
  const delta = v * gJ * (score - e);

  // The new volatility (step 5: the Illinois algorithm).
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (GLICKO_TAU * GLICKO_TAU);
  };
  let lo = a;
  let hi: number;
  if (delta * delta > phi * phi + v) hi = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * GLICKO_TAU) < 0) k += 1;
    hi = a - k * GLICKO_TAU;
  }
  let fLo = f(lo);
  let fHi = f(hi);
  for (let i = 0; i < 100 && Math.abs(hi - lo) > EPSILON; i++) {
    const c = lo + ((lo - hi) * fLo) / (fHi - fLo);
    const fC = f(c);
    if (fC * fHi <= 0) {
      lo = hi;
      fLo = fHi;
    } else fLo /= 2;
    hi = c;
    fHi = fC;
  }
  const vol = Math.exp(lo / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gJ * (score - e);
  return {
    rating: 1500 + SCALE * muNew,
    rd: Math.min(RD_MAX, Math.max(RD_FLOOR, SCALE * phiNew)),
    vol,
  };
}

/** Both trainers' new states after a battle (rating rounded to a whole number, RD to two places, as stored). */
export function rateGlicko(players: readonly [GlickoState, GlickoState], scores: readonly [number, number]): [GlickoState, GlickoState] {
  const round = (s: GlickoState): GlickoState => ({ rating: Math.max(0, Math.round(s.rating)), rd: Math.round(s.rd * 100) / 100, vol: Math.round(s.vol * 1e6) / 1e6 });
  return [round(glickoUpdate(players[0], players[1], scores[0])), round(glickoUpdate(players[1], players[0], scores[1]))];
}

/** GXE: the chance (percent, two places) of beating a random ladder trainer, as Pokémon Showdown computes it. */
export function gxe(rating: number, rd: number): number {
  const ln10 = Math.log(10);
  const denom = Math.sqrt(3 * ln10 * ln10 * rd * rd + 2500 * (64 * Math.PI * Math.PI + 147 * ln10 * ln10));
  return Math.round(10000 / (1 + 10 ** (((1500 - rating) * Math.PI) / denom))) / 100;
}

/** "1623 ± 54". */
export const glickoLabel = (rating: number, rd: number) => `${Math.round(rating)} ± ${Math.round(rd)}`;
