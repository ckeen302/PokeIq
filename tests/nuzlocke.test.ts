import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import DETAILS from "@/data/pokedex-details.json";
import type { NuzEncounter, NuzGame, NuzStep } from "@/lib/nuzlocke/model";
import { NUZ_GAMES, loadGame } from "@/lib/nuzlocke/games";
import { buildView, formFor, generation, specieFor } from "@/lib/nuzlocke/view.server";
import { allAreas, artSrc, bossKeys, inVersion, type GameView } from "@/lib/nuzlocke/view";
import { availableGames, gameSummaries, gameView } from "@/lib/nuzlocke/games.server";
import { groupByMethod, methodLabel } from "@/lib/nuzlocke/group";
import { compactEncounters } from "@/lib/nuzlocke/compact";
import { matchupSummary, multiplier, teamMatchups } from "@/lib/nuzlocke/matchups";
import {
  DEFAULT_RULES,
  addBadge,
  badgeCount,
  badgeTotal,
  box,
  clearArea,
  createRun,
  dupeOf,
  evolve,
  levelCap,
  logCatch,
  logFailed,
  moveInTeam,
  removeBadge,
  removeMon,
  setStatus,
  setsCap,
  skipArea,
  standing,
  storyBefore,
  swap,
  team,
  toggleBoss,
  type Run,
} from "@/lib/nuzlocke/run";
import { STORE_KEY, backupName, deleteRun, exportRun, importRun, listRuns, loadStore, saveRun, sanitizeRun } from "@/lib/nuzlocke/storage";
import { decodeRun, encodeRun } from "@/lib/nuzlocke/share";

/** A little game for a case: one area of these encounters, in a generation. */
function game(gen: number, encounters: Partial<NuzEncounter>[], steps: NuzStep[] = []): NuzGame {
  return {
    id: `test-gen${gen}`,
    name: "Test",
    gen,
    region: "Test",
    versions: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    steps: [{ type: "area", area: { id: "here", name: "Here", encounters: encounters.map((e) => ({ kind: "wild", method: "Grass", species: 1, ...e })) } }, ...steps],
    extra: [],
    sources: [],
  };
}

