import { describe, expect, it } from "vitest";
import { importShowdownTeams } from "@/lib/battle/sets";

const BACKUP = `=== [gen9ou] Sun ===

Torkoal @ Heat Rock
Ability: Drought
- Stealth Rock
- Lava Plume

Venusaur @ Life Orb
Ability: Chlorophyll
- Growth
- Giga Drain


=== [gen9ubers] Box ===

Koraidon @ Choice Scarf
Ability: Orichalcum Pulse
- Flare Blitz
`;

describe("Showdown teambuilder backups", () => {
  it("imports every team with its format and name", () => {
    const teams = importShowdownTeams(BACKUP);
    expect(teams.map((t) => [t.format, t.name, t.sets.map((s) => s.species)])).toEqual([
      ["gen9ou", "Sun", ["Torkoal", "Venusaur"]],
      ["gen9ubers", "Box", ["Koraidon"]],
    ]);
  });

  it("reads a plain export as one team", () => {
    expect(importShowdownTeams("Pikachu @ Light Ball\n- Thunderbolt\n")).toHaveLength(1);
  });
});
