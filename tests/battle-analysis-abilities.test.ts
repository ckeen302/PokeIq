import { describe, expect, it } from "vitest";
import { abilityName, parseReplay } from "@/lib/battle/analysis/parse";
import { selfPlay } from "./helpers/selfplay";

describe("revealed abilities", () => {
  it("reads Calyrex's riders' \"As One\" as the ability the Dex knows", () => {
    expect(abilityName("As One", "Calyrex-Shadow")).toBe("As One (Spectrier)");
    expect(abilityName("As One", "Calyrex-Ice")).toBe("As One (Glastrier)");
    expect(abilityName("asone", "Calyrex-Shadow")).toBe("As One (Spectrier)");
  });
  it("keeps known abilities and drops names it can't place", () => {
    expect(abilityName("Intimidate", "Gyarados")).toBe("Intimidate");
    expect(abilityName("intimidate", "Gyarados")).toBe("Intimidate");
    expect(abilityName("Not An Ability", "Gyarados")).toBeNull();
  });
  it("gives a real battle's Calyrex-Shadow its full ability, so the Lab can rebuild it", () => {
    // Seed 112 of Random Doubles has Calyrex-Shadow on Red's side; before this its revealed ability was "asone".
    const live = selfPlay("gen9randomdoublesbattle", 112, { maxTurns: 3 });
    const parsed = parseReplay(live.log);
    const calyrex = [...parsed.revealed[0].values(), ...parsed.revealed[1].values()].find((r) => r.species === "Calyrex-Shadow");
    expect(calyrex?.ability).toBe("As One (Spectrier)");
  });
});