const T0 = 1_700_000_000_000;
let frlg: GameView;
const frlgView = async () => (frlg ??= buildView((await loadGame("firered-leafgreen"))!));
const typesOf = (view: GameView, key: string) => view.mons[key]?.types;

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe("the game data the screens use", () => {
  it("is on the real game data, with no dev fixture left", () => {
    expect(existsSync("src/lib/nuzlocke/dev-fixture.ts")).toBe(false);
    expect(NUZ_GAMES.length).toBeGreaterThan(0);
  });

  it("builds every listed game that has data: each Pokémon met has its picture, page and types", async () => {
    for (const g of NUZ_GAMES) {
      const game = await loadGame(g.id);
      if (!game) continue; // listed before its data lands: the pages leave it out (next test)
      const v = buildView(game);
      for (const a of allAreas(v))
        for (const e of a.encounters) {
          const mon = v.mons[e.mon];
          expect(mon, `${g.id} ${a.id} ${e.mon}`).toBeDefined();
          expect(mon.types.length, `${g.id} ${e.mon}`).toBeGreaterThan(0);
          expect(mon.slug).toMatch(/^[a-z0-9-]+$/);
        }
      const keys = v.steps.flatMap((s) => (s.type === "boss" ? [s.boss.key] : []));
      expect(new Set(keys).size, g.id).toBe(keys.length);
    }
  });

  it("leaves out a game without data, gracefully", async () => {
    expect(await loadGame("no-such-game")).toBeNull();
    expect(await gameView("no-such-game")).toBeNull();
    const offered = await availableGames();
    expect(offered.every((g) => NUZ_GAMES.includes(g))).toBe(true);
    for (const g of offered) expect(await loadGame(g.id)).not.toBeNull();
    expect((await gameSummaries()).map((g) => g.id)).toEqual(offered.map((g) => g.id));
  });

  it("maps every PokéAPI form the Pokédex has to Showdown's, with the same types", () => {
    const gen = generation(9);
    for (const [id, d] of Object.entries(DETAILS as unknown as Record<string, { forms?: { slug: string; types: string[] }[] }>)) {
      for (const f of d.forms ?? []) {
        const s = specieFor(gen, Number(id), f.slug);
        expect(s?.num, f.slug).toBe(Number(id));
        expect(s?.types.map((t) => t.toLowerCase()), f.slug).toEqual(f.types);
      }
    }
    // And back: Showdown's regional formes are PokéAPI's form names.
    expect(formFor(gen.species.get("Raichu-Alola")!)).toBe("raichu-alola");
    expect(formFor(gen.species.get("Darmanitan-Galar")!)).toBe("darmanitan-galar-standard");
    expect(formFor(gen.species.get("Tauros-Paldea-Combat")!)).toBe("tauros-paldea-combat-breed");
    expect(formFor(gen.species.get("Raichu")!)).toBeUndefined();
  });

  it("gives each Pokémon its generation's typing, form included", () => {
    const g1 = buildView(game(1, [{ species: 35 }, { species: 81 }]));
    const g6 = buildView(game(6, [{ species: 35 }, { species: 81 }]));
    expect(typesOf(g1, "35")).toEqual(["normal"]); // Clefairy before Fairy existed
    expect(typesOf(g6, "35")).toEqual(["fairy"]);
    expect(typesOf(g1, "81")).toEqual(["electric"]); // Magnemite was Steel from Gen 2
    expect(typesOf(g6, "81")).toEqual(["electric", "steel"]);
    const g7 = buildView(game(7, [{ species: 19, form: "rattata-alola" }, { species: 19 }]));
    expect(typesOf(g7, "rattata-alola")).toEqual(["dark", "normal"]);
    expect(typesOf(g7, "19")).toEqual(["normal"]);
    expect(g7.mons["rattata-alola"].evos).toEqual(["raticate-alola"]);
    expect(g7.mons["rattata-alola"].art).toBe(10091);
    expect(g7.mons["rattata-alola"].name).toBe("Alolan Rattata");
    expect(g7.mons["rattata-alola"].showdown).toBe("Rattata-Alola");
    // The Team Builder's first pick of ability, from Gen 3 on.
    expect(g1.mons["35"].ability).toBeUndefined();
    expect(g6.mons["35"].ability).toBe("Cute Charm");
    expect(g7.mons["rattata-alola"].ability).toBe("Gluttony");
  });


  it("gives Sun & Moon's Alolan forms their own types, names and pictures", async () => {
    const v = buildView((await loadGame("sun-moon"))!);
    expect(v.mons["rattata-alola"]).toMatchObject({ name: "Alolan Rattata", types: ["dark", "normal"], art: 10091, showdown: "Rattata-Alola" });
    expect(v.mons["meowth-alola"]?.types).toEqual(["dark"]);
    expect(v.mons["grimer-alola"]?.types).toEqual(["poison", "dark"]);
    expect(v.mons["diglett-alola"]?.types).toEqual(["ground", "steel"]);
    const route1 = allAreas(v).find((a) => a.id === "route-1")!;
    expect(route1.encounters.some((e) => e.mon === "rattata-alola")).toBe(true);
    // Pa'u Oricorio, whose picture the tracker added: its own picture, name and types.
    const pau = v.mons["oricorio-pau"];
    if (pau) {
      expect(pau.art).toBe(10124);
      expect(pau.types).toEqual(["psychic", "flying"]);
    }
  });

  it("names a form as the games do, and hands the Team Builder Showdown's own", () => {
    const v = buildView(game(8, [{ species: 550, form: "basculin-blue-striped" }, { species: 678, form: "meowstic-female" }, { species: 677 }, { species: 876, form: "indeedee-female" }]));
    expect(v.mons["basculin-blue-striped"]).toMatchObject({ name: "Blue-Striped Basculin", showdown: "Basculin-Blue-Striped", art: 10016 });
    expect(v.mons["meowstic-female"]).toMatchObject({ name: "Female Meowstic", showdown: "Meowstic-F" });
    expect(v.mons["677"].evos).toContain("meowstic-female"); // Espurr's evolution is the same key as the data's
    expect(v.mons["indeedee-female"].showdown).toBe("Indeedee-F");
  });

  it("gives every form its own picture, and every picture is a file", async () => {
    // Partner Pikachu and Partner Eevee have no HOME render, and look like Pikachu and Eevee.
    const lookAlike = new Set(["pikachu-starter", "eevee-starter"]);
    for (const g of NUZ_GAMES) {
      const game = await loadGame(g.id);
      if (!game) continue;
      for (const m of Object.values(buildView(game).mons)) {
        expect(existsSync(join("public", artSrc(m.art))), `${g.id} ${m.key}: ${artSrc(m.art)}`).toBe(true);
        if (m.form && !lookAlike.has(m.form)) expect(m.art, `${g.id} ${m.key}`).not.toBe(m.species);
      }
    }
    // A cosmetic form evolves into its own sea's, its own flower's.
    const v = buildView(game(6, [{ species: 422, form: "shellos-east" }, { species: 669, form: "flabebe-yellow" }]));
    expect(v.mons["shellos-east"]).toMatchObject({ name: "East Sea Shellos", art: "/tools/nuzlocke/forms/422-east.webp", evos: ["gastrodon-east"] });
    expect(v.mons["flabebe-yellow"].evos).toEqual(["floette-yellow"]);
    expect(v.mons["floette-yellow"]).toMatchObject({ name: "Yellow Floette", types: ["fairy"], evos: ["florges-yellow"] });
    expect(v.mons["florges-yellow"].art).toBe("/tools/nuzlocke/forms/671-yellow.webp");
    expect(buildView(game(4, [{ species: 479, form: "rotom-heat", art: 10008 }])).mons["rotom-heat"].art).toBe(10008);
  });

  it("offers each generation's own evolutions", () => {
    const g1 = buildView(game(1, [{ species: 133 }, { species: 42 }]));
    const g3 = buildView(game(3, [{ species: 133 }, { species: 42 }]));
    expect(g1.mons["133"].evos).toEqual(["134", "135", "136"]);
    expect(g3.mons["133"].evos).toEqual(["134", "135", "136", "196", "197"]);
    expect(g1.mons["42"].evos).toBeUndefined(); // no Crobat in Gen 1
    expect(g3.mons["42"].evos).toEqual(["169"]);
    const g8 = buildView(game(8, [{ species: 52, form: "meowth-galar" }, { species: 52 }]));
    expect(g8.mons["meowth-galar"].evos).toEqual(["863"]); // Galarian Meowth → Perrserker
    expect(g8.mons["52"].evos).toEqual(["53"]);
  });

  it("builds the generation's type chart", () => {
    const g1 = buildView(game(1, [])).chart;
    const g3 = buildView(game(3, [])).chart;
    const g5 = buildView(game(5, [])).chart;
    const g6 = buildView(game(6, [])).chart;
    expect(multiplier(g1, "ghost", ["psychic"])).toBe(0); // the Gen 1 Ghost / Psychic bug
    expect(multiplier(g3, "ghost", ["psychic"])).toBe(2);
    expect(multiplier(g1, "bug", ["poison"])).toBe(2);
    expect(multiplier(g3, "bug", ["poison"])).toBe(0.5);
    expect(multiplier(g1, "ice", ["fire"])).toBe(1);
    expect(multiplier(g3, "ice", ["fire"])).toBe(0.5);
    expect(multiplier(g5, "ghost", ["steel"])).toBe(0.5);
    expect(multiplier(g6, "ghost", ["steel"])).toBe(1);
    expect(buildView(game(1, [])).types).toHaveLength(15);
    expect(buildView(game(3, [])).types).toHaveLength(17);
    expect(buildView(game(9, [])).types).toHaveLength(18);
  });

  it("groups an area's encounters by how they're met, each Pokémon once", async () => {
    const view = await frlgView();
    const pallet = view.steps.find((s) => s.type === "area" && s.area.id === "pallet-town");
    const groups = groupByMethod(pallet!.type === "area" ? pallet!.area.encounters : []);
    expect(groups.map((g) => g.method).sort()).toEqual(["Good Rod", "Old Rod", "Starter", "Super Rod", "Surf"]);
    expect(groups.find((g) => g.method === "Starter")).toMatchObject({ kind: "gift", rows: [{ mon: "1" }, { mon: "4" }, { mon: "7" }] });
    const krabby = groups.find((g) => g.method === "Good Rod")!.rows.find((r) => r.mon === "98")!;
    expect(krabby.stats).toEqual([
      { versions: ["leafgreen"], rate: 60, levels: [5, 15] },
      { versions: ["firered"], rate: 20, levels: [5, 15] },
    ]);
  });
});


