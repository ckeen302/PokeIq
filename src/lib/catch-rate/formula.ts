/**
 * The capture formulas of the main-series games from Generation III on, for a wild battle. Pure functions, no data of
 * their own beyond the games' constants. Every step and every ball was checked against these sources (the unit
 * tests in tests/catch-rate.test.ts cite them case by case):
 *
 *  Gen III  the decompiled games: Cmd_handleballthrow in pret/pokeemerald and pret/pokefirered, and
 *           atkEF_handleballthrow in pret/pokeruby (src/battle_script_commands.c)
 *  Gen IV   the decompiled games: BattleScript_CalcCatchShakes in pret/pokeplatinum (src/battle/battle_script.c) and
 *           BattleSystem_CalculateBallShakes in pret/pokeheartgold (src/battle/battle_command.c)
 *  Gen V+   Dragonfly Cave's capture mechanics articles and its open calculators' code
 *           (https://www.dragonflycave.com/mechanics/gen-v-capturing/, …/gen-vi-vii-capturing/,
 *           …/gen-viii-capturing/, …/gen-ix-capturing/, and /gen5capture-worker.js … /gen9capture-worker.js),
 *           cross-checked with Bulbapedia ("Catch rate", "Poké Ball" and each ball's article, read through its
 *           MediaWiki API) and Serebii (https://www.serebii.net/games/capture.shtml)
 *
 * In every generation covered here a throw works the same way:
 *  1. a "modified catch rate" a is worked out from the HP left, the species' catch rate, the ball, the status and,
 *     from Gen V on, a few more factors;
 *  2. if a ≥ 255 the Pokémon is caught outright;
 *  3. otherwise a shake value b comes from a, and the game makes "shake checks": each passes when a random number from
 *     0 to 65535 is below b. The Pokémon is caught only when every check passes: four in Gen III–IV and from Gen VI,
 *     three in Gen V.
 *  4. From Gen V, before the checks, a critical capture may happen (more likely the more species you've caught): then
 *     a single check decides it.
 *
 * Gen III–IV work in whole numbers, flooring every step:
 *   a = ⌊⌊⌊rate × ball⌋ × (3·MaxHP − 2·HP) / (3·MaxHP)⌋ × status⌋ (at least 1)
 *   b = ⌊1048560 / ⌊√⌊√⌊16711680 / a⌋⌋⌋⌋
 * From Gen V the games count in 4096ths, rounding or flooring each step to 1/4096 (the order is in modifiedRate);
 *   b = 65536 / (255 / a)^(1/4) in Gen V,  65536 / (255 / a)^(3/16) from Gen VI.
 */

export type Gen = 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * The games, newest first. `apricorns`: the Apricorn balls (Level, Love, Fast, Heavy, Moon, Lure) can be had and
 * thrown. Games that share every formula, ball and catch rate share an entry; X & Y and Omega Ruby & Alpha Sapphire,
 * like Sun & Moon and Ultra Sun & Ultra Moon, are apart because some catch rates (and, in Sun & Moon, the Heavy Ball)
 * differ.
 */
export const GAMES = [
  { id: "sv", gen: 9, apricorns: true },
  { id: "swsh", gen: 8, apricorns: true },
  { id: "usum", gen: 7, apricorns: true },
  { id: "sm", gen: 7, apricorns: true },
  { id: "oras", gen: 6, apricorns: false },
  { id: "xy", gen: 6, apricorns: false },
  { id: "bw", gen: 5, apricorns: false },
  { id: "hgss", gen: 4, apricorns: true },
  { id: "dppt", gen: 4, apricorns: false },
  { id: "rse", gen: 3, apricorns: false },
] as const satisfies readonly { id: string; gen: Gen; apricorns: boolean }[];
export type GameId = (typeof GAMES)[number]["id"];
export type Game = (typeof GAMES)[number];
export const gameOf = (id: GameId): Game => GAMES.find((g) => g.id === id) ?? GAMES[0];

/** Release order, for the catch rates that changed from one game to the next. */
const ORDER: GameId[] = ["rse", "dppt", "hgss", "bw", "xy", "oras", "sm", "usum", "swsh", "sv"];
const before = (game: GameId, than: GameId) => ORDER.indexOf(game) < ORDER.indexOf(than);

