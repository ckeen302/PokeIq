import { ballsIn, gameOf, maxHpOf, series, type BallId, type Game, type Series, type Target } from "./formula";
import type { Inputs } from "./link";
import { speciesById, type CatchSpecies } from "./species";

/** The calculator's answer for one encounter: every ball available in the game, best first. */

export interface BallResult extends Series {
  ball: BallId;
  /** Chance per throw (the first throw: Quick and Timer Balls change with the turn). */
  chance: number;
}

export interface Ranking {
  species: CatchSpecies;
  game: Game;
  target: Target;
  /** Every ball but the Master Ball, best chance first (ties: the everyday ball first). */
  balls: BallResult[];
  master: BallResult | null;
  /** The best ball (never the Master Ball). */
  best: BallResult;
  /**
   * The cheapest everyday ball (Poké, Great or Ultra, cheapest first) that catches about as well as an Ultra Ball:
   * within a tenth of its chance. Null when only the Ultra Ball does: then there's no saving.
   */
  budget: BallResult | null;
}

/** Everyday balls in price order, cheapest first (sold in every Poké Mart). */
const EVERYDAY: BallId[] = ["poke", "great", "ultra"];
const ORDER: BallId[] = ["poke", "great", "ultra", "quick", "dusk", "timer", "net", "nest", "repeat", "dive", "level", "love", "fast", "heavy", "dream", "beast"];

export function targetOf(species: CatchSpecies, i: Pick<Inputs, "level" | "hp" | "status">): Target {
  const maxHp = maxHpOf(species.baseHp, i.level);
  const hp = Math.max(1, Math.min(maxHp, Math.round((i.hp / 1000) * maxHp)));
  return { rate: species.rate, baseHp: species.baseHp, baseSpeed: species.baseSpeed, weight: species.weight, types: species.types, ultraBeast: species.ultraBeast, level: i.level, hp, maxHp, status: i.status };
}

export function rank(i: Inputs): Ranking {
  const species = speciesById(i.id) ?? speciesById(25)!;
  const game = gameOf(i.game);
  const target = targetOf(species, i);
  const all = ballsIn(game).map((ball): BallResult => {
    const s = series(ball, game, target, i);
    return { ...s, ball, chance: s.first.chance };
  });
  const master = all.find((b) => b.ball === "master") ?? null;
  const balls = all
    .filter((b) => b.ball !== "master")
    .sort((a, b) => b.chance - a.chance || a.expected - b.expected || ORDER.indexOf(a.ball) - ORDER.indexOf(b.ball));
  const best = balls[0];
  const ultra = balls.find((b) => b.ball === "ultra")!;
  const cheap = EVERYDAY.map((id) => balls.find((b) => b.ball === id)!).find((b) => b.chance >= ultra.chance * 0.9 - 1e-9) ?? ultra;
  const budget = cheap.ball === "ultra" ? null : cheap;
  return { species, game, target, balls, master, best, budget };
}
