/**
 * How a Pokémon values its status moves (and the attacks that cost it a
 * turn or itself), shared by the battle (engine.ts) and the check against
 * Showdown's simulator (scripts/mass-battle-crosscheck.ts), so both sides
 * of that check choose the same way.
 *
 * Everything is in one currency: the damage the Pokémon expects to deal
 * over the turns the fight has left for it. Attacking every turn is worth
 * E × H, where E is its best attack's expected damage this turn (capped at
 * what the target has left) and H the turns ahead: the fewer of the turns
 * it lasts at the damage coming its way (its HP over the expected damage it
 * takes a turn) and the turns the foes last at the damage its side plans
 * to deal (their HP over it), at most HORIZON. A Pokémon in a horde around
 * one boss has a short fight ahead (its side knocks the boss out soon), a
 * boss facing a horde a long one. Every other option is the same sum along
 * another path:
 *
 * - a boost spends this turn to hit harder (E') or last longer (H') after:
 *   E' × (H' − 1);
 * - healing and Rest buy turns: E × (H' − 1), and Rest sleeps two;
 * - a status condition on the target adds its chip damage (burns, poison,
 *   Leech Seed) and cuts what the target does to it (burns halve physical
 *   hits, paralysis stops a quarter of them, sleep all of them for two
 *   turns), at the move's accuracy;
 * - Protect buys a turn of the target's chip damage;
 * - a screen cuts the damage it takes for five turns;
 * - Explosion is worth the damage it does now (foes' minus allies');
 *   Memento the halving of its target's damage over the horizon.
 *
 * The option worth most is used; on a tie, the attack. So a boss facing a
 * horde never sets up (each foe it knocks out is a fresh one, E' = E), a
 * Pokémon heals when it's low and under fire, and nothing uses a status
 * move on a target that already has a status or can't get one (those are
 * worth nothing: the callers pass E only).
 */

/** Turns ahead a Pokémon plans for. */
export const HORIZON = 5;

export interface Outlook {
  /** Best attack's expected damage this turn (0 if none). */
  E: number;
  hp: number;
  maxHp: number;
  /** Expected damage it takes a turn: in all, from physical moves, and from its own target (and that part's physical share). */
  incoming: number;
  incomingPhys: number;
  fromTarget: number;
  fromTargetPhys: number;
  targetHp: number;
  targetMax: number;
  /** HP the foes have left, and the damage its side (itself included) plans to deal them this turn. */
  foeHp: number;
  sideDmg: number;
}

/** Turns it lasts at `incoming` a turn (HORIZON when nothing's coming). */
export const horizon = (hp: number, incoming: number) => (incoming > 1e-9 ? Math.min(HORIZON, hp / incoming) : HORIZON);

/** Turns the foes last at the side's damage, attacking every turn. */
const foeTurns = (o: Outlook) => (o.sideDmg > 1e-9 ? o.foeHp / o.sideDmg : Infinity);
/** The same after a turn it spends on something else, hitting for `Enew` after it. */
const foeTurnsAfter = (o: Outlook, Enew: number) => {
  const rest = o.sideDmg - o.E;
  const left = Math.max(0, o.foeHp - Math.max(0, rest));
  const dmg = rest + Enew;
  return dmg > 1e-9 ? 1 + left / dmg : Infinity;
};

/** Turns ahead, attacking every turn. */
const ahead = (o: Outlook) => Math.min(horizon(o.hp, o.incoming), foeTurns(o));

/** Attacking every turn. */
export const attackTotal = (o: Outlook) => o.E * Math.max(1, ahead(o));

/** A turn spent, then attacking for the rest of the turns ahead (`H` the turns it lasts that way). */
const after = (o: Outlook, E: number, H: number) => E * Math.max(0, Math.min(H, foeTurnsAfter(o, E)) - 1);

/**
 * A boost: `Eb` is its best attack's expected damage with the new stages; `defMul` and `spdMul` what the new Defense
 * and Sp. Def stages do to physical and special damage taken (1 for none).
 */
export function boostTotal(o: Outlook, Eb: number, defMul: number, spdMul: number): number {
  const inc = o.incomingPhys * defMul + (o.incoming - o.incomingPhys) * spdMul;
  return after(o, Eb, horizon(o.hp, inc));
}