describe("an area's encounters, summed up", () => {
  const W = (weather: string | null, stage: string, rate: number, levels: [number, number], extra: Partial<NuzEncounter> = {}): NuzEncounter => ({
    species: 1,
    kind: "wild",
    method: "Grass",
    rate,
    levels,
    condition: [stage, weather].filter(Boolean).join("; "),
    ...extra,
  });
  const ALL = [null, "During overcast weather", "During rainy weather", "During foggy weather"];
  const both = (w: string | null, r: number) => [W(w, "Before entering the Hall of Fame", r, [7, 10]), W(w, "Enter the Hall of Fame", r, [60, 60])];

  it("shows a Wild Area Pokémon once in the story (and once after it), with its weathers in a word and its rates as a range", () => {
    const area = [...ALL.flatMap((w) => both(w, 20)), ...[null, "During rainy weather"].flatMap((w, i) => both(w, 5 + i * 5).map((e) => ({ ...e, species: 2 })))];
    const out = compactEncounters(area, ["a", "b"]);
    const story = out.filter((e) => !e.post);
    expect(story).toHaveLength(2);
    // Every weather the grass has: no condition left but "Any weather" ("Before the Hall of Fame" goes unsaid, as there's a post-game line).
    expect(story[0]).toMatchObject({ species: 1, when: ["Any weather"], rate: 20, levels: [7, 10] });
    expect(story[0].condition).toBeUndefined();
    // Two of four weathers: named; two rates: a range.
    expect(story[1]).toMatchObject({ species: 2, when: ["Normal weather", "Rain"], rateMin: 5, rate: 10, levels: [7, 10] });
    // After the Hall of Fame, apart, with its own levels.
    expect(out.filter((e) => e.post)).toEqual([expect.objectContaining({ species: 1, post: "After the Hall of Fame", levels: [60, 60] }), expect.objectContaining({ species: 2, post: "After the Hall of Fame", levels: [60, 60] })]);
  });

  it("names the one or two weathers a Pokémon is missing from, and leaves weather out where the method has none", () => {
    const six = [null, "During overcast weather", "During rainy weather", "During a thunderstorm", "During foggy weather", "During a sandstorm"];
    const area = [
      ...six.map((w) => W(w, "Enter the Hall of Fame", 10, [60, 60])),
      ...six.slice(0, 4).map((w) => W(w, "Enter the Hall of Fame", 10, [60, 60], { species: 2 })),
      W(null, "Enter the Hall of Fame", 30, [60, 60], { species: 3, method: "Fishing" }),
    ];
    const [one, two, fish] = compactEncounters(area, ["a"]);
    expect(one.when).toEqual(["Any weather"]);
    expect(one.post).toBe("After the Hall of Fame");
    expect(one.condition).toBeUndefined();
    expect(two.when).toEqual(["Any weather but Sandstorm and Fog"]);
    expect(fish.when).toBeUndefined(); // the fishing has no weather in the data: it isn't "normal weather" only
    expect(fish.post).toBe("After the Hall of Fame");
  });

  it("keeps a few plain lines as they are, and sums up a version's own lines in that version only", () => {
    const floors = compactEncounters(
      [
        { species: 41, kind: "wild", method: "Cave", rate: 69, levels: [7, 9], condition: "1F" },
        { species: 41, kind: "wild", method: "Cave", rate: 20, levels: [8, 10], condition: "B1F" },
      ],
      ["a", "b"]
    );
    expect(floors.map((e) => e.condition)).toEqual(["1F", "B1F"]);
    const lines: NuzEncounter[] = [
      ...[1, 2, 3].map((n) => ({ species: 5, kind: "wild" as const, method: "Grass", rate: 10 * n, levels: [n, n] as [number, number], condition: `Area ${n}` })),
      { species: 5, kind: "wild", method: "Grass", rate: 50, levels: [9, 9], condition: "Area 4", versions: ["b"] },
    ];
    const out = compactEncounters(lines, ["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ versions: ["a"], when: ["Area 1", "Area 2", "Area 3"], rateMin: 10, rate: 30 });
    expect(out[1]).toMatchObject({ versions: ["b"], when: ["Area 1", "Area 2", "Area 3", "Area 4"], rate: 50, levels: [1, 9] });
  });

  it("leaves out the time of day when the lines cover the whole day", () => {
    const day = (condition: string, rate: number): NuzEncounter => ({ species: 7, kind: "wild", method: "Grass", rate, levels: [3, 5], condition });
    const [all] = compactEncounters([day("Morning, Day", 10), day("Night", 30), day("1F; Night", 5), day("1F; Morning", 5)], ["a"]);
    expect(all.when).toEqual(["1F"]);
    const [night] = compactEncounters([day("Night", 30), day("1F; Night", 5), day("2F; Night", 5), day("3F; Night", 5)], ["a"]);
    expect(night.when).toEqual(["Night", "1F", "2F", "3F"]);
  });

  it("brings Sword & Shield's Wild Area down to each Pokémon once per way of meeting it, per version", async () => {
    const game = await loadGame("sword-shield");
    expect(game).not.toBeNull();
    const v = buildView(game!);
    const lines = [...game!.steps.flatMap((s) => (s.type === "area" ? [s.area] : [])), ...game!.extra].reduce((n, a) => n + a.encounters.length, 0);
    const entries = allAreas(v).reduce((n, a) => n + a.encounters.length, 0);
    expect(lines).toBeGreaterThan(10_000);
    expect(entries).toBeLessThan(lines / 2);
    expect(JSON.stringify(v).length).toBeLessThan(800_000);
    for (const a of allAreas(v))
      for (const version of ["sword", "shield"])
        for (const g of groupByMethod(a.encounters.filter((e) => inVersion(e, version))))
          for (const r of g.rows) {
            // Once per way of meeting it, in the story and after it: one summed-up line each, or up to three plain ones.
            for (const part of [r.stats.filter((x) => !x.post), r.stats.filter((x) => x.post)]) {
              if (part.some((x) => x.when)) expect(part, `${a.id} ${g.method} ${r.mon}`).toHaveLength(1);
              else expect(part.length, `${a.id} ${g.method} ${r.mon}`).toBeLessThanOrEqual(3);
            }
          }
  });

  it("words a honey tree's group shortly, saying the same", async () => {
    const tree = (condition: string, method = "Honey Tree"): NuzEncounter => ({ species: 190, kind: "wild", method, rate: 10, levels: [5, 15], condition });
    const [a, b] = compactEncounters(
      [tree("Honey Tree Group A (70% on normal trees / 20% on Munchlax trees)"), tree("Honey Tree Group B (20% on normal trees / 70% on Munchlax trees)")],
      ["a"]
    );
    expect([a.condition, b.condition]).toEqual(["Group A (70% normal / 20% Munchlax trees)", "Group B (20% normal / 70% Munchlax trees)"]);
    const [elsewhere] = compactEncounters([tree("Route 205; Honey Tree Group C (0% on normal trees / 1% on Munchlax trees)", "Grass")], ["a"]);
    expect(elsewhere.condition).toBe("Route 205; Honey tree group C (0% normal / 1% Munchlax trees)");
    // In the data, every honey tree group is under a Honey Tree heading.
    const v = buildView((await loadGame("platinum"))!);
    const honey = allAreas(v).flatMap((x) => x.encounters).filter((e) => /group [a-z] \(/i.test(e.condition ?? "") || e.when?.some((w) => /group [a-z] \(/i.test(w)));
    expect(honey.length).toBeGreaterThan(0);
    for (const e of honey) expect(e.method).toBe("Honey Tree");
  });

  it("keeps the story's levels apart from the post-game's", async () => {
    const line = (stage: string, levels: [number, number], rate?: number): NuzEncounter => ({ species: 43, kind: "wild", method: "Grass", levels, ...(rate !== undefined && { rate }), condition: `Main Area; ${stage}; During overcast weather` });
    const out = compactEncounters([line("Before entering the Hall of Fame", [7, 10]), line("Enter the Hall of Fame", [60, 60], 40)], ["a"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ levels: [7, 10] });
    expect(out[0].post).toBeUndefined();
    expect(out[0].condition).toBe("Main Area"); // "Before the Hall of Fame" goes unsaid: the post-game line says the difference
    expect(out[1]).toMatchObject({ post: "After the Hall of Fame", levels: [60, 60], rate: 40, condition: "Main Area" });
    // Sword & Shield: Rolling Fields' Oddish is Lv 7–10 in the story, and Lv 60 after it, apart.
    const v = buildView((await loadGame("sword-shield"))!);
    const oddish = allAreas(v).find((a) => a.id === "rolling-fields")!.encounters.filter((e) => e.mon === "43" && e.method === "Grass");
    expect(oddish.filter((e) => !e.post).every((e) => e.levels![1] <= 10)).toBe(true);
    expect(oddish.filter((e) => e.post)).toEqual([expect.objectContaining({ post: "After the Hall of Fame", levels: [60, 60] })]);
    // The Isle of Armor has both, kept apart too; the Crown Tundra's lines don't depend on the Hall of Fame.
    for (const id of ["fields-of-honor", "soothing-wetlands", "giants-bed"]) {
      const area = allAreas(v).find((a) => a.id === id)!;
      expect(area.encounters.some((e) => !e.post && e.kind === "wild"), id).toBe(true);
      expect(area.encounters.some((e) => e.post === "After the Hall of Fame"), id).toBe(id !== "giants-bed");
      for (const e of area.encounters) expect([e.condition, ...(e.when ?? [])].join(" "), id).not.toMatch(/Hall of Fame/);
    }
  });

  it("joins the items a fossil needs", () => {
    const [e] = compactEncounters([{ species: 883, kind: "fossil", method: "Fossil", condition: "Have Fossilized Dino in bag; Have Fossilized Fish in bag" }], ["a"]);
    expect(e.condition).toBe("Fossilized Dino + Fossilized Fish");
    const [one] = compactEncounters([{ species: 138, kind: "fossil", method: "Fossil", condition: "Cinnabar Lab; Have Helix Fossil in bag" }], ["a"]);
    expect(one.condition).toBe("Cinnabar Lab; Have Helix Fossil in bag");
  });

  it("heads Platinum's dual-slot encounters by the GBA game in slot 2", () => {
    expect(methodLabel("FireRed")).toBe("FireRed in slot 2");
    expect(methodLabel("Grass")).toBe("Grass");
  });
});

describe("the team's type matchups, per generation", () => {
  it("Clefairy: Normal in Gen 1, Fairy in Gen 6", () => {
    const g1 = buildView(game(1, [{ species: 35 }]));
    const g6 = buildView(game(6, [{ species: 35 }]));
    const at = (v: GameView) => Object.fromEntries(teamMatchups([v.mons["35"].types], v.types, v.chart).map((l) => [l.type, l.each[0]]));
    expect(at(g1)).toMatchObject({ fighting: 2, ghost: 0, poison: 1 });
    expect(at(g6)).toMatchObject({ fighting: 0.5, poison: 2, steel: 2, dragon: 0, bug: 0.5, dark: 0.5, ghost: 1 });
  });

  it("Alolan Rattata (Dark / Normal): Fighting ×4, immune to Ghost and Psychic", () => {
    const v = buildView(game(7, [{ species: 19, form: "rattata-alola" }]));
    const by = Object.fromEntries(teamMatchups([v.mons["rattata-alola"].types], v.types, v.chart).map((l) => [l.type, l.each[0]]));
    expect(by).toMatchObject({ fighting: 4, bug: 2, fairy: 2, ghost: 0, psychic: 0, dark: 0.5 });
  });

  it("counts a whole team: Venusaur, Pidgeot and Alakazam in Gen 1 and Gen 3", () => {
    const enc = [{ species: 3 }, { species: 18 }, { species: 65 }];
    const g1 = buildView(game(1, enc));
    const g3 = buildView(game(3, enc));
    const lines = (v: GameView) => teamMatchups(["3", "18", "65"].map((k) => v.mons[k].types), v.types, v.chart);
    const bug1 = lines(g1).find((l) => l.type === "bug")!;
    expect(bug1.each).toEqual([4, 0.5, 2]); // Gen 1: Bug hits Poison too (Flying still resists it)
    expect(bug1).toMatchObject({ weak: 2, x4: 1, resist: 1 });
    expect(lines(g3).find((l) => l.type === "bug")!.each).toEqual([1, 0.5, 2]);
    expect(lines(g1).find((l) => l.type === "ghost")!.each).toEqual([1, 0, 0]); // Normal/Flying immune; Psychic too in Gen 1
    expect(lines(g3).find((l) => l.type === "ghost")!.each).toEqual([1, 0, 2]);
    const s = matchupSummary(lines(g3));
    expect(s.weak[0]).toMatchObject({ type: "ice" }); // Venusaur and Pidgeot
    expect(s.gaps.map((l) => l.type)).toContain("ice");
    expect(s.resist.find((l) => l.type === "ground")).toMatchObject({ resist: 1, immune: 1, each: [1, 0, 1] }); // Pidgeot immune; Grass/Poison cancels out
  });
});

describe("a run", () => {
  it("logs an area's one encounter, and opens it again", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "Test", now: T0 });
    const caught = logCatch(run, { area: "route-1", mon: "16", kind: "wild" }, T0, "pidgey");
    run = caught.run;
    expect(run.areas["route-1"]).toEqual({ kind: "caught", mon: "pidgey" });
    expect(team(run).map((m) => m.id)).toEqual(["pidgey"]);
    // A second catch there doesn't count.
    expect(logCatch(run, { area: "route-1", mon: "19", kind: "wild" }, T0).mon).toBeNull();
    run = logFailed(run, "route-22", "56", T0);
    run = skipArea(run, "viridian-city", T0);
    expect(run.areas["route-22"]).toEqual({ kind: "failed", met: "56" });
    expect(run.areas["viridian-city"]).toEqual({ kind: "skipped" });
    run = clearArea(run, "route-1", T0);
    expect(run.areas["route-1"]).toBeUndefined();
    expect(run.mons).toHaveLength(0);
  });

  it("follows the rules: gifts and statics count or not, the shiny clause, a full team", () => {
    let run = createRun({ game: "x", version: "a", name: "T", rules: { ...DEFAULT_RULES, gifts: false }, now: T0 });
    run = logCatch(run, { area: "pallet", mon: "1", kind: "gift" }, T0, "bulba").run;
    expect(run.mons[0]).toMatchObject({ free: true, kind: "gift" });
    expect(run.areas.pallet).toBeUndefined(); // the area is still open
    run = logCatch(run, { area: "pallet", mon: "129", kind: "wild" }, T0, "karp").run;
    expect(run.areas.pallet).toEqual({ kind: "caught", mon: "karp" });
    run = logCatch(run, { area: "pallet", mon: "72", kind: "wild", shiny: true }, T0, "shiny").run;
    expect(run.mons.find((m) => m.id === "shiny")).toMatchObject({ free: true, shiny: true });
    const strict = createRun({ game: "x", version: "a", name: "T", rules: { ...DEFAULT_RULES, shiny: false }, now: T0 });
    expect(logCatch(strict, { area: "r", mon: "72", kind: "wild", shiny: true }, T0).mon?.free).toBeUndefined();
    // The seventh catch waits in the box; the team can't take a seventh; a swap trades places.
    let full = createRun({ game: "x", version: "a", name: "T", now: T0 });
    for (let i = 0; i < 7; i++) full = logCatch(full, { area: `a${i}`, mon: String(i + 1), kind: "wild" }, T0, `m${i}`).run;
    expect(team(full)).toHaveLength(6);
    expect(box(full).map((m) => m.id)).toEqual(["m6"]);
    expect(setStatus(full, "m6", "team", undefined, T0)).toBe(full);
    const swapped = swap(full, "m6", "m2", T0);
    expect(team(swapped).map((m) => m.id)).toEqual(["m0", "m1", "m6", "m3", "m4", "m5"]);
    expect(box(swapped).map((m) => m.id)).toEqual(["m2"]);
    expect(team(moveInTeam(full, "m5", 0, T0)).map((m) => m.id)).toEqual(["m5", "m0", "m1", "m2", "m3", "m4"]);
  });

  it("marks the fallen, and a removed Pokémon reopens its area", () => {
    let run = createRun({ game: "x", version: "a", name: "T", now: T0 });
    run = logCatch(run, { area: "r1", mon: "16", kind: "wild", level: 3 }, T0, "skye").run;
    run = setStatus(run, "skye", "dead", { by: 95, area: "boss:brock", level: 12 }, T0 + 5);
    expect(run.mons[0]).toMatchObject({ status: "dead", level: 12, death: { by: 95, area: "boss:brock", level: 12, at: T0 + 5 } });
    expect(team(run)).toHaveLength(0);
    run = setStatus(run, "skye", "box", undefined, T0);
    expect(run.mons[0].death).toBeUndefined();
    run = removeMon(run, "skye", T0);
    expect(run.areas.r1).toBeUndefined();
  });
});

describe("the dupes clause", () => {
  it("marks a family already caught, the fallen too, and nothing else", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "T", now: T0 });
    run = logCatch(run, { area: "route-1", mon: "16", kind: "wild" }, T0, "skye").run;
    expect(dupeOf(run, view, "16")?.id).toBe("skye");
    expect(dupeOf(run, view, "17")?.id).toBe("skye"); // Pidgeotto: Pidgey's line
    expect(dupeOf(run, view, "18")?.id).toBe("skye");
    expect(dupeOf(run, view, "19")).toBeNull(); // Rattata
    run = evolve(run, "skye", "17", T0);
    expect(dupeOf(run, view, "16")?.id).toBe("skye");
    run = setStatus(run, "skye", "dead", {}, T0);
    expect(dupeOf(run, view, "16")?.status).toBe("dead");
    // Zubat, Golbat and Crobat are one family; Oddish's line takes Bellossom.
    run = logCatch(run, { area: "mt-moon", mon: "41", kind: "wild" }, T0, "zu").run;
    expect(dupeOf(run, view, "169")?.id).toBe("zu");
    run = logCatch(run, { area: "route-24", mon: "182", kind: "wild" }, T0, "bell").run;
    expect(dupeOf(run, view, "43")?.id).toBe("bell");
    // A failed encounter isn't a catch.
    run = logFailed(run, "route-22", "56", T0);
    expect(dupeOf(run, view, "56")).toBeNull();
  });

  it("treats regional forms as their species' family, and prefers one still alive", () => {
    const v = buildView(game(7, [{ species: 19, form: "rattata-alola" }, { species: 19 }, { species: 20 }]));
    let run = createRun({ game: v.id, version: "a", name: "T", now: T0 });
    run = logCatch(run, { area: "here", mon: "19", kind: "wild" }, T0, "a").run;
    run = logCatch(run, { area: "there", mon: "20", kind: "wild" }, T0, "b").run;
    run = setStatus(run, "a", "dead", {}, T0);
    expect(dupeOf(run, v, "rattata-alola")?.id).toBe("b");
  });
});

