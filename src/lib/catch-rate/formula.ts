/**
 * The capture formulas of the main-series games from Generation III on, as Bulbapedia's "Catch rate" article sets
 * them out (https://bulbapedia.bulbagarden.net/wiki/Catch_rate), with each ball's modifier from Bulbapedia's
 * "Poké Ball" article and the balls' own pages. Pure functions, no data of their own beyond the published constants.
 *
 * In every generation covered here a throw works the same way:
 *  1. a "modified catch rate" a is worked out from the HP left, the species' catch rate, the ball and the status;
 *  2. if a ≥ 255 the Pokémon is caught outright;
 *  3. otherwise a shake value b comes from a, and the game makes a number of "shake checks": each one passes when a
 *     random number from 0 to 65535 is below b. The ball wobbles once per passed check (three at most), and the
 *     Pokémon is caught only when every check passes.
 *
 *  Gen III–IV  a = ⌊⌊(3·MaxHP − 2·HP) · rate · ball ⌋ / (3·MaxHP)⌋ · status       b = 1048560 / √(√(16711680 / a)),  4 checks
 *  Gen V       a = (3·MaxHP − 2·HP) · rate · ball / (3·MaxHP) · status            b = 65536 / (255 / a)^(1/4),        3 checks
 *  Gen VI on   a = (3·MaxHP − 2·HP) · rate · ball / (3·MaxHP) · status · low lvl  b = 65536 / (255 / a)^(3/16),       4 checks
 *
 * Status: sleep and freeze ×2 in Gen III–IV and ×2.5 from Gen V; paralysis, poison and burn ×1.5.
 * Low level (Sword & Shield): a wild Pokémon under level 20 is easier to catch, ×(30 − level) / 10.
 * Low level (Scarlet & Violet): under level 13, ×(36 − 2·level) / 10.
 *
 * Left out, because they need things this calculator doesn't ask for: critical captures (a rare throw that needs a
 * single shake check, more likely the more species you've caught), Gen V's dark grass, Entralink and O-Power
 * bonuses, and Sword & Shield's and Scarlet & Violet's penalty for a wild Pokémon above the level your badges allow.
 * From Gen V on the games round each step to 1/4096; this module keeps full precision and floors a once, so a
 * result can differ from the game's by a small fraction of a percent.
 */

export type Gen = 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** The games, newest first. `apricorns`: the Apricorn balls (Level, Love, Fast, Heavy…) exist. */
export const GAMES = [
  { id: "sv", gen: 9, apricorns: true },
  { id: "swsh", gen: 8, apricorns: true },
  { id: "sm", gen: 7, apricorns: true },
  { id: "xy", gen: 6, apricorns: false },
  { id: "bw", gen: 5, apricorns: false },
  { id: "hgss", gen: 4, apricorns: true },
  { id: "dppt", gen: 4, apricorns: false },
  { id: "rse", gen: 3, apricorns: false },
] as const satisfies readonly { id: string; gen: Gen; apricorns: boolean }[];
export type GameId = (typeof GAMES)[number]["id"];
export type Game = (typeof GAMES)[number];
export const gameOf = (id: GameId): Game => GAMES.find((g) => g.id === id) ?? GAMES[0];

export const STATUSES = ["none", "sleep", "freeze", "paralysis", "poison", "burn"] as const;
export type Status = (typeof STATUSES)[number];

/** The balls the calculator ranks. Premier, Luxury, Heal and Friend Balls catch exactly like a Poké Ball (×1). */
export const BALLS = ["poke", "great", "ultra", "quick", "dusk", "timer", "net", "nest", "repeat", "dive", "level", "love", "fast", "heavy", "dream", "beast", "master"] as const;
export type BallId = (typeof BALLS)[number];

/** What the calculator knows about the wild Pokémon. */
export interface Target {
  /** The species' catch rate (1–255). */
  rate: number;
  baseHp: number;
  baseSpeed: number;
  /** In hectograms (0.1 kg), as the games store it. */
  weight: number;
  types: readonly string[];
  ultraBeast: boolean;
  level: number;
  /** Current and maximum HP. */
  hp: number;
  maxHp: number;
  status: Status;
}

