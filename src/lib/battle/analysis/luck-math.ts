/**
 * The odds behind the luck meter: the chance of a critical hit, of a move
 * hitting, and of a secondary effect, as Pokémon Showdown's simulator rolls
 * them, from what a spectator could see (a held item or an ability counts
 * only once the battle has shown it, or the assumed set says so). Plus the
 * damage-roll arithmetic for a percentage HP bar, and the score that adds it
 * all up. Pure functions: no data loading, so they're cheap to test.
 */

/** A crit stage (1 = normal) as a chance, per generation (Showdown's tables). */
export function critChance(gen: number, stage: number): number {
  const s = Math.max(1, Math.floor(stage));
  if (gen >= 7) return [0, 1 / 24, 1 / 8, 1 / 2][s] ?? 1;
  if (gen === 6) return [0, 1 / 16, 1 / 8, 1 / 2][s] ?? 1;
  return [0, 1 / 16, 1 / 8, 1 / 4, 1 / 3][s] ?? 1 / 2;
}

/** Accuracy and evasion stages, combined (clamped to ±6), as a multiplier. */
export function stageMultiplier(stage: number): number {
  const s = Math.max(-6, Math.min(6, Math.round(stage)));
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

export interface AccuracyInput {
  gen: number;
  move: { id: string; accuracy: number | true; ohko?: boolean | string; category: string; type: string };
  user: { level: number; types: readonly string[]; ability: string; item: string; accuracy: number; confused?: boolean };
  target: { level: number; types: readonly string[]; ability: string; item: string; evasion: number; confused?: boolean };
  weather: string;
  gravity?: boolean;
  /** The target has already moved this turn (Zoom Lens). */
  targetMoved?: boolean;
}

const RAIN = new Set(["raindance", "primordialsea"]);
const SUN = new Set(["sunnyday", "desolateland"]);
const SNOW = new Set(["hail", "snow", "snowscape"]);

/**
 * The chance the move hits, or null when it doesn't roll for accuracy at all
 * (accuracy "true", No Guard, Toxic from a Poison type, Thunder in the rain…).
 * Items and abilities count only when they're known (`""` when not).
 */
export function hitChance(i: AccuracyInput): number | null {
  const { move, user, target } = i;
  if (move.accuracy === true) return null;
  if (user.ability === "noguard" || target.ability === "noguard") return null;
  if (move.id === "toxic" && i.gen >= 6 && user.types.includes("Poison")) return null;
  if ((move.id === "thunder" || move.id === "hurricane") && RAIN.has(i.weather)) return null;
  if (move.id === "blizzard" && SNOW.has(i.weather)) return null;
  if (move.ohko) {
    if (target.level > user.level) return 0;
    const base = move.id === "sheercold" && i.gen >= 7 && !user.types.includes("Ice") ? 20 : 30;
    return Math.min(100, base + user.level - target.level) / 100;
  }
  let acc = move.accuracy;
  if ((move.id === "thunder" || move.id === "hurricane") && SUN.has(i.weather)) acc = 50;
  const ignoreEvasion = user.ability === "unaware" || user.ability === "keeneye" || user.ability === "mindseye";
  const ignoreAccuracy = target.ability === "unaware";
  const stage = (ignoreAccuracy ? 0 : user.accuracy) - (ignoreEvasion ? 0 : target.evasion);
  let p = acc * stageMultiplier(stage);
  if (user.ability === "compoundeyes") p *= 1.3;
  if (user.ability === "hustle" && move.category === "Physical") p *= 0.8;
  if (user.ability === "victorystar") p *= 1.1;
  if (user.item === "widelens") p *= 1.1;
  if (user.item === "zoomlens" && i.targetMoved) p *= 1.2;
  if (target.item === "brightpowder" || target.item === "laxincense") p *= 0.9;
  if (target.ability === "sandveil" && i.weather === "sandstorm") p *= 0.8;
  if (target.ability === "snowcloak" && SNOW.has(i.weather)) p *= 0.8;
  if (target.ability === "tangledfeet" && target.confused) p *= 0.5;
  if (i.gravity) p *= 5 / 3;
  return Math.max(0, Math.min(100, p)) / 100;
}

/** A move's crit stage from what's known: its own ratio, Focus Energy, items and abilities. */
export function critStage(opts: { critRatio?: number; focusEnergy?: boolean; item: string; ability: string; species: string }): number {
  let stage = opts.critRatio ?? 1;
  if (opts.focusEnergy) stage += 2;
  if (opts.ability === "superluck") stage += 1;
  if (opts.item === "scopelens" || opts.item === "razorclaw") stage += 1;
  const base = opts.species.toLowerCase();
  if ((opts.item === "leek" || opts.item === "stick") && /farfetch|sirfetch/.test(base)) stage += 2;
  if (opts.item === "luckypunch" && base.startsWith("chansey")) stage += 2;
  return stage;
}

/** Moves whose damage is fixed or computed apart from the damage formula: they never crit. */
export const NO_CRIT_MOVES = new Set([
  "superfang", "naturesmadness", "ruination", "guardianofalola", "endeavor", "finalgambit", "counter", "mirrorcoat", "metalburst",
  "comeuppance", "bide", "psywave", "seismictoss", "nightshade", "dragonrage", "sonicboom", "painsplit",
]);

/** Types that can't get a status (Showdown's rules for secondary effects). */
export function statusImmune(status: string, types: readonly string[], gen: number, weather: string): boolean {
  if (status === "brn") return types.includes("Fire");
  if (status === "par") return gen >= 6 && types.includes("Electric");
  if (status === "frz") return types.includes("Ice") || SUN.has(weather);
  if (status === "psn" || status === "tox") return types.includes("Poison") || types.includes("Steel");
  return false;
}

// ---------------------------------------------------------------------------
// Damage rolls on a percentage HP bar
// ---------------------------------------------------------------------------

/** What a percentage HP bar shows for `hp` of `max` (Showdown rounds up, and never shows 100 for a scratch). */
export function shownPercent(hp: number, max: number): number {
  if (hp <= 0) return 0;
  const p = Math.ceil((100 * hp) / max);
  return p === 100 && hp < max ? 99 : p;
}

/**
 * Which of a hit's damage rolls (in HP, low to high) agree with the HP bar
 * going from `before`% to `after`% on a Pokémon with `max` HP: the indices
 * of the rolls that could have done it. Empty when none could (the set or
 * the field wasn't what was assumed).
 */
export function consistentRolls(rolls: readonly number[], max: number, before: number, after: number): number[] {
  if (before <= 0 || after <= 0 || max <= 0) return [];
  const lo = Math.floor((max * (before - 1)) / 100);
  const hi = Math.ceil((max * before) / 100);
  const out: number[] = [];
  rolls.forEach((d, i) => {
    for (let h = Math.max(1, lo); h <= Math.min(max, hi); h++) {
      if (shownPercent(h, max) !== before) continue;
      if (h - d > 0 && shownPercent(h - d, max) === after) {
        out.push(i);
        return;
      }
    }
  });
  return out;
}

/**
 * Where a hit landed in its damage range, 0 (the lowest roll) to 1 (the
 * highest), from the rolls that agree with the HP bar; null when the bar
 * can't tell (no roll agrees, or nearly all of them do).
 */
export function rollPosition(rolls: readonly number[], max: number, before: number, after: number): number | null {
  if (rolls.length < 2) return null;
  const ok = consistentRolls(rolls, max, before, after);
  if (!ok.length || ok.length > rolls.length * 0.6) return null;
  // Equal rolls share a place: use the distinct damage values' ranks.
  const values = [...new Set(rolls)].sort((a, b) => a - b);
  if (values.length < 2) return null;
  const ranks = ok.map((i) => values.indexOf(rolls[i]) / (values.length - 1));
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/** Chance events of one kind: how many happened, how many were expected, over how many chances. */
export interface LuckTally {
  observed: number;
  expected: number;
  /** Chances (hits that could crit, moves that could miss…). */
  n: number;
  /** Sum of p(1 − p): the spread luck alone gives. */
  variance: number;
}

export const emptyTally = (): LuckTally => ({ observed: 0, expected: 0, n: 0, variance: 0 });

/** One chance of probability `p`; `happened` says whether it came off. */
export function addChance(t: LuckTally, p: number, happened: boolean) {
  const q = Math.max(0, Math.min(1, p));
  t.n += 1;
  t.expected += q;
  t.variance += q * (1 - q);
  if (happened) t.observed += 1;
}

export interface RollTally {
  /** Hits whose roll could be placed. */
  n: number;
  /** Sum of positions (0 lowest, 1 highest). */
  sum: number;
  high: number;
  low: number;
}

export const emptyRolls = (): RollTally => ({ n: 0, sum: 0, high: 0, low: 0 });

export function addRoll(t: RollTally, position: number) {
  t.n += 1;
  t.sum += position;
  if (position >= 2 / 3) t.high += 1;
  else if (position <= 1 / 3) t.low += 1;
}

export interface SideLuckInput {
  critsLanded: LuckTally;
  critsReceived: LuckTally;
  missesOwn: LuckTally;
  missesFoe: LuckTally;
  procsLanded: LuckTally;
  procsReceived: LuckTally;
  rollsOwn: RollTally;
  rollsReceived: RollTally;
}

/** How much a damage roll counts: a top roll against an average one is worth half a lucky break. */
export const ROLL_WEIGHT = 1;
/** A uniform position's variance (1/12), times the weight squared. */
const ROLL_VARIANCE = (ROLL_WEIGHT * ROLL_WEIGHT) / 12;

/**
 * A side's luck in "lucky breaks": each crit it landed, foe miss and
 * secondary effect it got above what was expected counts +1, each one it
 * suffered −1, and each damage roll counts its distance from an average roll
 * (a top roll +0.5, a bottom roll −0.5). 0 is exactly as lucky as expected;
 * the two sides' scores are opposites. `sd` is the spread luck alone gives,
 * to say whether a score is out of the ordinary.
 */
export function luckScore(s: SideLuckInput): { score: number; sd: number; parts: { crits: number; misses: number; procs: number; rolls: number } } {
  const crits = s.critsLanded.observed - s.critsLanded.expected - (s.critsReceived.observed - s.critsReceived.expected);
  const misses = s.missesFoe.observed - s.missesFoe.expected - (s.missesOwn.observed - s.missesOwn.expected);
  const procs = s.procsLanded.observed - s.procsLanded.expected - (s.procsReceived.observed - s.procsReceived.expected);
  const rolls = ROLL_WEIGHT * (s.rollsOwn.sum - s.rollsOwn.n / 2 - (s.rollsReceived.sum - s.rollsReceived.n / 2));
  const variance =
    s.critsLanded.variance + s.critsReceived.variance + s.missesOwn.variance + s.missesFoe.variance + s.procsLanded.variance + s.procsReceived.variance + ROLL_VARIANCE * (s.rollsOwn.n + s.rollsReceived.n);
  return { score: crits + misses + procs + rolls, sd: Math.sqrt(variance), parts: { crits, misses, procs, rolls } };
}