/**
 * A species' catch rate in a game. The table holds today's (Scarlet & Violet) rates; these changed along the way, per
 * Bulbapedia's "List of Pokémon by catch rate" (its "Changes to catch rate" section), confirmed for Omega Ruby & Alpha
 * Sapphire and Ultra Sun & Ultra Moon by Dragonfly Cave's Gen VI/VII article and for Scarlet & Violet by Serebii's
 * Pokédex.
 */
export function rateIn(id: number, rate: number, game: GameId): number {
  switch (id) {
    case 382: // Kyogre
    case 383: // Groudon
      return before(game, "oras") ? 5 : 3;
    case 384: // Rayquaza: 45 as a story catch in Omega Ruby & Alpha Sapphire, back to 3 in Scarlet & Violet
      return before(game, "oras") || game === "sv" ? 3 : 45;
    case 483: // Dialga
    case 484: // Palkia
      return before(game, "oras") ? 30 : 3;
    case 643: // Reshiram
    case 644: // Zekrom
      return before(game, "oras") ? 45 : 3;
    case 789: // Cosmog, Cosmoem, Solgaleo, Lunala
    case 790:
    case 791:
    case 792:
      return game === "sv" ? 3 : 45;
    case 550: // Basculin: 190 from Scarlet & Violet's 2.0.1 update
      return game === "sv" ? 190 : 25;
    case 800: // Necrozma: 255 in Ultra Sun & Ultra Moon and Sword & Shield
      return game === "usum" || game === "swsh" ? 255 : 3;
  }
  if (game === "sm") {
    // The Ultra Beasts before Ultra Sun & Ultra Moon gave them all 45.
    const sm: Record<number, number> = { 794: 25, 795: 255, 796: 30, 797: 25, 798: 255, 799: 15 };
    if (id in sm) return sm[id];
  }
  // Poipole, Naganadel, Stakataka and Blacephalon: 3 in Ultra Sun & Ultra Moon, 45, 45, 30 and 30 from Sword & Shield.
  if (id >= 803 && id <= 806 && before(game, "swsh")) return 3;
  return rate;
}

export const STATUSES = ["none", "sleep", "freeze", "paralysis", "poison", "burn"] as const;
export type Status = (typeof STATUSES)[number];

/** The balls the calculator ranks. Premier, Luxury, Heal and Friend Balls catch exactly like a Poké Ball (×1). */
export const BALLS = ["poke", "great", "ultra", "quick", "dusk", "timer", "net", "nest", "repeat", "dive", "level", "love", "fast", "heavy", "moon", "lure", "dream", "beast", "master"] as const;
export type BallId = (typeof BALLS)[number];