/** The encounter: only the balls that need a fact read it. */
export interface Situation {
  /** The turn of the battle this ball is thrown on (1 = the first). */
  turn: number;
  /** Night, or inside a cave (Dusk Ball). */
  dark: boolean;
  /** Surfing, fishing or underwater (Dive Ball). */
  water: boolean;
  /** This species is already registered as caught in your Pokédex (Repeat Ball). */
  caught: boolean;
  /** The level of your Pokémon in battle (Level Ball). */
  yourLevel: number;
  /** Your Pokémon is the same species, of the opposite gender (Love Ball). */
  loveMatch: boolean;
}

export const DEFAULT_SITUATION: Situation = { turn: 1, dark: false, water: false, caught: false, yourLevel: 50, loveMatch: false };

/** Which fact of the situation a ball depends on (the page asks only for these). */
export type Need = "turn" | "dark" | "water" | "caught" | "yourLevel" | "loveMatch";

export interface BallEffect {
  ball: BallId;
  /** The ball multiplier (1 when it does nothing here). */
  mul: number;
  /** Heavy Ball: added to the species' catch rate instead of a multiplier. */
  add: number;
  /** Master Ball: always catches. */
  sure?: boolean;
  /** Whether its special condition holds (a bonus, or a penalty for a Beast Ball on anything but an Ultra Beast). */
  active: boolean;
  /** The situation facts it reads. */
  needs: Need[];
}

/** The max HP the games give a Pokémon: ⌊(2·base + IV) · level / 100⌋ + level + 10 (no EVs), 1 for Shedinja. */
export function maxHpOf(baseHp: number, level: number, iv = 15): number {
  if (baseHp === 1) return 1;
  return Math.floor(((2 * baseHp + iv) * level) / 100) + level + 10;
}

/** Which balls exist in a game (from the generation each was introduced in; Apricorn balls only where they're sold). */
export function ballsIn(game: Game): BallId[] {
  return BALLS.filter((b) => {
    switch (b) {
      case "quick":
      case "dusk":
        return game.gen >= 4;
      case "level":
      case "love":
      case "fast":
      case "heavy":
        return game.apricorns;
      case "beast":
        return game.gen >= 7;
      // The Dream Ball only works on a sleeping Pokémon from Sword & Shield on (before, it only caught in the Dream World / Hidden Grottoes).
      case "dream":
        return game.gen >= 8;
      default:
        return true;
    }
  });
}

/** Ultra Beasts resist every ball but the Beast Ball (and the Master Ball): ×410/4096 from Gen VII. */
const UB_PENALTY = 410 / 4096;