describe("bosses, badges and the level cap", () => {
  it("is the first boss not yet beaten, in story order", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "T", now: T0 });
    const steps = (await loadGame(view.id))!.steps;
    const keys = bossKeys(steps);
    const bosses = steps.flatMap((s) => (s.type === "boss" ? [s.boss] : []));
    const gyms = keys.filter((_, i) => bosses[i].badge);
    expect(gyms.slice(0, 8)).toEqual(["brock", "misty", "lt-surge", "erika", "koga", "sabrina", "blaine", "giovanni"]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(levelCap(run, view)).toMatchObject({ cap: 14, boss: { key: "brock", name: "Brock" } });
    run = toggleBoss(run, "misty", T0); // beaten out of order: Brock is still next
    expect(levelCap(run, view)?.cap).toBe(14);
    run = toggleBoss(run, "brock", T0);
    expect(levelCap(run, view)).toMatchObject({ cap: 24, boss: { key: "lt-surge" } });
    for (const k of keys) if (!run.beaten.includes(k)) run = toggleBoss(run, k, T0);
    expect(levelCap(run, view)).toBeNull();
  });

  it("takes a version's own cap, and passes over bosses without one", () => {
    const steps: NuzStep[] = [
      { type: "boss", boss: { name: "Unsourced" } },
      { type: "boss", boss: { name: "Gym", badge: "Rock Badge", cap: 12, capByVersion: { b: 13 } } },
      { type: "boss", boss: { name: "Champion", badge: "Champion", cap: 60 } },
    ];
    const v = buildView(game(3, [], steps));
    expect(levelCap({ beaten: [], version: "a" }, v)).toMatchObject({ cap: 12, boss: { name: "Gym" } });
    expect(levelCap({ beaten: [], version: "b" }, v)?.cap).toBe(13);
    expect(levelCap({ beaten: ["gym"], version: "b" }, v)?.cap).toBe(60);
  });


  it("counts a version's own bosses in that version only (Sword's Bea, Shield's Allister)", async () => {
    const v = buildView((await loadGame("sword-shield"))!);
    const sword = createRun({ game: v.id, version: "sword", name: "T", now: T0 });
    const shield = createRun({ game: v.id, version: "shield", name: "T", now: T0 });
    expect(badgeTotal(v, "sword")).toBe(8);
    expect(badgeTotal(v, "shield")).toBe(8);
    const afterKabu = (r: Run) => ["milo", "nessa", "kabu"].reduce((x, k) => toggleBoss(x, k, T0), r);
    expect(levelCap(afterKabu(sword), v)).toMatchObject({ cap: 36, boss: { name: "Bea" } });
    expect(levelCap(afterKabu(shield), v)).toMatchObject({ cap: 36, boss: { name: "Allister" } });
    let r = afterKabu(shield);
    r = addBadge(r, v, T0).run;
    expect(r.beaten).toContain("allister");
    expect(r.beaten).not.toContain("bea");
    expect(badgeCount(r, v)).toBe(4);
  });

  it("says where a run stands: the next boss and its cap, then done", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "T", now: T0 });
    expect(standing(run, view)).toMatchObject({ next: { name: "Brock" }, cap: 14 });
    expect(standing({ ...run, rules: { ...run.rules, caps: false } }, view)).toEqual({ next: expect.objectContaining({ name: "Brock" }) });
    for (const k of bossKeys((await loadGame(view.id))!.steps)) run = toggleBoss(run, k, T0);
    expect(standing(run, view)).toBe("done");
    expect(standing(run, buildView(game(3, [])))).toBeNull();
  });

  it("counts gym badges from the bosses beaten (a title isn't a badge)", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "T", now: T0 });
    const first = addBadge(run, view, T0);
    expect(first.boss?.name).toBe("Brock");
    run = first.run;
    run = addBadge(run, view, T0).run;
    expect(run.beaten).toEqual(["brock", "misty"]);
    expect(badgeCount(run, view)).toBe(2);
    run = toggleBoss(run, "elite-four-lorelei", T0); // not a badge
    expect(badgeCount(run, view)).toBe(2);
    const off = removeBadge(run, view, T0);
    expect(off.boss?.name).toBe("Misty");
    expect(badgeCount(off.run, view)).toBe(1);
    const v = buildView(game(3, [], [{ type: "boss", boss: { name: "Champion", badge: "Champion" } }]));
    expect(badgeCount(addBadge(createRun({ game: "x", version: "a", name: "T" }), v).run, v)).toBe(1); // counted by hand
  });
});

