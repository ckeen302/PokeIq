import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultMoves, moveSlug, speciesId, titleName } from "../scripts/trainers/common";
import { parseGen1Parties } from "../scripts/trainers/gen1";
import { parseGen2Parties } from "../scripts/trainers/gen2";
import { parseGen3Parties, parseScriptBlocks, gen3Section } from "../scripts/trainers/gen3";
import { headerSection } from "../scripts/trainers/platinum";
import { scriptedOpponents } from "../scripts/trainers/diamond-pearl";
import { TRAINER_GAMES } from "@/lib/trainers/games";
import { NOTABLE } from "@/lib/trainers/notable";
import { MOVES, ITEMS } from "@/lib/dex/data";
import { getPokemon } from "@/lib/pokemon/pokedex";
import type { TrainerGameFile } from "@/lib/trainers/types";

describe("trainer importer parsers", () => {
  it("resolves decomp constants", () => {
    expect(speciesId("SPECIES_NIDORAN_F")).toBe(29);
    expect(speciesId("MR_MIME")).toBe(122);
    expect(moveSlug("PSYCHIC_M")).toBe("psychic");
    expect(moveSlug("MOVE_FAINT_ATTACK")).toBe("feint-attack");
    expect(() => speciesId("SPECIES_NOT_REAL")).toThrow();
    expect(titleName("TATE&LIZA")).toBe("Tate & Liza");
  });

  it("builds the default moveset like the games (skip known, drop oldest)", () => {
    const ls = [
      { level: 1, move: "a" },
      { level: 5, move: "b" },
      { level: 5, move: "a" },
      { level: 9, move: "c" },
      { level: 13, move: "d" },
      { level: 17, move: "e" },
      { level: 30, move: "f" },
    ];
    expect(defaultMoves(4, ls)).toEqual(["a"]);
    expect(defaultMoves(17, ls)).toEqual(["b", "c", "d", "e"]);
    expect(defaultMoves(14, ls, ["x", "y"])).toEqual(["a", "b", "c", "d"]);
  });

  it("parses Gen I parties (level-for-all and $FF formats, comments)", () => {
    const { parties } = parseGen1Parties("\tdw FooData\nFooData:\n; Route 3\n\tdb 11, RATTATA, EKANS, 0\n\tdb $FF, 9, PIDGEY, 8, SQUIRTLE, 0 ; Route 22\n");
    expect(parties).toHaveLength(2);
    expect(parties[0]).toMatchObject({ no: 1, comment: "Route 3", mons: [{ level: 11, species: "RATTATA" }, { level: 11, species: "EKANS" }] });
    expect(parties[1]).toMatchObject({ special: true, inline: "Route 22", mons: [{ level: 9, species: "PIDGEY" }, { level: 8, species: "SQUIRTLE" }] });
  });

  it("parses Gen II parties with items and moves", () => {
    const p = parseGen2Parties('FalknerGroup:\n\t; FALKNER (1)\n\tdb "FALKNER@", TRAINERTYPE_ITEM_MOVES\n\tdb  9, PIDGEOTTO, KINGS_ROCK, TACKLE, MUD_SLAP, GUST, NO_MOVE\n\tdb -1 ; end\n');
    expect(p[0]).toMatchObject({ name: "FALKNER", no: 1, mons: [{ level: 9, species: "PIDGEOTTO", item: "KINGS_ROCK", moves: ["TACKLE", "MUD_SLAP", "GUST"] }] });
  });

  it("parses Gen III parties in both brace styles", () => {
    const emerald = parseGen3Parties("static const struct TrainerMonItemCustomMoves sParty_X[] = {\n {\n .iv = 100,\n .lvl = 12,\n .species = SPECIES_GEODUDE,\n .heldItem = ITEM_NONE,\n .moves = {MOVE_TACKLE, MOVE_NONE, MOVE_NONE, MOVE_NONE}\n }\n};");
    expect(emerald.get("sParty_X")).toEqual({ custom: true, mons: [{ iv: 100, level: 12, species: "SPECIES_GEODUDE", item: "ITEM_NONE", moves: ["MOVE_TACKLE"] }] });
    const ruby = parseGen3Parties("const struct TrainerMonNoItemCustomMoves gTrainerParty_Y[] = {\n {\n\t.iv = 0,\n\t.level = 24,\n\t.species = SPECIES_SANDSLASH,\n .moves = MOVE_DIG, MOVE_SLASH, MOVE_SAND_ATTACK, MOVE_POISON_STING\n }\n};");
    expect(ruby.get("gTrainerParty_Y")!.mons[0].moves).toEqual(["MOVE_DIG", "MOVE_SLASH", "MOVE_SAND_ATTACK", "MOVE_POISON_STING"]);
  });

  it("tracks Ruby/Sapphire version blocks in scripts", () => {
    const b = parseScriptBlocks("X::\n\t.ifdef SAPPHIRE\n\ttrainerbattle_single TRAINER_A, T1, T2\n\t.else\n\ttrainerbattle_single TRAINER_B, T1, T2\n\t.endif\n\ttrainerbattle_single TRAINER_C, T1, T2\n");
    expect(b.get("X")).toEqual([
      { id: "TRAINER_A", ver: "sapphire" },
      { id: "TRAINER_B", ver: "ruby" },
      { id: "TRAINER_C", ver: "both" },
    ]);
  });

  it("names map sections", () => {
    expect(gen3Section("Rustboro City", "RustboroCity_Gym")).toBe("Gym");
    expect(gen3Section("Lost Cave", "FiveIsland_LostCave_Room10")).toBe("Room 10");
    expect(gen3Section("S.S. Anne", "SSAnne_1F_Room2")).toBe("1F Room 2");
    expect(headerSection("Stark Mountain", "MAP_HEADER_STARK_MOUNTAIN_ROOM_2")).toBe("Room 2");
    expect(headerSection("Azalea Town", "MAP_AZALEA")).toBeUndefined();
  });
});