/** A ball's modifier in this game against this Pokémon, in this situation (Bulbapedia, "Poké Ball", per ball). */
export function ballEffect(ball: BallId, game: Game, t: Target, s: Situation): BallEffect {
  const g = game.gen;
  const e = (mul: number, active: boolean, needs: Need[] = [], add = 0): BallEffect => ({ ball, mul, add, active, needs });
  const ub = g >= 7 && t.ultraBeast;
  const base = (() => {
    switch (ball) {
      case "master":
        return { ...e(1, true), sure: true };
      case "poke":
        return e(1, false);
      case "great":
        return e(1.5, false);
      case "ultra":
        return e(2, false);
      // ×4 on the first turn in Gen IV, ×5 from Gen V.
      case "quick":
        return s.turn <= 1 ? e(g >= 5 ? 5 : 4, true, ["turn"]) : e(1, false, ["turn"]);
      // At night or in a cave: ×3.5 in Gen IV–VI, ×3 from Gen VII.
      case "dusk":
        return s.dark ? e(g >= 7 ? 3 : 3.5, true, ["dark"]) : e(1, false, ["dark"]);
      // Gen III–IV: (turns passed + 10) / 10; Gen V on: 1 + turns passed × 1229/4096; at most ×4 either way.
      case "timer": {
        const passed = Math.max(0, s.turn - 1);
        const m = Math.min(4, g <= 4 ? (passed + 10) / 10 : 1 + (passed * 1229) / 4096);
        return e(m, m > 1, ["turn"]);
      }
      // Water or Bug types: ×3 through Gen VI, ×3.5 from Gen VII.
      case "net":
        return t.types.includes("water") || t.types.includes("bug") ? e(g >= 7 ? 3.5 : 3, true) : e(1, false);
      // Lower levels: (40 − level) / 10 in Gen III–IV, (41 − level) / 10 from Gen V, never below ×1.
      case "nest": {
        const m = Math.max(1, ((g <= 4 ? 40 : 41) - t.level) / 10);
        return e(m, m > 1);
      }
      // A species already caught: ×3 through Gen VI, ×3.5 from Gen VII.
      case "repeat":
        return s.caught ? e(g >= 7 ? 3.5 : 3, true, ["caught"]) : e(1, false, ["caught"]);
      // Surfing, fishing or underwater: ×3.5 (Gen III: underwater only, which the same switch stands for).
      case "dive":
        return s.water ? e(3.5, true, ["water"]) : e(1, false, ["water"]);
      // Your Pokémon's level against the wild one's: higher ×2, at least double ×4, at least four times ×8.
      case "level": {
        const y = s.yourLevel, w = t.level;
        const m = y >= 4 * w ? 8 : y >= 2 * w ? 4 : y > w ? 2 : 1;
        return e(m, m > 1, ["yourLevel"]);
      }
      // Same species, opposite gender: ×8.
      case "love":
        return s.loveMatch ? e(8, true, ["loveMatch"]) : e(1, false, ["loveMatch"]);
      // Base Speed 100 or more: ×4.
      case "fast":
        return t.baseSpeed >= 100 ? e(4, true) : e(1, false);
      // Adds to the catch rate by weight. HeartGold & SoulSilver: under 204.8 kg −20, from 204.8 kg +20, from
      // 307.2 kg +30, from 409.6 kg +40. Gen VII on: under 100 kg −20, from 200 kg +20, from 300 kg +30.
      case "heavy": {
        const kg = t.weight / 10;
        const add = g <= 4 ? (kg >= 409.6 ? 40 : kg >= 307.2 ? 30 : kg >= 204.8 ? 20 : -20) : kg >= 300 ? 30 : kg >= 200 ? 20 : kg >= 100 ? 0 : -20;
        return e(1, add > 0, [], add);
      }
      // ×4 on a sleeping Pokémon (Sword & Shield on).
      case "dream":
        return t.status === "sleep" ? e(4, true) : e(1, false);
      // ×5 on an Ultra Beast, ×410/4096 on anything else.
      case "beast":
        return t.ultraBeast ? e(5, true) : e(UB_PENALTY, true);
    }
  })();
  // Against an Ultra Beast, every ball but the Beast Ball and the Master Ball works at ×410/4096 (Gen VII on).
  if (ub && ball !== "beast" && ball !== "master") return { ...base, mul: base.mul * UB_PENALTY, active: true };
  return base;
}

export function statusBonus(status: Status, gen: Gen): number {
  if (status === "sleep" || status === "freeze") return gen >= 5 ? 2.5 : 2;
  if (status === "paralysis" || status === "poison" || status === "burn") return 1.5;
  return 1;
}

/** The low-level bonus: Sword & Shield under level 20, Scarlet & Violet under level 13; ×1 otherwise. */
export function lowLevelBonus(level: number, gen: Gen): number {
  if (gen === 8 && level < 20) return (30 - level) / 10;
  if (gen === 9 && level < 13) return (36 - 2 * level) / 10;
  return 1;
}

/** The catch rate after a Heavy Ball's adjustment (never below 1). */
export function effectiveRate(rate: number, add: number): number {
  return add ? Math.max(1, rate + add) : rate;
}

/** The modified catch rate a (a ≥ 255 is a sure catch). */
export function modifiedRate(t: Target, gen: Gen, fx: Pick<BallEffect, "mul" | "add">): number {
  const rate = effectiveRate(t.rate, fx.add);
  const hp = Math.max(1, Math.min(t.hp, t.maxHp));
  const top = 3 * t.maxHp - 2 * hp;
  if (gen <= 4) {
    // Integer arithmetic, flooring each step as the Gen III–IV games do.
    const x = Math.floor(Math.floor(top * rate * fx.mul) / (3 * t.maxHp));
    return Math.floor(x * statusBonus(t.status, gen));
  }
  return Math.floor(((top * rate * fx.mul) / (3 * t.maxHp)) * statusBonus(t.status, gen) * lowLevelBonus(t.level, gen));
}

/** The number of shake checks a capture needs: 4 in Gen III–IV and from Gen VI, 3 in Gen V. */
export const checksIn = (gen: Gen): number => (gen === 5 ? 3 : 4);