/** What the calculator knows about the wild Pokémon. */
export interface Target {
  /** National Pokédex number (the Moon and Dream Balls, Ultra Beasts, catch rates that changed). */
  id: number;
  /** The species' catch rate in this game (1–255). */
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

/** The encounter and the player: only the parts that need a fact read it. */
export interface Situation {
  /** The turn of the battle this ball is thrown on (1 = the first). */
  turn: number;
  /** Night, or inside a cave (Dusk Ball). */
  dark: boolean;
  /** Surfing, fishing or underwater (Dive Ball); in Scarlet & Violet, the Pokémon is in or on water (Lure Ball too). */
  water: boolean;
  /** Fishing (Lure Ball, in the games before Scarlet & Violet). */
  fishing: boolean;
  /** This species is already registered as caught in your Pokédex (Repeat Ball). */
  caught: boolean;
  /** The level of your Pokémon in battle (Level Ball; Sword & Shield's penalty). */
  yourLevel: number;
  /** Your Pokémon is the same species, of the opposite gender (Love Ball). */
  loveMatch: boolean;
  /** How many species are registered as caught in your Pokédex (critical captures; Gen V's dark grass). */
  dex: number;
  /** The Catching Charm (Sword & Shield, Scarlet & Violet): doubles the critical capture chance. */
  charm: boolean;
  /** The battle is in dark grass (Black & White, Black 2 & White 2). */
  darkGrass: boolean;
  /** A capture power, 0 (none) to 3: Entralink's Capture Power (Gen V), the Capture O-Power (Gen VI), Scarlet & Violet's sandwich Catching Power. */
  power: number;
  /** Scarlet & Violet: you caught the wild Pokémon off guard (a back strike). */
  offGuard: boolean;
  /** Gym Badges (Sword & Shield, Scarlet & Violet), 0 to 8. */
  badges: number;
}

export const DEFAULT_SITUATION: Situation = { turn: 1, dark: false, water: false, fishing: false, caught: false, yourLevel: 50, loveMatch: false, dex: 0, charm: false, darkGrass: false, power: 0, offGuard: false, badges: 8 };

/** Which fact of the situation a ball depends on (the page asks only for these). */
export type Need = "turn" | "dark" | "water" | "fishing" | "caught" | "yourLevel" | "loveMatch";

export interface BallEffect {
  ball: BallId;
  /** The ball multiplier (1 when it does nothing here). In HeartGold & SoulSilver an Apricorn ball multiplies the catch rate itself. */
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
      case "moon":
      case "lure":
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

/** The ×410/4096 every ball but the Beast and Master Balls has on an Ultra Beast from Gen VII (and the Beast Ball on anything else). */
export const UB_PENALTY = 410 / 4096;
/** Komala's Comatose counts as sleep for the Dream Ball (Dragonfly Cave, Gen VIII and IX). */
const KOMALA = 775;
/** The Moon Ball: HeartGold & SoulSilver's list (pokeheartgold, sMoonBallPokemon), and from Gen VII the Pokémon that evolve by Moon Stone. */
const MOON_HGSS = new Set([29, 30, 31, 32, 33, 34, 173, 35, 36, 174, 39, 40, 300, 301]);
const MOON = new Set([30, 33, 35, 39, 300, 517]);

/** The Nest Ball from Gen V, in 4096ths: ⌊(41 − level) × 4096 / 10⌋ (Bulbapedia; Serebii for Scarlet & Violet). */
const nest4096 = (level: number) => Math.floor(((41 - level) * 4096) / 10) / 4096;

/** A ball's modifier in this game against this Pokémon, in this situation. */
export function ballEffect(ball: BallId, game: Game, t: Target, s: Situation): BallEffect {
  const g = game.gen;
  const e = (mul: number, active: boolean, needs: Need[] = [], add = 0): BallEffect => ({ ball, mul, add, active, needs });
  const base = ((): BallEffect => {
    switch (ball) {
      case "master":
        return { ...e(1, true), sure: true };
      case "poke":
        return e(1, false);
      case "great":
        return e(1.5, false);
      case "ultra":
        return e(2, false);
      // The first turn: ×4 in Gen IV, ×5 from Gen V.
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
      // Gen III–IV: (40 − level) / 10, at least ×1. Gen V: (41 − level) / 10, at least ×1. From Gen VI: the same,
      // but only under level 30 (×1 from level 30, where Gen V gave ×1.1).
      case "nest": {
        const m = g <= 4 ? Math.max(1, (40 - t.level) / 10) : g === 5 || t.level < 30 ? Math.max(1, nest4096(t.level)) : 1;
        return e(m, m > 1);
      }
      // A species already caught: ×3 through Gen VI, ×3.5 from Gen VII.
      case "repeat":
        return s.caught ? e(g >= 7 ? 3.5 : 3, true, ["caught"]) : e(1, false, ["caught"]);
      // ×3.5. Gen III: underwater only; Gen IV–VIII: surfing, fishing or underwater; Gen IX: in or on water.
      case "dive": {
        const on = s.water || (g >= 4 && g <= 8 && s.fishing);
        return on ? e(3.5, true, ["water"]) : e(1, false, ["water"]);
      }
      // Your Pokémon's level against the wild one's. HeartGold & SoulSilver: higher ×2, more than double ×4, more than
      // four times ×8 (the decompiled code compares your level ÷ 2 and ÷ 4, rounded down, with "greater than");
      // from Gen VII: higher ×2, at least double ×4, at least four times ×8.
      case "level": {
        const y = s.yourLevel, w = t.level;
        const m = g <= 4 ? (Math.floor(y / 4) > w ? 8 : Math.floor(y / 2) > w ? 4 : y > w ? 2 : 1) : Math.floor(y / 4) >= w ? 8 : Math.floor(y / 2) >= w ? 4 : y > w ? 2 : 1;
        return e(m, m > 1, ["yourLevel"]);
      }
      // Same species, opposite gender: ×8.
      case "love":
        return s.loveMatch ? e(8, true, ["loveMatch"]) : e(1, false, ["loveMatch"]);
      // Base Speed 100 or more: ×4.
      case "fast":
        return t.baseSpeed >= 100 ? e(4, true) : e(1, false);
      // ×4 on its list (above).
      case "moon":
        return (g <= 4 ? MOON_HGSS : MOON).has(t.id) ? e(4, true) : e(1, false);
      // Fishing: ×3 in HeartGold & SoulSilver, ×5 in Gen VII, ×4 in Sword & Shield; Scarlet & Violet: ×4 on a Pokémon in
      // or on water.
      case "lure": {
        const on = g === 9 ? s.water : s.fishing;
        const m = g <= 4 ? 3 : g === 7 ? 5 : 4;
        return on ? e(m, true, [g === 9 ? "water" : "fishing"]) : e(1, false, [g === 9 ? "water" : "fishing"]);
      }
      // Adds to the catch rate by weight. HeartGold & SoulSilver: under 204.8 kg −20, from 204.8 kg +20, from
      // 307.2 kg +30, from 409.6 kg +40. Gen VII on: under 100 kg −20, from 200 kg +20, from 300 kg +30.
      case "heavy": {
        const w = t.weight;
        const add = g <= 4 ? (w >= 4096 ? 40 : w >= 3072 ? 30 : w >= 2048 ? 20 : -20) : w >= 3000 ? 30 : w >= 2000 ? 20 : w >= 1000 ? 0 : -20;
        return e(1, add > 0, [], add);
      }
      // ×4 on a sleeping Pokémon (or Komala) from Sword & Shield on.
      case "dream":
        return t.status === "sleep" || t.id === KOMALA ? e(4, true) : e(1, false);
      // ×5 on an Ultra Beast, ×410/4096 on anything else.
      case "beast":
        return t.ultraBeast ? e(5, true) : e(UB_PENALTY, true);
    }
  })();
  // Against an Ultra Beast, every ball but the Beast Ball and the Master Ball is set to ×410/4096 (Gen VII on), the
  // Heavy Ball's change to the catch rate still applying.
  if (g >= 7 && t.ultraBeast && ball !== "beast" && ball !== "master") return { ...base, mul: UB_PENALTY, active: true };
  return base;
}

/** HeartGold & SoulSilver's Apricorn balls multiply the catch rate itself (capped at 255), not the formula. */
const onRate = (ball: BallId, gen: Gen) => gen <= 4 && (ball === "level" || ball === "love" || ball === "fast" || ball === "moon" || ball === "lure");

export function statusBonus(status: Status, gen: Gen): number {
  if (status === "sleep" || status === "freeze") return gen >= 5 ? 2.5 : 2;
  if (status === "paralysis" || status === "poison" || status === "burn") return 1.5;
  return 1;
}

/** The low-level bonus: Sword & Shield under level 20, Scarlet & Violet under level 13; ×1 otherwise. */
export function lowLevelBonus(level: number, gen: Gen): number {
  if (gen === 8 && level < 21) return (30 - level) / 10;
  if (gen === 9 && level < 13) return (36 - 2 * level) / 10;
  return 1;
}

/** The highest level a ball can be thrown at in Sword & Shield, per badges (above it the Pokémon "looks very strong"). */
export const SWSH_CAP = [20, 25, 30, 35, 40, 45, 50, 55, 100] as const;
/** The highest level that obeys you in Scarlet & Violet, per badges (for its badge penalty). */
export const SV_OBEY = [25, 30, 35, 40, 45, 50, 55, 60, 100] as const;

/** Whether you can't throw a ball at all: Sword & Shield, a Pokémon above the level your badges allow. */
export function blockedIn(game: Game, t: Pick<Target, "level">, s: Pick<Situation, "badges">): boolean {
  return game.gen === 8 && t.level > SWSH_CAP[clampBadges(s.badges)];
}
const clampBadges = (b: number) => Math.max(0, Math.min(8, Math.round(b)));

/**
 * Sword & Shield's difficulty: ×410/4096 when you lack the eighth badge and your Pokémon is a lower level than the
 * wild one. Scarlet & Violet's badge penalty: ×0.8 for each badge you're short of the ones that make it obey.
 * Both 1 otherwise.
 */
export function badgePenalty(game: Game, t: Pick<Target, "level">, s: Pick<Situation, "badges" | "yourLevel">): number {
  const b = clampBadges(s.badges);
  if (game.gen === 8) return b < 8 && s.yourLevel < t.level ? 410 / 4096 : 1;
  if (game.gen === 9 && b < 8) {
    // The game multiplies in single precision, then rounds to 1/4096 (Dragonfly Cave's gen9capture-worker.js).
    let bp = 1;
    for (let i = 0; SV_OBEY[b + i] < t.level; i++) bp = Math.fround(bp * 0.8);
    return Math.round(bp * 4096) / 4096;
  }
  return 1;
}

/** The capture power's multiplier: Entralink (Gen V) 1.1/1.2/1.3, O-Power (Gen VI) 1.5/2/2.5, sandwiches (Scarlet & Violet) 1.1/1.25/2. */
export function powerBonus(power: number, gen: Gen): number {
  const p = Math.max(0, Math.min(3, Math.round(power)));
  if (gen === 5) return [1, 1.1, 1.2, 1.3][p];
  if (gen === 6) return [1, 1.5, 2, 2.5][p];
  if (gen === 9) return [1, 1.1, 1.25, 2][p];
  return 1;
}
/** Which games have a capture power the page asks about. */
export const hasPower = (gen: Gen) => gen === 5 || gen === 6 || gen === 9;

/** The Pokédex tier the critical capture chance and Gen V's dark grass go by: more than 30, 150, 300, 450, 600 caught. */
const dexTier = (dex: number) => [30, 150, 300, 450, 600].filter((n) => dex > n).length;
/** Dark grass (Gen V), in 4096ths, by Pokédex tier. */
const DARK_GRASS = [1229, 2048, 2867, 3277, 3686, 4096];
/** The critical capture multiplier, by Pokédex tier. */
const CRIT_DEX = [0, 0.5, 1, 1.5, 2, 2.5];

/** The catch rate after a Heavy Ball's adjustment, or an Apricorn ball's in HeartGold & SoulSilver. */
export function effectiveRate(rate: number, fx: Pick<BallEffect, "ball" | "mul" | "add">, game: Game): number {
  const g = game.gen;
  if (g <= 4) {
    if (!(onRate(fx.ball, g) || fx.add)) return rate;
    // HeartGold & SoulSilver: the rate is multiplied or added to, then kept from 1 to 255 (pokeheartgold).
    const c = onRate(fx.ball, g) ? rate * fx.mul : rate + fx.add;
    return c > 255 ? 255 : c < 0 ? 1 : c;
  }
  if (!fx.add) return rate;
  // Gen VII on: at most 255; Sun & Moon floor a negative rate at 0 (a Heavy Ball can't catch), the later games at 1.
  return Math.min(255, Math.max(game.id === "sm" ? 0 : 1, rate + fx.add));
}

/**
 * The modified catch rate a (a ≥ 255 is a sure catch). Gen III–IV: a whole number. From Gen V: a multiple of 1/4096,
 * worked out in 4096ths the way Dragonfly Cave's calculators set the games' order of rounding out:
 *   Gen V–VII  ⌊round(⌊round(round((3M − 2H) × G) × C × B) / 3M⌋ × S) × E⌋
 *   Gen VIII   round(round(⌊⌊round(round((3M − 2H) × G) × C × B) / 3M⌋ × L / 10⌋ × S) × D)
 *   Gen IX     round(round(⌊⌊round(round(round((3M − 2H) × G) × C × B) × BP) / 3M⌋ × L / 10⌋ × S) × D)
 * where round is to the nearest 4096th (halves up) and ⌊⌋ down to one; G is dark grass, E and D a capture power
 * (D in Gen VIII is the badge difficulty), L the low-level bonus × 10, BP the badge penalty.
 */
export function modifiedRate(t: Target, game: Game, s: Situation, fx: Pick<BallEffect, "ball" | "mul" | "add">): number {
  const gen = game.gen;
  const c = effectiveRate(t.rate, fx, game);
  const hp = Math.max(1, Math.min(t.hp, t.maxHp));
  const m3 = 3 * t.maxHp;
  const top = m3 - 2 * hp;
  if (gen <= 4) {
    // ballMultiplier is in tenths: the Great Ball is 15, the Ultra Ball 20, a Nest Ball 40 − level…
    const ball10 = onRate(fx.ball, gen) ? 10 : Math.round(fx.mul * 10);
    let a = Math.floor((Math.floor((c * ball10) / 10) * top) / m3);
    if (t.status === "sleep" || t.status === "freeze") a *= 2;
    else if (t.status !== "none") a = Math.floor((a * 15) / 10);
    // "In Generation III and Generation IV, the modified catch rate may never fall below 1" (Bulbapedia); Dragonfly
    // Cave's Gen III/IV calculator does the same.
    return Math.max(1, a);
  }
  // In 4096ths, as BigInt: the products can pass 2^53.
  const B = BigInt;
  const q = 4096n;
  const rnd = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n); // n / d rounded half up (n, d ≥ 0)
  const flo = (n: bigint, d: bigint) => n / d;
  const G = gen === 5 && s.darkGrass ? B(DARK_GRASS[dexTier(s.dex)]) : q;
  const ballQ = B(Math.round(fx.mul * 4096 * 4096)); // the ball in 4096ths of 4096ths keeps 1229/4096 and ⌊(41 − L)…⌋ exact
  const hpG = B(top) * G; // round((3M − 2H) × G) in 4096ths: already whole
  let x = rnd(hpG * B(c) * ballQ, q * q); // round(… × C × B)
  const status = B(Math.round(statusBonus(t.status, gen) * 4096));
  if (gen <= 7) {
    x = flo(x, B(m3));
    x = rnd(x * status, q);
    // E: ⌊… × E / 100⌋ with E = 100, 110, 120, 130 (Gen V) or 100, 150, 200, 250 (Gen VI).
    x = flo(x * B(Math.round(powerBonus(s.power, gen) * 100)), 100n);
  } else {
    if (gen === 9) x = rnd(x * B(Math.round(badgePenalty(game, t, s) * 4096)), q);
    x = flo(x, B(m3));
    x = flo(x * B(Math.round(lowLevelBonus(t.level, gen) * 10)), 10n);
    x = rnd(x * status, q);
    // D: Sword & Shield's difficulty (410/4096 or 1); Scarlet & Violet's capture power × 2 when caught off guard.
    if (gen === 8) x = rnd(x * B(Math.round(badgePenalty(game, t, s) * 4096)), q);
    else x = B(Math.round(Number(x) * powerBonus(s.power, gen) * (s.offGuard ? 2 : 1)));
  }
  return Math.min(255, Number(x) / 4096);
}

/** The number of shake checks a normal capture needs: 4 in Gen III–IV and from Gen VI, 3 in Gen V. */
export const checksIn = (gen: Gen): number => (gen === 5 ? 3 : 4);

/** Dragonfly Cave's 4096ths helpers, for the shake value from Gen V (to the nearest, halves up). */
const r4096 = (x: number) => Math.round(x * 4096) / 4096;

/** The shake value b for a modified catch rate (65536 or more: every check passes). */
export function shakeValue(a: number, gen: Gen): number {
  if (a >= 255) return 65536;
  if (gen <= 4) {
    // b = 1048560 / √(√(16711680 / a)), each division and root to a whole number (the games' integer Sqrt).
    const x = Math.max(1, Math.floor(a));
    return Math.floor(1048560 / Math.floor(Math.sqrt(Math.floor(Math.sqrt(Math.floor(16711680 / x))))));
  }
  if (a <= 0) return 0;
  const ratio = r4096(255 / a);
  // Gen V: two square roots; from Gen VI: the 3/16th power, in single precision from Gen VIII.
  const root = gen === 5 ? r4096(Math.sqrt(r4096(Math.sqrt(ratio)))) : r4096(gen >= 8 ? Math.fround(Math.pow(ratio, 3 / 16)) : Math.pow(ratio, 3 / 16));
  return Math.floor(r4096(65536 / root));
}

/** The chance one shake check passes (a random number from 0 to 65535 below b). */
export const checkChance = (b: number): number => Math.min(1, b / 65536);

/**
 * The chance a throw is a critical capture (Gen V on): ⌊a × P × Ch / 6⌋ out of 256, where P goes by the species
 * caught (0 up to 30, then 0.5, 1, 1.5, 2, 2.5 above 150, 300, 450, 600) and Ch is 2 with the Catching Charm.
 * Gen V–VII: ⌊round(round(a × P) / 6)⌋; Gen VIII–IX: ⌊round(a × P × Ch) / 6⌋ (Dragonfly Cave's calculators).
 */
export function critChance(a: number, gen: Gen, s: Pick<Situation, "dex" | "charm">): number {
  if (gen <= 4) return 0;
  const p = CRIT_DEX[dexTier(s.dex)];
  const cc = gen <= 7 ? Math.floor(r4096(r4096(a * p) / 6)) : Math.floor(r4096(Math.min(a, 255) * p * (s.charm && gen >= 8 ? 2 : 1)) / 6);
  return Math.min(1, cc / 256);
}

export interface Throw {
  ball: BallId;
  /** Chance to catch with this one throw. */
  chance: number;
  /** Chance each shake check passes. */
  check: number;
  /** Shake checks in a normal capture. */
  checks: number;
  /** Chance this throw is a critical capture (one check). */
  crit: number;
  a: number;
  b: number;
  fx: BallEffect;
  gen: Gen;
  /** Sword & Shield: the Pokémon is above the level your badges allow, so no ball can be thrown. */
  blocked?: boolean;
}

/** One throw of a ball. */
export function throwOnce(ball: BallId, game: Game, t: Target, s: Situation): Throw {
  const fx = ballEffect(ball, game, t, s);
  const gen = game.gen;
  const checks = checksIn(gen);
  if (blockedIn(game, t, s)) return { ball, chance: 0, check: 0, checks, crit: 0, a: 0, b: 0, fx, gen, blocked: true };
  if (fx.sure) return { ball, chance: 1, check: 1, checks, crit: 0, a: 255, b: 65536, fx, gen };
  const a = modifiedRate(t, game, s, fx);
  const b = shakeValue(a, gen);
  const check = checkChance(b);
  const crit = critChance(a, gen, s);
  const chance = a >= 255 ? 1 : crit * check + (1 - crit) * Math.pow(check, checks);
  return { ball, chance, check, checks, crit, a, b, fx, gen };
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
 * One simulated throw, for the shaking preview: whether it's a critical capture, how many times the ball wobbles
 * (0–3) and whether it holds. `rnd` returns numbers in [0, 1). A sure catch wobbles three times. A critical capture
 * wobbles once, then holds or breaks on its one check. In Gen V a Pokémon that breaks out on the third check does so
 * after three wobbles, not two (Dragonfly Cave; Bulbapedia).
 */
export function simulate(th: Pick<Throw, "check" | "checks" | "chance" | "crit" | "gen">, rnd: () => number = Math.random): { shakes: number; caught: boolean; critical: boolean } {
  if (th.chance >= 1) return { shakes: 3, caught: true, critical: false };
  if (th.crit > 0 && rnd() < th.crit) return { shakes: 1, caught: rnd() < th.check, critical: true };
  let passed = 0;
  while (passed < th.checks && rnd() < th.check) passed++;
  const caught = passed === th.checks;
  const shakes = th.gen === 5 && passed === 2 ? 3 : Math.min(3, passed);
  return { shakes, caught, critical: false };
}
