import type { StatKey } from "./pokedex";

/**
 * Gen 3+ stat formulas, used for the min/max stat ranges in the Pokédex.
 * Min = 0 IV, 0 EV, hindering nature; max = 31 IV, 252 EV, boosting nature.
 */
export function statRange(key: StatKey, base: number, level: number, isShedinja = false): [number, number] {
  if (key === "hp") {
    if (isShedinja) return [1, 1];
    const hp = (iv: number, ev: number) => Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
    return [hp(0, 0), hp(31, 252)];
  }
  const stat = (iv: number, ev: number, nature: number) =>
    Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * nature);
  return [stat(0, 0, 0.9), stat(31, 252, 1.1)];
}

/**
 * Probability of a catch with a Poké Ball at full HP, no status (Gen 5+).
 * At full HP the modified rate is a = rate / 3; each of the shake checks
 * passes with b / 65536 where b = 65536 / (255 / a)^(3/16) (Gen 6+; Gen 5's
 * three checks at ^(1/4) give the same total), so the catch chance is
 * (a / 255)^(3/4). Critical captures are ignored.
 */
export function catchChance(captureRate: number): number {
  return Math.min(1, (captureRate / 765) ** 0.75);
}