/** A run with a bit of everything, for the round trips. */
function busyRun(view: GameView): Run {
  let run = createRun({ game: view.id, version: "leafgreen", name: "Blaze “Run” é", rules: { ...DEFAULT_RULES, gifts: false, caps: false }, now: T0, id: "run1" });
  run = logCatch(run, { area: "pallet-town", mon: "4", kind: "gift", nickname: "Ember", level: 5 }, T0, "c1").run;
  run = logCatch(run, { area: "route-1", mon: "16", kind: "wild", nickname: "Skye" }, T0, "c2").run;
  run = logCatch(run, { area: "viridian-forest", mon: "25", kind: "wild", shiny: true }, T0, "c3").run;
  run = logFailed(run, "route-22", "56", T0);
  run = skipArea(run, "viridian-city", T0);
  run = evolve(run, "c2", "17", T0);
  run = setStatus(run, "c3", "dead", { by: 74, byText: "", area: "boss:brock", level: 11 }, T0 + 60_000);
  run = toggleBoss(run, "brock", T0);
  return { ...run, updatedAt: T0 + 120_000 };
}

describe("story battles and the level cap", () => {
  // In story order: a totem (no badge), a rival, an optional battle, a kahuna (no badge), then each version's own gym.
  const steps: NuzStep[] = [
    { type: "boss", boss: { name: "Totem Gumshoos", cap: 12 } },
    { type: "boss", boss: { name: "Rival Hau", cap: 14, kind: "story" } },
    { type: "boss", boss: { name: "Trial Captain Ilima", cap: 13, kind: "story", optional: true } },
    { type: "boss", boss: { name: "Kahuna Hala", cap: 15 } },
    { type: "boss", boss: { name: "Bea", badge: "Fighting Badge", cap: 36, versions: ["a"] } },
    { type: "boss", boss: { name: "Allister", badge: "Ghost Badge", cap: 36, versions: ["b"] } },
  ];
  const v = buildView(game(7, [], steps));
  const run = (version: string, storyCaps: boolean, beaten: string[] = []) => ({ ...createRun({ game: "x", version, name: "T", now: T0, rules: { ...DEFAULT_RULES, storyCaps } }), beaten });

  it("leaves rivals out of the cap by default, and says they come first", () => {
    expect(DEFAULT_RULES.storyCaps).toBe(false);
    expect(levelCap(run("a", false), v)).toMatchObject({ cap: 12, boss: { name: "Totem Gumshoos" } });
    const r = run("a", false, ["totem-gumshoos"]);
    expect(levelCap(r, v)).toMatchObject({ cap: 15, boss: { name: "Kahuna Hala" } });
    expect(storyBefore(r, v)).toMatchObject({ boss: { name: "Rival Hau" }, top: 14 });
    expect(standing(r, v)).toMatchObject({ next: { name: "Kahuna Hala" }, cap: 15 });
  });

  it("caps at a rival with the rule on, but never at an optional battle", () => {
    const r = run("a", true, ["totem-gumshoos"]);
    expect(levelCap(r, v)).toMatchObject({ cap: 14, boss: { name: "Rival Hau" } });
    expect(storyBefore(r, v)).toBeNull();
    const after = run("a", true, ["totem-gumshoos", "rival-hau"]);
    expect(levelCap(after, v)).toMatchObject({ cap: 15, boss: { name: "Kahuna Hala" } });
    expect(storyBefore(after, v)).toMatchObject({ boss: { name: "Trial Captain Ilima", optional: true } });
    expect(setsCap({ name: "x", kind: "story", optional: true }, { storyCaps: true })).toBe(false);
    expect(setsCap({ name: "x", optional: true }, { storyCaps: true })).toBe(false);
  });

  it("takes each version's own gym, and counts badges from gyms only", () => {
    const done = ["totem-gumshoos", "rival-hau", "kahuna-hala"];
    expect(levelCap(run("a", false, done), v)).toMatchObject({ boss: { name: "Bea" } });
    expect(levelCap(run("b", false, done), v)).toMatchObject({ boss: { name: "Allister" } });
    expect(badgeTotal(v, "a")).toBe(1);
    expect(badgeTotal(v, "b")).toBe(1);
    expect(badgeCount(run("b", false, done), v)).toBe(0); // a totem, a rival and a kahuna aren't badges
    expect(badgeCount(run("b", false, [...done, "allister"]), v)).toBe(1);
  });

  it("is done when every boss that sets the cap is beaten, rivals or not", () => {
    expect(standing(run("b", false, ["totem-gumshoos", "kahuna-hala", "allister"]), v)).toBe("done");
    expect(standing(run("b", true, ["totem-gumshoos", "kahuna-hala", "allister"]), v)).toMatchObject({ next: { name: "Rival Hau" } });
  });
});

