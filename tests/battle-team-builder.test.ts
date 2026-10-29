import { describe, expect, it } from "vitest";
import { Dex, Teams as PSTeams } from "pokemon-showdown";
import { buildIndex, matchScore, search, usageRank } from "@/lib/battle/search";
import { completeSet, exportShowdown, importShowdown, importShowdownTeams, natureFor, packTeam, unpackTeam } from "@/lib/battle/sets";
import { teamsBackupText, type BattleTeam } from "@/lib/battle/teams";
import { formatBans } from "@/app/api/battle/validate/legal/[format]/bans";

// Real-format sets, written the way Showdown's teambuilder exports them (two trailing spaces per line).
const line = (s: string) => `${s.split("\n").map((l) => (l ? `${l}  ` : l)).join("\n")}\n`;

const PASTES = {
  gen9ou: line(`The Wall (Toxapex) (F) @ Black Sludge
Ability: Regenerator
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
IVs: 0 Atk
- Toxic Spikes
- Recover
- Haze
- Surf

Gholdengo @ Choice Scarf
Ability: Good as Gold
Shiny: Yes
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Make It Rain
- Shadow Ball
- Trick
- Focus Blast
`),
  vgc: line(`Flutter Mane @ Booster Energy
Ability: Protosynthesis
Level: 50
Tera Type: Fairy
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
IVs: 0 Atk
- Moonblast
- Shadow Ball
- Icy Wind
- Protect

Sparky (Incineroar) (M) @ Safety Goggles
Ability: Intimidate
Level: 50
Shiny: Yes
Tera Type: Grass
EVs: 252 HP / 4 Atk / 116 Def / 132 SpD / 4 Spe
Careful Nature
- Fake Out
- Knock Off
- Parting Shot
- Flare Blitz
`),
  gen3: line(`Skarmory @ Leftovers
Ability: Keen Eye
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Spikes
- Roar
- Toxic
- Hidden Power [Ground]
`),
  lc: line(`Mudbray @ Eviolite
Ability: Stamina
Level: 5
Happiness: 0
Tera Type: Ground
EVs: 116 HP / 196 Def / 196 SpD
Impish Nature
IVs: 30 Spe
- Stealth Rock
- Earthquake
- Rock Slide
- Frustration
`),
};

describe("Showdown export / import round trip", () => {
  for (const [name, text] of Object.entries(PASTES)) {
    it(`gives back the exact text (${name})`, () => {
      const team = importShowdown(text);
      expect(team).not.toBeNull();
      expect(exportShowdown(team!.sets)).toBe(text);
    });
    it(`matches Pokémon Showdown's own export (${name})`, () => {
      const ours = exportShowdown(importShowdown(text)!.sets);
      const theirs = PSTeams.export(PSTeams.import(text)!);
      expect(ours.trim()).toBe(theirs.trim());
    });
    it(`survives the packed format the engine reads (${name})`, () => {
      const sets = importShowdown(text)!.sets;
      expect(exportShowdown(unpackTeam(packTeam(sets), Dex as never)!)).toBe(text);
    });
  }

  it("keeps nickname, gender, shiny, level, happiness, IVs and Tera", () => {
    const [mudbray] = importShowdown(PASTES.lc)!.sets;
    expect(mudbray).toMatchObject({ level: 5, happiness: 0, teraType: "Ground", nature: "Impish", item: "Eviolite" });
    expect(mudbray.ivs.spe).toBe(30);
    const [, sparky] = importShowdown(PASTES.vgc)!.sets;
    expect(sparky).toMatchObject({ name: "Sparky", species: "Incineroar", gender: "M", shiny: true, level: 50 });
  });

  it("imports many teams at once and backs them all up again", () => {
    const teams: BattleTeam[] = [
      { id: "a", name: "Balance", format: "gen9ou", sets: importShowdown(PASTES.gen9ou)!.sets, createdAt: 1, updatedAt: 1 },
      { id: "b", name: "Reg I", format: "gen9vgc2025regi", sets: importShowdown(PASTES.vgc)!.sets, createdAt: 1, updatedAt: 1 },
      { id: "c", name: "Old school", format: "gen3ou", sets: importShowdown(PASTES.gen3)!.sets, createdAt: 1, updatedAt: 1 },
    ];
    const backup = teamsBackupText(teams);
    const back = importShowdownTeams(backup);
    expect(back.map((t) => [t.format, t.name, t.sets.length])).toEqual([
      ["gen9ou", "Balance", 2],
      ["gen9vgc2025regi", "Reg I", 2],
      ["gen3ou", "Old school", 1],
    ]);
    back.forEach((t, i) => expect(exportShowdown(t.sets)).toBe(exportShowdown(teams[i].sets)));
  });
});

