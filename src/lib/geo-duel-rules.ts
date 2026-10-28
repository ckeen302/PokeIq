/**
 * PokéGuessr duel rules that both the server (which applies them) and the
 * HUD (which only animates what the server stamped) read from one place:
 * the damage multiplier ramp, each trainer's own multiplier, damage in full,
 * Turbo's timer cap, the HP bar's colours and the reveal's timeline.
 */

/** Each trainer starts with this much HP. */
export const DUEL_HP = 6000;

/** The multiplier climbs by this much every DUEL_MULTIPLIER_STEP_ROUNDS rounds: ×1 for rounds 1–3, ×1.5 for 4–6, ×2 for 7–9, ×2.5 for 10–12… */
export const DUEL_MULTIPLIER_STEP_ROUNDS = 3;
export const DUEL_MULTIPLIER_STEP = 0.5;

/** The ramp's multiplier for a round (`index` is 0-based). */
export const rampMultiplier = (index: number): number => 1 + Math.floor(Math.max(0, index) / DUEL_MULTIPLIER_STEP_ROUNDS) * DUEL_MULTIPLIER_STEP;

/**
 * Each trainer's own multiplier for a round, one per seat. Multipliers are
 * individual (as GeoGuessr's since April 2026): the round's winner deals
 * damage at *their* multiplier. Both trainers ramp on the round's schedule.
 */
export const seatMultipliers = (index: number, seats = 2): number[] => Array.from({ length: seats }, () => rampMultiplier(index));

export interface RoundDamage {
  /** The seat that won the round, or null for a tie. */
  winner: number | null;
  /** The seat that took the damage, or null for a tie. */
  hurt: number | null;
  /** The score gap times the winner's multiplier, in full: never capped at the loser's remaining HP. */
  damage: number;
  /** The multiplier that applied: the winner's own (1 on a tie). */
  multiplier: number;
}

/** The round's damage from both scores and both trainers' multipliers. */
export function roundDamage(scores: readonly number[], multipliers: readonly number[]): RoundDamage {
  if (scores[0] === scores[1]) return { winner: null, hurt: null, damage: 0, multiplier: 1 };
  const winner = scores[0] > scores[1] ? 0 : 1;
  const multiplier = multipliers[winner] ?? 1;
  return { winner, hurt: 1 - winner, damage: Math.round(Math.abs(scores[0] - scores[1]) * multiplier), multiplier };
}

/** HP after a round: damage lands in full, HP never goes below 0. */
export const hpAfter = (hp: readonly number[], hurt: number | null, damage: number): number[] => hp.map((h, seat) => (seat === hurt ? Math.max(0, h - damage) : h));

/** Once one trainer guesses, the other has this long (the classic rule). */
export const DUEL_COUNTDOWN_MS = 15_000;
/** Turbo (a party setting): a guess caps the opponent's remaining time at this instead. */
export const DUEL_TURBO_CAP_MS = 10_000;

/** How long the other trainer has after the first guess. */
export const countdownAfterGuess = (turbo: boolean): number => (turbo ? DUEL_TURBO_CAP_MS : DUEL_COUNTDOWN_MS);

/** When guessing closes: at the round's own limit, or the countdown after the first guess, whichever is sooner. */
export function closesAfterGuess(startsAt: number, roundMs: number, firstGuessAt: number | null, turbo = false): number {
  const limit = startsAt + roundMs;
  return firstGuessAt === null ? limit : Math.min(limit, firstGuessAt + countdownAfterGuess(turbo));
}

/** The countdown bar flashes red for its last few seconds. */
export const DUEL_COUNTDOWN_FLASH_MS = 5_000;

// ---------------------------------------------------------------------------
// HP bar colours (Pokémon's: green, yellow at half, red at a fifth)
// ---------------------------------------------------------------------------

export type HpColor = "green" | "yellow" | "red";
export const HP_YELLOW_AT = 0.5;
export const HP_RED_AT = 0.2;

export function hpColor(fraction: number): HpColor {
  if (fraction <= HP_RED_AT) return "red";
  if (fraction <= HP_YELLOW_AT) return "yellow";
  return "green";
}

export const HP_COLOR_HEX: Record<HpColor, [string, string]> = {
  green: ["#9ae84a", "#58b529"],
  yellow: ["#f9d348", "#e9a420"],
  red: ["#ff6b5c", "#d8322a"],
};

// ---------------------------------------------------------------------------
// The reveal's timeline
// ---------------------------------------------------------------------------

/** A hit this hard gets the "It's super effective!" pop. */
export const SUPER_EFFECTIVE_MIN = 2000;

/** How long each beat of the reveal takes. */
export const REVEAL_BEATS = {
  /** Both scores count up. */
  scores: 1000,
  /** The damage number floats up from the loser's bar. */
  float: 450,
  /** The loser's bar drains while its number counts down. */
  drain: 1200,
  /** "It's super effective!" */
  superPop: 700,
  /** The ring to the next round. */
  nextRing: 3000,
  /** A breath between beats. */
  gap: 200,
} as const;

export interface RevealTimeline {
  /** Scores start counting up (t = 0). */
  scoresAt: number;
  scoresDone: number;
  /** The damage number appears; null on a tie. */
  damageAt: number | null;
  /** The bar starts draining; null on a tie. */
  drainAt: number | null;
  drainDone: number | null;
  /** "It's super effective!"; null unless the hit was big enough. */
  superAt: number | null;
  /** Everything has landed. */
  total: number;
}

/** When each beat of a revealed round happens, in ms from the reveal. `instant` (reduced motion) lands everything at once. */
export function revealTimeline(result: { hurt: number | null; damage: number }, instant = false): RevealTimeline {
  if (instant) {
    const hit = result.hurt !== null;
    return { scoresAt: 0, scoresDone: 0, damageAt: hit ? 0 : null, drainAt: hit ? 0 : null, drainDone: hit ? 0 : null, superAt: hit && result.damage >= SUPER_EFFECTIVE_MIN ? 0 : null, total: 0 };
  }
  const scoresDone = REVEAL_BEATS.scores;
  if (result.hurt === null) return { scoresAt: 0, scoresDone, damageAt: null, drainAt: null, drainDone: null, superAt: null, total: scoresDone + REVEAL_BEATS.gap };
  const damageAt = scoresDone + REVEAL_BEATS.gap;
  const drainAt = damageAt + REVEAL_BEATS.float;
  const drainDone = drainAt + REVEAL_BEATS.drain;
  const superAt = result.damage >= SUPER_EFFECTIVE_MIN ? drainAt : null;
  return { scoresAt: 0, scoresDone, damageAt, drainAt, drainDone, superAt, total: drainDone + REVEAL_BEATS.gap };
}

/** Ease-out cubic, 0..1. */
export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** A number counting from `from` to `to`: its value `elapsed` ms into a count lasting `ms`. */
export function countValue(from: number, to: number, elapsed: number, ms: number, ease: (t: number) => number = easeOutCubic): number {
  if (ms <= 0 || elapsed >= ms) return to;
  if (elapsed <= 0) return from;
  return Math.round(from + (to - from) * ease(elapsed / ms));
}

/** HP before a round, from the HP after each earlier one. */
export const hpBefore = (revealed: readonly { hp: readonly number[] }[], index: number, start = DUEL_HP): number[] =>
  index > 0 && revealed[index - 1] ? [...revealed[index - 1].hp] : [start, start];
