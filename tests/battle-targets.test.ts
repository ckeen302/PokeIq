import { describe, expect, it } from "vitest";
import { Battle } from "pokemon-showdown";
import { targetChoices } from "@/components/battle/play/moves";

describe("doubles targets (Showdown's target locations)", () => {
  it("lets normal and any moves aim at the partner, foe-only moves only at foes", () => {
    expect(targetChoices("normal", 0)).toEqual([1, 2, -2]);
    expect(targetChoices("any", 1)).toEqual([1, 2, -1]);
    expect(targetChoices("adjacentFoe", 0)).toEqual([1, 2]);
    expect(targetChoices("adjacentAllyOrSelf", 0)).toEqual([-1, -2]);
    expect(targetChoices("allAdjacentFoes", 0)).toEqual([]);
  });

  it("the simulator accepts Pollen Puff aimed at the partner", () => {
    const team = (a: string, b: string) =>
      [a, b].map((s) => `${s}|||NoAbility|pollenpuff,tackle||||||50|`).join("]");
    const battle = new Battle({ formatid: "gen9doublescustomgame" as never, seed: [1, 2, 3, 4] });
    battle.setPlayer("p1", { name: "A", team: team("Ribombee", "Pikachu") });
    battle.setPlayer("p2", { name: "B", team: team("Pikachu", "Eevee") });
    battle.choose("p1", "team 12");
    battle.choose("p2", "team 12");
    expect(battle.choose("p1", `move 1 ${targetChoices("normal", 0)[2]}, move 2 1`)).toBe(true);
  });
});