describe("builder search", () => {
  const names = ["Great Tusk", "Garchomp", "Dragapult", "Gholdengo", "Iron Valiant", "U-turn", "Swords Dance", "Tusk Tusk"];
  const index = buildIndex(names, (n) => n);

  it("ranks exact, prefix, word start, initials, substring, then fuzzy", () => {
    expect(search(index, "garchomp")[0]).toBe("Garchomp");
    expect(search(index, "tusk")).toEqual(["Tusk Tusk", "Great Tusk"]);
    expect(search(index, "sd")[0]).toBe("Swords Dance");
    expect(search(index, "uturn")).toEqual(["U-turn"]);
    expect(search(index, "u turn")).toEqual(["U-turn"]);
    expect(search(index, "grtusk")).toEqual(["Great Tusk"]);
  });

  it("forgives one typo", () => {
    expect(search(index, "drgapult")).toContain("Dragapult");
    expect(search(index, "garchopm")).toContain("Garchomp");
    expect(search(index, "gholdnego")).toContain("Gholdengo");
    expect(matchScore(index[1], "xyzw")).toBe(-1);
  });

  it("orders equal matches by usage, then filters", () => {
    const rank = usageRank(["Gholdengo", "Great Tusk", "Garchomp"])!;
    expect(search(index, "g", { rank }).slice(0, 3)).toEqual(["Gholdengo", "Great Tusk", "Garchomp"]);
    expect(search(index, "g", { rank, keep: (n) => n !== "Great Tusk" }).slice(0, 2)).toEqual(["Gholdengo", "Garchomp"]);
  });

  it("stays fast over every species and move", () => {
    const all = [...Dex.species.all().map((s) => s.name), ...Dex.moves.all().map((m) => m.name), ...Dex.items.all().map((i) => i.name)];
    const big = buildIndex(all, (n) => n);
    const t = performance.now();
    for (const q of ["g", "ga", "gar", "garc", "garch", "garcho", "garchom", "garchomp"]) search(big, q);
    expect(performance.now() - t).toBeLessThan(250);
  });
});

describe("stat editor natures", () => {
  const natures = Dex.natures.all().map((n) => ({ name: n.name, plus: n.plus, minus: n.minus }));
  const get = (name: string) => natures.find((n) => n.name === name);
  it("cycles a stat through +, − and neutral", () => {
    expect(natureFor(natures, get("Serious"), "spe")?.name).toBe("Jolly");
    expect(natureFor(natures, get("Jolly"), "atk")?.name).toBe("Adamant");
    expect(natureFor(natures, get("Adamant"), "atk")?.name).toBe("Modest");
    expect(natureFor(natures, get("Modest"), "atk")?.name).toBe("Serious");
    expect(natureFor(natures, undefined, "spa")?.name).toBe("Modest");
  });
});

describe("format bans from the validator", () => {
  it("marks what Showdown bans, with its reasons", () => {
    const ou = formatBans("gen9ou");
    expect(ou.species.koraidon).toMatch(/Uber/);
    expect(ou.species.garchomp).toBeUndefined();
    expect(ou.moves.batonpass).toBeTruthy();
    expect(ou.items.kingsrock ?? ou.items.razorfang).toBeTruthy();
    const uu = formatBans("gen9uu");
    expect(uu.species.gholdengo).toMatch(/OU/);
  });
});

it("completes partial sets the way Showdown reads them", () => {
  expect(completeSet({ species: "Pikachu" }).ivs.spe).toBe(31);
});
