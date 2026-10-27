import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultMoves, moveSlug, speciesId, titleName } from "../scripts/trainers/common";
import { parseGen1Parties } from "../scripts/trainers/gen1";
import { parseGen2Parties } from "../scripts/trainers/gen2";
import { parseGen3Parties, parseScriptBlocks, gen3Section } from "../scripts/trainers/gen3";
import { headerSection } from "../scripts/trainers/platinum";
import { scriptedOpponents } from "../scripts/trainers/diamond-pearl";
import { areaName, headInfo, pageTrainers } from "../scripts/trainers/wiki-import";
import { firstValue, parseTemplate, plain, splitPipes } from "../scripts/trainers/wiki-parse";
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

  /** Sane team counts per game (Sword & Shield and Sun & Moon simply have few trainers). */
  const COUNT: Record<string, [number, number]> = {
    "black-white": [420, 650],
    "black-2-white-2": [600, 850],
    "x-y": [380, 600],
    "omega-ruby-alpha-sapphire": [650, 950],
    "sun-moon": [300, 450],
    "ultra-sun-ultra-moon": [380, 550],
    "lets-go-pikachu-eevee": [450, 650],
    "sword-shield": [200, 350],
    "brilliant-diamond-shining-pearl": [580, 800],
    "scarlet-violet": [420, 650],
  };

  it.each(files)("%s: every team is placed, valid and linkable", (k, f) => {
    const ids = new Set<string>();
    const [lo, hi] = COUNT[k] ?? [300, 1000];
    expect(f.teams.length).toBeGreaterThan(lo);
    expect(f.teams.length).toBeLessThan(hi);
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

describe("Bulbapedia importer (Gen V–IX)", () => {
  it("splits template parameters like MediaWiki and reads display text", () => {
    expect(splitPipes("a|{{tt|1|2}}|[[Link|Label]]|b=c")).toEqual(["a", "{{tt|1|2}}", "[[Link|Label]]", "b=c"]);
    const t = parseTemplate("{{Trainerentry|Spr.png|game=9|Youngster|Elian|220|1|0917|Tarountula|♂|5|None|36=ユウト}}");
    expect(t.name).toBe("Trainerentry");
    expect(t.pos.slice(1, 10)).toEqual(["Youngster", "Elian", "220", "1", "0917", "Tarountula", "♂", "5", "None"]);
    expect(t.named).toMatchObject({ game: "9", "36": "ユウト" });
    expect(plain("{{PK}}{{MN}} Trainer")).toBe("Pokémon Trainer");
    expect(plain("{{color2|000|Calem (game)|Calem}}")).toBe("Calem");
    expect(plain("{{Colorlink|N|000}}")).toBe("N");
    expect(plain("{{game|Black and White|s}}")).toBe("Black and White");
    expect(plain("{{B2W2}}")).toBe("Black 2 and White 2");
    expect(firstValue("{{tt|21|19 in Easy Mode, 23 in Challenge Mode}}")).toBe("21");
  });

  it("reads section headings and captions as games and versions", () => {
    expect(headInfo("Pokémon Black 2 and White 2").games).toEqual(["black-2-white-2"]);
    expect(headInfo("Black and White").games).toEqual(["black-white"]);
    expect(headInfo("Pokémon Omega Ruby")).toEqual({ games: ["omega-ruby-alpha-sapphire"], ver: "omega-ruby" });
    expect(headInfo("Ultra Moon")).toEqual({ games: ["ultra-sun-ultra-moon"], ver: "ultra-moon" });
    expect(headInfo("Generation VII").games).toContain("lets-go-pikachu-eevee");
    expect(headInfo("Pokémon Emerald").games).toEqual(["old"]);
    expect(headInfo("1F").games).toBeNull();
    expect(areaName("Unova Route 4")).toBe("Route 4");
    expect(areaName("Pokémon League (Paldea)")).toBe("Pokémon League");
    expect(areaName("Victory Road (Black 2 and White 2)")).toBe("Victory Road");
  });

  it("parses a page: parties, rows, version splits, rematches, partners", () => {
    const page = [
      "==Trainers==",
      "===Pokémon Black 2 and White 2===",
      "{{trainerheader|sand}}",
      "{{trainerdiv|sand|Black 2}}",
      "{{trainerentry|Spr B2W2 Policeman.png|Policeman|Braven|{{tt|640|560}}|2|058|Growlithe|♂|{{tt|16|14 in Easy Mode}}||507|Herdier|♂|16|Oran Berry|36=x}}",
      "{{trainerdiv|sand|Rematch}}",
      "{{trainerentry|Spr B2W2 Policeman.png|Policeman|Braven|900|1|059|Arcanine|♂|40|None}}",
      "{{trainerfooter|sand|5}}",
      "{{Steven}} will work as the player's partner here.",
      "{{Party\n| sprite = E Steven Back.png\n| class = {{PK}}{{MN}} Trainer\n| name = {{color2|000|Steven}}\n| game = B2W2\n| pokemon = 1\n}}",
      "{{Pokémon\n| ndex = 0376\n| pokemon = Metagross\n| level = 42\n| move1 = Meteor Mash\n}}",
      "{{Party/end}}",
      "{{Party\n| caption = {{PlayerChoice|0495|Snivy}}\n| class = {{PK}}{{MN}} Trainer\n| name = {{color2|000|Hugh}}\n| game = B2W2\n| pokemon = 1\n}}",
      "{{Pokémon\n| ndex = 0498\n| pokemon = Tepig\n| level = 5\n| held = Oran Berry\n| ability = Blaze\n| move1 = Tackle\n| move2 = Tail Whip\n}}",
      "{{Party/end}}",
      "===Pokémon Emerald===",
      "{{trainerentry|Spr RS Lass.png|Lass|Old|100|1|263|Zigzagoon|♀|5|None}}",
      "==In animation==",
      "{{Party\n| name = Anime\n| game = BW\n| pokemon = 1\n}}",
    ].join("\n");
    const rows = pageTrainers("Unova Route 4", page);
    expect(rows.map((r) => [r.cls, r.name, r.ver, r.tag])).toEqual([
      ["Policeman", "Braven", "black-2", undefined],
      ["Policeman", "Braven", "black-2", "Rematch"],
      ["Pokémon Trainer", "Hugh", undefined, "If you chose Snivy"],
    ]);
    expect(rows[0].team).toEqual([
      { s: 58, lv: 16, m: [] },
      { s: 507, lv: 16, m: [], i: "oran-berry" },
    ]);
    expect(rows[2].team).toEqual([{ s: 498, lv: 5, m: ["tackle", "tail-whip"], i: "oran-berry", ab: "Blaze" }]);
    expect(rows[2].games).toEqual(["black-2-white-2"]);
  });
});

describe("Gen V–IX trainer data", () => {
  const wikiGames = TRAINER_GAMES.filter((g) => g.gen >= 5);
  const load = (k: string) => JSON.parse(fs.readFileSync(path.join("src/data/trainers", `${k}.json`), "utf8")) as TrainerGameFile;

  it("covers the ten requested games and nothing from Legends", () => {
    expect(wikiGames.map((g) => g.key)).toEqual([
      "black-white",
      "black-2-white-2",
      "x-y",
      "omega-ruby-alpha-sapphire",
      "sun-moon",
      "ultra-sun-ultra-moon",
      "lets-go-pikachu-eevee",
      "sword-shield",
      "brilliant-diamond-shining-pearl",
      "scarlet-violet",
    ]);
    expect(TRAINER_GAMES.some((g) => /legends/.test(g.key))).toBe(false);
  });

  it.each(wikiGames.map((g) => [g.key, g] as const))("%s: versions, Tera types and DLC regions are consistent", (k, g) => {
    const f = load(k);
    const types = new Set(["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy", "Stellar"]);
    for (const t of f.teams) {
      for (const v of t.ver ?? []) expect(g.versions).toContain(v);
      for (const m of t.team) if (m.tt) expect(types.has(m.tt), m.tt).toBe(true);
      if (k !== "scarlet-violet") expect(t.team.some((m) => m.tt)).toBe(false);
    }
    for (const a of f.areas) expect(g.regions).toContain(a.region);
    // Every region the game covers has trainers (DLC areas included).
    for (const r of g.regions) expect(f.teams.some((t) => t.at.some((s) => f.areas[s.a].region === r)), `${k} ${r}`).toBe(true);
  });

  it("links every Gen V–IX Gym Leader, Elite Four member and kahuna to a team that fits their type", () => {
    const typesOf = (s: number) => getPokemon(s)!.types.map((x) => x.toLowerCase());
    let checked = 0;
    for (const g of wikiGames) {
      const f = load(g.key);
      for (const t of f.teams) {
        const n = t.n ? NOTABLE.find((x) => x.slug === t.n) : undefined;
        if (!n?.type || !/^((Gym )?Leader|Elite Four|BB League Elite Four|Captain|Island Kahuna)$/.test(t.cls)) continue;
        // Larry is Normal in his Gym and Flying in the Elite Four.
        const want = n.slug === "larry" && t.cls === "Elite Four" ? "flying" : n.type.toLowerCase();
        expect(t.team.some((m) => typesOf(m.s).includes(want) || m.tt?.toLowerCase() === want), `${g.key} ${t.id} ${n.type}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("has the headline battles of each game", () => {
    const has = (k: string, slug: string) => load(k).teams.some((t) => t.n === slug);
    const expectations: Record<string, string[]> = {
      "black-white": ["cilan", "lenora", "burgh", "elesa", "clay", "skyla", "brycen", "drayden", "iris", "shauntal", "grimsley", "caitlin", "marshal", "alder", "cheren", "bianca", "n", "ghetsis", "cynthia"],
      "black-2-white-2": ["cheren", "roxie", "burgh", "elesa", "clay", "skyla", "drayden", "marlon", "iris", "hugh", "colress", "ghetsis", "n", "alder", "cynthia"],
      "x-y": ["viola", "grant", "korrina", "ramos", "clemont", "valerie", "olympia", "wulfric", "malva", "siebold", "wikstrom", "drasna", "diantha", "shauna", "tierno", "trevor", "calem", "serena", "lysandre"],
      "omega-ruby-alpha-sapphire": ["roxanne", "brawly", "wattson", "flannery", "norman", "winona", "tate-and-liza", "wallace", "sidney", "phoebe", "glacia", "drake", "steven", "may", "brendan", "wally", "maxie", "archie", "zinnia"],
      "sun-moon": ["ilima", "lana", "kiawe", "mallow", "hala", "olivia", "nanu", "hapu", "acerola", "kahili", "kukui", "hau", "gladion", "guzma", "lusamine", "plumeria"],
      "ultra-sun-ultra-moon": ["ilima", "lana", "kiawe", "mallow", "sophocles", "hala", "olivia", "nanu", "hapu", "molayne", "kahili", "acerola", "kukui", "hau", "gladion", "guzma", "giovanni", "ghetsis", "lysandre", "cyrus", "maxie", "archie"],
      "lets-go-pikachu-eevee": ["brock", "misty", "lt-surge", "erika", "koga", "sabrina", "blaine", "giovanni", "lorelei", "bruno", "agatha", "lance", "trace", "blue", "red", "archer"],
      "sword-shield": ["milo", "nessa", "kabu", "bea", "allister", "opal", "gordie", "melony", "piers", "raihan", "leon", "hop", "bede", "marnie", "rose", "mustard", "klara", "avery", "peony"],
      "brilliant-diamond-shining-pearl": ["roark", "gardenia", "maylene", "crasher-wake", "fantina", "byron", "candice", "volkner", "aaron", "bertha", "flint", "lucian", "cynthia", "barry", "cyrus", "mars", "jupiter", "saturn"],
      "scarlet-violet": ["katy", "brassius", "iono", "kofu", "larry", "ryme", "tulip", "grusha", "rika", "poppy", "hassel", "geeta", "nemona", "arven", "penny", "giacomo", "mela", "atticus", "ortega", "eri", "carmine", "kieran", "lacey", "crispin", "amarys", "drayton"],
    };
    for (const [k, slugs] of Object.entries(expectations)) for (const s of slugs) expect(has(k, s), `${k}: ${s}`).toBe(true);
  });

  it("drops partners who fight beside the player", () => {
    const steven = load("omega-ruby-alpha-sapphire").teams.filter((t) => t.n === "steven");
    expect(steven.length).toBeGreaterThan(0);
    expect(steven.every((t) => t.cls === "Champion")).toBe(true);
  });

  it("keeps the teams Serebii agrees on (verified fixture)", () => {
    const fixture = JSON.parse(fs.readFileSync("tests/fixtures/trainers-verified.json", "utf8")) as {
      games: Record<string, { summary: { matched: number; levelsAgree: number }; verified: { id: string; n?: string; team: [number, number][]; moves?: string[][] }[] }>;
    };
    for (const g of wikiGames) {
      const entry = fixture.games[g.key];
      expect(entry, g.key).toBeDefined();
      const byId = new Map(load(g.key).teams.map((t) => [t.id, t]));
      // At least 10 route trainers and a set of notable battles per game, all still as verified.
      expect(entry.verified.filter((v) => !v.n).length, g.key).toBeGreaterThanOrEqual(10);
      expect(entry.verified.filter((v) => v.n).length, g.key).toBeGreaterThanOrEqual(8);
      for (const v of entry.verified) {
        const t = byId.get(v.id);
        expect(t, `${g.key} ${v.id}`).toBeDefined();
        expect(t!.team.map((m) => [m.s, m.lv]), `${g.key} ${v.id}`).toEqual(v.team);
        if (v.moves) expect(t!.team.map((m) => m.m), `${g.key} ${v.id}`).toEqual(v.moves);
      }
      // Levels agree with the second source for the vast majority of matched teams.
      expect(entry.summary.levelsAgree / entry.summary.matched, g.key).toBeGreaterThan(0.8);
    }
  });
});