/** The shake value b for a modified catch rate (65536 or more: every check passes). */
export function shakeValue(a: number, gen: Gen): number {
  if (a >= 255) return 65536;
  if (gen <= 4) {
    // b = 1048560 / √(√(16711680 / a)), the square roots taken as whole numbers (a of 0 counts as 1).
    const x = Math.max(1, a);
    return Math.floor(1048560 / Math.floor(Math.sqrt(Math.floor(Math.sqrt(Math.floor(16711680 / x))))));
  }
  if (a <= 0) return 0;
  return Math.floor(65536 / Math.pow(255 / a, gen === 5 ? 1 / 4 : 3 / 16));
}

/** The chance one shake check passes (a random number from 0 to 65535 below b). */
export const checkChance = (b: number): number => Math.min(1, b / 65536);

export interface Throw {
  ball: BallId;
  /** Chance to catch with this one throw. */
  chance: number;
  /** Chance each shake check passes. */
  check: number;
  checks: number;
  a: number;
  b: number;
  fx: BallEffect;
}

/** One throw of a ball. */
export function throwOnce(ball: BallId, game: Game, t: Target, s: Situation): Throw {
  const fx = ballEffect(ball, game, t, s);
  const checks = checksIn(game.gen);
  if (fx.sure) return { ball, chance: 1, check: 1, checks, a: 255, b: 65536, fx };
  const a = modifiedRate(t, game.gen, fx);
  const b = shakeValue(a, game.gen);
  const check = checkChance(b);
  return { ball, chance: a >= 255 ? 1 : Math.pow(check, checks), check, checks, a, b, fx };
}

/**
 * Throwing the same ball every turn from `s.turn` on (HP and status unchanged): the chance per throw can change only
 * for the Quick Ball (first turn) and the Timer Ball (grows to ×4 by turn 11), after which it stays put, so a short
 * loop plus a geometric tail gives exact answers.
 */
export interface Series {
  first: Throw;
  /** Expected throws until the catch (Infinity when it can't happen). */
  expected: number;
  /** Chance of a catch within n throws. */
  within: (n: number) => number;
  /** Throws needed to reach a chance of at least p (Infinity when it never does). */
  throwsFor: (p: number) => number;
}

const STEADY_AFTER = 12;

export function series(ball: BallId, game: Game, t: Target, s: Situation): Series {
  const ps: number[] = [];
  let first: Throw | null = null;
  for (let i = 0; i < STEADY_AFTER; i++) {
    const th = throwOnce(ball, game, t, { ...s, turn: s.turn + i });
    first ??= th;
    ps.push(th.chance);
  }
  const tail = ps[ps.length - 1];
  /** Chance of still not having it after n throws. */
  const miss = (n: number): number => {
    let m = 1;
    for (let i = 0; i < Math.min(n, ps.length); i++) m *= 1 - ps[i];
    if (n > ps.length) m *= Math.pow(1 - tail, n - ps.length);
    return m;
  };
  let expected = 0;
  let m = 1;
  for (const p of ps) {
    expected += m;
    m *= 1 - p;
  }
  expected = m <= 0 ? expected : tail > 0 ? expected + m / tail : Infinity;
  const throwsFor = (p: number): number => {
    const goal = 1 - p;
    let left = 1;
    for (let i = 0; i < ps.length; i++) {
      left *= 1 - ps[i];
      if (left <= goal + 1e-12) return i + 1;
    }
    if (tail <= 0) return Infinity;
    if (tail >= 1) return ps.length + 1;
    return ps.length + Math.max(1, Math.ceil(Math.log(goal / left) / Math.log(1 - tail) - 1e-9));
  };
  return { first: first!, expected, within: (n) => 1 - miss(n), throwsFor };
}

/**
 * One simulated throw, for the shaking preview: how many times the ball wobbles (0–3) and whether it holds. `rnd`
 * returns numbers in [0, 1). A sure catch still wobbles three times.
 */
export function simulate(th: Pick<Throw, "check" | "checks" | "chance">, rnd: () => number = Math.random): { shakes: number; caught: boolean } {
  if (th.chance >= 1) return { shakes: 3, caught: true };
  let passed = 0;
  while (passed < th.checks && rnd() < th.check) passed++;
  return { shakes: Math.min(3, passed), caught: passed === th.checks };
}