describe("committed trainer data", () => {
  const moveSlugs = new Set(MOVES.map((m) => m.slug));
  const itemSlugs = new Set(ITEMS.map((i) => i.slug));
  const notables = new Set(NOTABLE.map((n) => n.slug));
  const files = TRAINER_GAMES.map((g) => [g.key, JSON.parse(fs.readFileSync(path.join("src/data/trainers", `${g.key}.json`), "utf8")) as TrainerGameFile] as const);

  it("has every game, each file under 5 MB", () => {
    for (const g of TRAINER_GAMES) expect(fs.statSync(path.join("src/data/trainers", `${g.key}.json`)).size).toBeLessThan(5 * 1024 * 1024);
  });

  it.each(files)("%s: every team is placed, valid and linkable", (_k, f) => {
    const ids = new Set<string>();
    expect(f.teams.length).toBeGreaterThan(300);
    for (const t of f.teams) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.at.length).toBeGreaterThan(0);
      for (const s of t.at) expect(f.areas[s.a]).toBeDefined();
      expect(t.team.length).toBeGreaterThanOrEqual(1);
      expect(t.team.length).toBeLessThanOrEqual(6);
      if (t.n) expect(notables.has(t.n)).toBe(true);
      for (const m of t.team) {
        expect(getPokemon(m.s)).toBeDefined();
        expect(m.lv).toBeGreaterThanOrEqual(1);
        expect(m.lv).toBeLessThanOrEqual(100);
        expect(m.m.length).toBeLessThanOrEqual(4);
        for (const mv of m.m) expect(moveSlugs.has(mv)).toBe(true);
        if (m.i && /^[a-z0-9-]+$/.test(m.i)) expect(itemSlugs.has(m.i)).toBe(true);
      }
    }
    expect(new Set(f.areas.map((a) => a.slug)).size).toBe(f.areas.length);
  });

  it("matches known teams", () => {
    const get = (g: string, id: string) => files.find(([k]) => k === g)![1].teams.find((t) => t.id === id)!;
    // Red/Blue Brock: Onix gets Bide from the gym-leader move table.
    expect(get("red-blue", "BROCK-1").team.map((m) => [m.s, m.lv, m.m])).toEqual([
      [74, 12, ["tackle", "defense-curl"]],
      [95, 14, ["tackle", "screech", "bide"]],
    ]);
    expect(get("crystal", "FALKNER-FALKNER1").team[1]).toMatchObject({ s: 17, lv: 9, m: ["tackle", "mud-slap", "gust"] });
    expect(get("heartgold-soulsilver", "PKMN_TRAINER_RED_RED").team[0]).toMatchObject({ s: 25, lv: 88, i: "light-ball" });
    expect(get("emerald", "ROXANNE_2").tag).toBe("Rematch 1");
    // Diamond & Pearl: Cynthia's original team, Fantina found in her (headerless) script file.
    expect(get("diamond-pearl", "CHAMPION_CYNTHIA").team.map((m) => [m.s, m.lv])).toEqual([[442, 61], [407, 60], [423, 60], [448, 63], [350, 63], [445, 66]]);
    expect(get("diamond-pearl", "LEADER_FANTINA_FANTINA").team.map((m) => m.s)).toEqual([426, 94, 429]);
  });

  it("finds Diamond & Pearl scripted battles only before a battle-result check", () => {
    const buf = (...h: number[]) => Buffer.from(Uint16Array.from(h).buffer);
    const all = () => true;
    expect(scriptedOpponents(buf(0x00e5, 246, 0, 0x00ec), all).ids).toEqual([246]);
    expect(scriptedOpponents(buf(0x0042, 0x00e5, 0x0042, 0x01e4, 0x0043), all).ids).toEqual([]);
  });

  it("gives every notable at least one team", () => {
    const used = new Set(files.flatMap(([, f]) => f.teams.map((t) => t.n)));
    for (const n of NOTABLE) expect(used.has(n.slug), n.slug).toBe(true);
  });
});
