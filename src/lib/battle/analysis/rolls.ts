import type { Generation } from "@pkmn/data";
import { calcMoves, emptyField, makePokemon, type CalcModule } from "@/lib/battle/calc";
import type { AssumedSet } from "./assume";
import { calcSide, fieldOf } from "./facts";
import { rollPosition } from "./luck-math";
import type { TurnState } from "./parse";
import type { RollCandidate } from "./stats";

/**
 * Damage rolls, placed with the damage calc: the hit's sixteen rolls for
 * the attacker and defender as they stood (HP, stat stages, status, Tera,
 * screens, weather and terrain), on the assumed sets, against what the HP
 * bar showed. Only where the sets' stats are known exactly (random formats,
 * whose spreads are fixed), and only hits the bar can place: a hit no roll
 * explains (the set or the field wasn't what was assumed) is left out.
 */

type Calc = { gen: Generation; lib: CalcModule };

export function rollPlacer(calc: Calc, sets: Map<string, AssumedSet>): (c: RollCandidate) => number | null {
  return (c) => {
    const a = sets.get(c.attacker.key);
    const d = sets.get(c.defender.key);
    if (!a || !d || a.source !== "random" || d.source !== "random") return null;
    try {
      const attacker = calcSide(c.attacker, a, c.attackerConditions);
      const defender = calcSide(c.defender, d, c.defenderConditions, c.before);
      const field = { ...emptyField(), ...fieldOf({ weather: c.weather, terrain: c.terrain } as TurnState) };
      const line = calcMoves(calc, { ...attacker, moves: [c.move] }, defender, field)[0];
      if (!line || line.category === "Status" || line.rolls.length < 2) return null;
      const max = makePokemon(calc, defender).maxHP();
      return rollPosition(line.rolls, max, c.before, c.after);
    } catch {
      return null;
    }
  };
}

/** Max HP from an assumed set, when its spread is known exactly (random formats). */
export function maxHpOf(calc: Calc, set: AssumedSet | undefined): number | null {
  if (!set || set.source !== "random") return null;
  try {
    return makePokemon(calc, { ...calcSide({ key: set.key, species: set.set.species, level: set.set.level, hp: 100, fainted: false, status: "", boosts: {}, terastallized: "", item: null }, set, {}) }).maxHP();
  } catch {
    return null;
  }
}
