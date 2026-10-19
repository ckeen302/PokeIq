import "server-only";
import type { Battle as PolicyBattle, Side as PolicySide } from "@pkmn/sim";
import type { Battle, Side } from "pokemon-showdown";
import type { CpuLevel } from "@/lib/battle/play";
import { chooseCpu as choose } from "@/lib/battle/cpu-policy";

// The computer opponent's policy is isomorphic (the Battle Lab runs it in the browser too).
export { seededRandom } from "@/lib/battle/cpu-policy";

/**
 * The computer's choice on a server battle. The policy is typed on
 * @pkmn/sim's Battle (what the Lab's workers run); the official simulator's
 * Battle, Side and Pokemon have the same fields, since @pkmn/sim is a
 * build of it, and the battle tests run the policy on it.
 */
export function chooseCpu(battle: Battle, side: Side, level: CpuLevel, rand: () => number, onError?: (err: unknown) => void): string {
  return choose(battle as unknown as PolicyBattle, side as unknown as PolicySide, level, rand, onError);
}