describe("saving", () => {
  it("round-trips runs through storage, several at once", async () => {
    const view = await frlgView();
    const storage = new MemoryStorage();
    const a = busyRun(view);
    const b = createRun({ game: view.id, version: "firered", name: "Second", now: T0 + 1, id: "run2" });
    expect(saveRun(a, storage)).toBe(true);
    expect(saveRun(b, storage)).toBe(true);
    const store = loadStore(storage);
    expect(store.runs.run1).toEqual(a);
    expect(store.runs.run2).toEqual(b);
    expect(listRuns(store).map((r) => r.id)).toEqual(["run1", "run2"]);
    expect(JSON.parse(storage.getItem(STORE_KEY)!).v).toBe(1);
    deleteRun("run1", storage);
    expect(Object.keys(loadStore(storage).runs)).toEqual(["run2"]);
  });

  it("survives a broken or blocked storage", () => {
    const broken = new MemoryStorage();
    broken.setItem(STORE_KEY, "{not json");
    expect(loadStore(broken).runs).toEqual({});
    const blocked = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(saveRun(createRun({ game: "x", version: "a", name: "T" }), blocked)).toBe(false);
    expect(loadStore(null).runs).toEqual({});
    expect(sanitizeRun({ v: 1, id: "x" })).toBeNull();
    const repaired = sanitizeRun({ v: 1, id: "x", game: "g", version: "a", name: 7, mons: [{ id: "m", area: "r", met: "16", status: "lost" }, "junk"], areas: { r: { kind: "caught", mon: "gone" } } })!;
    expect(repaired.mons).toEqual([{ id: "m", area: "r", met: "16", mon: "16", nickname: "", status: "box", caughtAt: expect.any(Number) }]);
    expect(repaired.areas).toEqual({});
  });

  it("exports a backup file and imports it back", async () => {
    const run = busyRun(await frlgView());
    expect(importRun(exportRun(run))).toEqual(run);
    expect(importRun('{"kind":"something-else"}')).toBeNull();
    expect(importRun("nope")).toBeNull();
    expect(backupName(run, new Date(2026, 10, 28))).toBe("pokeiq-nuzlocke-blaze-run-e-2026-11-28.json");
  });
});

