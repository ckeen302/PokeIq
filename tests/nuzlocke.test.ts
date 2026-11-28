import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import DETAILS from "@/data/pokedex-details.json";
import type { NuzEncounter, NuzGame, NuzStep } from "@/lib/nuzlocke/model";
import { NUZ_GAMES, loadGame } from "@/lib/nuzlocke/games";
import { buildView, formFor, generation, specieFor } from "@/lib/nuzlocke/view.server";
import { allAreas, bossKeys, type GameView } from "@/lib/nuzlocke/view";
import { availableGames, gameSummaries, gameView } from "@/lib/nuzlocke/games.server";
import { groupByMethod } from "@/lib/nuzlocke/group";
import { matchupSummary, multiplier, teamMatchups } from "@/lib/nuzlocke/matchups";
import {
  DEFAULT_RULES,
  addBadge,
  badgeCount,
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
  skipArea,
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
  it("reads the dev fixture only until the real data lands", () => {
    // Once nuzlocke-data is merged, games.ts exists and the fixture must be gone (source.ts re-exports ./games).
    if (existsSync("src/lib/nuzlocke/games.ts")) expect(existsSync("src/lib/nuzlocke/dev-fixture.ts")).toBe(false);
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
    const keys = bossKeys((await loadGame(view.id))!.steps);
    expect(keys.slice(0, 8)).toEqual(["brock", "misty", "lt-surge", "erika", "koga", "sabrina", "blaine", "giovanni"]);
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