/** Healing `amount` HP (capped at what it has lost). */
export function healTotal(o: Outlook, amount: number): number {
  const got = Math.min(amount, o.maxHp - o.hp);
  if (got <= 0) return 0;
  // With nothing to attack with, the turns it buys still count (barely): it stays in the fight for its side.
  if (o.E <= 0) return o.incoming > 0 ? 1e-6 * got : 0;
  return after(o, o.E, horizon(o.hp + got, o.incoming));
}

/** Rest: full HP, then two turns asleep. */
export function restTotal(o: Outlook): number {
  if (o.hp >= o.maxHp) return 0;
  return o.E * Math.max(0, Math.min(horizon(o.maxHp, o.incoming), foeTurnsAfter(o, o.E) + 2) - 3);
}

/** Chip damage over the turns it lasts, `perTurn(k)` on turn k (1-based), capped at the target's HP. */
function chipOver(o: Outlook, perTurn: (k: number) => number): number {
  const H = Math.max(1, Math.round(Math.min(HORIZON, ahead(o) + 1)));
  let sum = 0;
  for (let k = 1; k <= H; k++) sum += perTurn(k);
  return Math.min(o.targetHp, sum);
}

/**
 * A status condition (or confusion, or Leech Seed) on its target, landing with chance `p`. `blockTarget`: the share of
 * the target's damage it stops, averaged over the horizon; `chip`: the damage it does over the horizon; `heal`: HP it
 * gives back (Leech Seed).
 */
function inflictTotal(o: Outlook, p: number, blockTarget: number, chip: number, heal = 0): number {
  const H = horizon(o.hp, o.incoming);
  const inc = Math.max(0, o.incoming - o.fromTarget * blockTarget);
  const H2 = horizon(o.hp + Math.min(heal, o.maxHp), inc);
  return p * (chip + after(o, o.E, H2)) + (1 - p) * after(o, o.E, H);
}

export type InflictKind = "par" | "brn" | "psn" | "tox" | "slp" | "confusion" | "leechseed";

export function statusTotal(o: Outlook, kind: InflictKind, p: number): number {
  const H = Math.max(1, ahead(o));
  const m = o.targetMax;
  switch (kind) {
    case "brn": return inflictTotal(o, p, o.fromTarget > 0 ? (0.5 * o.fromTargetPhys) / o.fromTarget : 0, chipOver(o, () => Math.floor(m / 16)));
    case "par": return inflictTotal(o, p, 0.25, 0);
    case "psn": return inflictTotal(o, p, 0, chipOver(o, () => Math.floor(m / 8)));
    case "tox": return inflictTotal(o, p, 0, chipOver(o, (k) => Math.floor((m * Math.min(15, k)) / 16)));
    case "slp": return inflictTotal(o, p, Math.min(1, 2 / H), 0);
    case "confusion": return inflictTotal(o, p, (1 / 3) * Math.min(1, 3 / H), 0);
    case "leechseed": {
      const chip = chipOver(o, () => Math.floor(m / 8));
      return inflictTotal(o, p, 0, chip, chip);
    }
  }
}

/** Protect working with chance `p`: a turn the target's chip damage (`chip`, one turn's) runs while nothing gets through. */
export function protectTotal(o: Outlook, p: number, chip: number): number {
  const H = horizon(o.hp, o.incoming);
  const won = o.E * Math.max(0, Math.min(HORIZON, H + 1, foeTurnsAfter(o, o.E)) - 1) + Math.min(o.targetHp, chip);
  return p * won + (1 - p) * after(o, o.E, H);
}

/** A screen cutting `phys` and `spec` damage taken to these shares for five turns. */
export function screenTotal(o: Outlook, phys: number, spec: number): number {
  const inc = o.incomingPhys * phys + (o.incoming - o.incomingPhys) * spec;
  return after(o, o.E, horizon(o.hp, inc));
}

/** Chance Protect works after `streak` uses in a row (Showdown's: 1, 1/3, 1/9… with a floor of 1/729). */
export const protectChance = (streak: number) => (streak <= 0 ? 1 : 1 / Math.pow(3, Math.min(streak, 6)));