describe("share links", () => {
  it("round-trip a run, read-only", async () => {
    const run = busyRun(await frlgView());
    const raw = encodeRun(run);
    expect(raw).toMatch(/^[A-Za-z0-9+\-$_]+$/);
    const back = decodeRun(raw)!;
    // Ids are the link's own, and times are kept to the second.
    const ids = new Map(run.mons.map((m, i) => [m.id, back.mons[i].id]));
    const norm = (r: Run, map?: Map<string, string>) => ({
      ...r,
      id: "",
      mons: r.mons.map((m) => ({ ...m, id: map?.get(m.id) ?? m.id, caughtAt: 0 })),
      areas: Object.fromEntries(Object.entries(r.areas).map(([k, a]) => [k, a.kind === "caught" ? { ...a, mon: map?.get(a.mon) ?? a.mon } : a])),
    });
    expect(norm(back)).toEqual(norm(run, ids));
    expect(back.id).toBe("shared");
  });

  it("refuse anything they didn't write", () => {
    expect(decodeRun(null)).toBeNull();
    expect(decodeRun("garbage")).toBeNull();
    expect(decodeRun("x".repeat(30_000))).toBeNull();
  });

  it("stay short for a long run", async () => {
    const view = await frlgView();
    let run = createRun({ game: view.id, version: "firered", name: "Long", now: T0 });
    for (let i = 0; i < 80; i++) run = logCatch(run, { area: `area-${i}`, mon: String((i % 150) + 1), kind: "wild", nickname: `Mon${i}` }, T0).run;
    expect(encodeRun(run).length).toBeLessThan(4000);
  });
});
