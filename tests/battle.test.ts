import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";
import * as adaptable from "@smogon/calc/dist/adaptable";
import * as smogon from "@smogon/calc";
import { exportShowdown, importShowdown, packTeam, unpackTeam, type TeamSet } from "@/lib/battle/sets";
import { calcMoves, emptyField, emptySide, sideFromSet, type CalcSide } from "@/lib/battle/calc";
import { spriteCandidates } from "@/lib/battle/sprites";
import { checkTeam, randomTeam } from "@/lib/server/battle";
import { POST as validateRoute } from "@/app/api/battle/validate/route";

// teams.ts persists to localStorage; give the node test env an in-memory one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

async function freshTeams() {
  vi.resetModules();
  return import("@/lib/battle/teams");
}

/** A Gen 9 OU team exactly as Showdown's teambuilder exports it. */
const OU_TEAM = [
  "Garchomp @ Rocky Helmet  ",
  "Ability: Rough Skin  ",
  "Tera Type: Steel  ",
  "EVs: 252 HP / 4 Def / 252 Spe  ",
  "Jolly Nature  ",
  "- Stealth Rock  ",
  "- Earthquake  ",
  "- Dragon Tail  ",
  "- Spikes  ",
  "",
  "Great Tusk @ Booster Energy  ",
  "Ability: Protosynthesis  ",
  "Tera Type: Ground  ",
  "EVs: 252 Atk / 4 SpD / 252 Spe  ",
  "Jolly Nature  ",
  "- Headlong Rush  ",
  "- Ice Spinner  ",
  "- Rapid Spin  ",
  "- Knock Off  ",
  "",
  "Gholdengo @ Choice Scarf  ",
  "Ability: Good as Gold  ",
  "Tera Type: Steel  ",
  "EVs: 252 SpA / 4 SpD / 252 Spe  ",
  "Timid Nature  ",
  "IVs: 0 Atk  ",
  "- Make It Rain  ",
  "- Shadow Ball  ",
  "- Trick  ",
  "- Focus Blast  ",
  "",
  "Kingambit @ Leftovers  ",
  "Ability: Supreme Overlord  ",
  "Tera Type: Dark  ",
  "EVs: 252 HP / 252 Atk / 4 SpD  ",
  "Adamant Nature  ",
  "- Swords Dance  ",
  "- Kowtow Cleave  ",
  "- Sucker Punch  ",
  "- Iron Head  ",
  "",
  "Pult (Dragapult) (M) @ Choice Specs  ",
  "Ability: Infiltrator  ",
  "Shiny: Yes  ",
  "Tera Type: Ghost  ",
  "EVs: 252 SpA / 4 SpD / 252 Spe  ",
  "Timid Nature  ",
  "- Draco Meteor  ",
  "- Shadow Ball  ",
  "- Flamethrower  ",
  "- U-turn  ",
  "",
  "Toxapex (F) @ Black Sludge  ",
  "Ability: Regenerator  ",
  "Tera Type: Fairy  ",
  "EVs: 252 HP / 252 Def / 4 SpD  ",
  "Bold Nature  ",
  "IVs: 0 Atk  ",
  "- Toxic Spikes  ",
  "- Recover  ",
  "- Haze  ",
  "- Surf  ",
  "",
  "",
].join("\n");

const ouSets = () => importShowdown(OU_TEAM)!.sets;

describe("Showdown import / export", () => {
  it("round-trips Showdown's export text exactly", () => {
    const imported = importShowdown(OU_TEAM)!;
    expect(imported.sets).toHaveLength(6);
    expect(imported.dropped).toBe(0);
    expect(exportShowdown(imported.sets)).toBe(OU_TEAM);
  });

  it("round-trips sets through text and the packed format", () => {
    const sets = ouSets();
    expect(importShowdown(exportShowdown(sets))!.sets).toEqual(sets);
    expect(unpackTeam(packTeam(sets), Dex)).toEqual(sets);
    expect(sets[4]).toMatchObject({ name: "Pult", species: "Dragapult", gender: "M", shiny: true, teraType: "Ghost" });
    expect(sets[2].ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  it("keeps fields the builder doesn't edit, and reads a team header", () => {
    const text = [
      "=== [gen4ou] Classic ===",
      "",
      "Chompy (Garchomp) (F) @ Life Orb",
      "Ability: Sand Veil",
      "Level: 50",
      "Happiness: 0",
      "Pokeball: Poke Ball",
      "EVs: 252 Atk / 252 Spe",
      "Adamant Nature",
      "IVs: 30 Atk / 30 SpA / 30 Spe",
      "- Hidden Power [Fire]",
      "- Frustration",
    ].join("\r\n");
    const imported = importShowdown(text)!;
    expect(imported).toMatchObject({ name: "Classic", format: "gen4ou" });
    const [set] = imported.sets;
    expect(set).toMatchObject({ level: 50, happiness: 0, pokeball: "Poke Ball", moves: ["Hidden Power Fire", "Frustration"] });
    // Pasted without Showdown's trailing spaces, it comes out canonical and then stays put.
    const canonical = exportShowdown(imported.sets);
    expect(canonical).toContain("- Hidden Power [Fire]  \n");
    expect(exportShowdown(importShowdown(canonical)!.sets)).toBe(canonical);
  });

  it("rejects text with no Pokémon and caps a team at six", () => {
    expect(importShowdown("")).toBeNull();
    expect(importShowdown("hello world")).toBeNull();
    const seven = OU_TEAM + "Pikachu  \nAbility: Static  \n- Thunderbolt  \n\n";
    expect(importShowdown(seven)).toMatchObject({ dropped: 1 });
    expect(importShowdown(seven)!.sets).toHaveLength(6);
  });
});

describe("team storage", () => {
  beforeEach(() => store.clear());

  it("saves, reloads, duplicates and deletes teams", async () => {
    let teams = await freshTeams();
    const team = teams.createTeam("gen9ou", "Sand Offense", ouSets());
    expect(teams.getTeams()).toHaveLength(1);

    // A fresh page load reads the same team back from localStorage.
    teams = await freshTeams();
    expect(teams.getTeam(team.id)).toEqual(team);

    const renamed = teams.saveTeam({ ...team, name: "Sand Balance" });
    expect(renamed.updatedAt).toBeGreaterThan(team.updatedAt);
    const copy = teams.duplicateTeam(team.id)!;
    expect(copy.id).not.toBe(team.id);
    expect(copy).toMatchObject({ name: "Sand Balance (copy)", format: "gen9ou", sets: team.sets });
    // Newest first.
    expect(teams.getTeams().map((t) => t.id)).toEqual([copy.id, team.id]);

    expect(unpackTeam(teams.packedTeam(team.id)!, Dex)).toEqual(team.sets);
    teams.deleteTeam(team.id);
    expect(teams.getTeams().map((t) => t.id)).toEqual([copy.id]);
  });

  it("lists teams by format and hands a battle exact Showdown text", async () => {
    const teams = await freshTeams();
    const ou = teams.createTeam("gen9ou", "Sand Offense", ouSets());
    teams.createTeam("gen3ou", "Classic");
    teams.createTeam("gen9ou", "Empty");
    expect(teams.listTeams().map((t) => t.name)).toEqual(["Empty", "Classic", "Sand Offense"]);
    expect(teams.listTeams("gen9ou").map((t) => t.name)).toEqual(["Empty", "Sand Offense"]);
    expect(teams.listTeams("gen9uu")).toEqual([]);

    const text = teams.teamShowdownText(ou.id)!;
    expect(text).toBe(OU_TEAM);
    // What the battle engine does with it: read it back and validate it on Showdown's rules.
    expect(checkTeam("gen9ou", importShowdown(text)!.sets).ok).toBe(true);
    expect(teams.teamShowdownText("missing")).toBeNull();
  });

  it("notifies listeners on every change", async () => {
    const teams = await freshTeams();
    const seen: number[] = [];
    const stop = teams.onTeamsChange((list) => seen.push(list.length));
    teams.createTeam("gen9uu");
    teams.createTeam("gen3ou");
    stop();
    teams.createTeam("gen4ou");
    expect(seen).toEqual([1, 2]);
  });

  it("drops malformed teams and sets from storage", async () => {
    const good = { id: "a", name: "Good", format: "gen9ou", sets: ouSets(), createdAt: 1, updatedAt: 2 };
    store.set(
      "pokeiq:battle-teams:v1",
      JSON.stringify({
        v: 1,
        teams: [
          { ...good, sets: [...good.sets.slice(0, 2), { species: "" }, { nope: true }] },
          { ...good, id: "b", format: "gen1ou" },
          { id: "c" },
          "garbage",
        ],
      })
    );
    const teams = await freshTeams();
    expect(teams.getTeams()).toHaveLength(1);
    expect(teams.getTeams()[0].sets).toEqual(good.sets.slice(0, 2));

    store.set("pokeiq:battle-teams:v1", "{not json");
    expect((await freshTeams()).getTeams()).toEqual([]);
  });
});

describe("team validation", () => {
  it("passes a legal OU team", () => {
    expect(checkTeam("gen9ou", ouSets())).toEqual({ ok: true, team: [], sets: [[], [], [], [], [], []] });
  });

  it("puts each problem on its slot, and team-wide ones on the team", () => {
    const sets = ouSets();
    sets[0].moves[0] = "Moonblast";
    sets[1].ability = "Levitate";
    sets[3] = { ...sets[2] };
    const check = checkTeam("gen9ou", sets);
    expect(check.ok).toBe(false);
    expect(check.sets[0]).toEqual(["Garchomp can't learn Moonblast."]);
    expect(check.sets[1]).toEqual(["Great Tusk can't have Levitate."]);
    expect(check.sets[2]).toEqual([]);
    expect(check.team.join(" ")).toMatch(/Species Clause/);
  });

  it("knows each format's rules", () => {
    const sets = ouSets();
    // Koraidon is Ubers: banned in OU, fine in Ubers.
    sets[0] = { ...sets[0], species: "Koraidon", ability: "Orichalcum Pulse", moves: ["Collision Course", "Flare Blitz"], teraType: "Fire" };
    expect(checkTeam("gen9ou", sets).sets[0].join(" ")).toMatch(/Koraidon/);
    expect(checkTeam("gen9ubers", sets).ok).toBe(true);
    // No Tera in Gen 4, and no Gholdengo either.
    expect(checkTeam("gen4ou", ouSets()).ok).toBe(false);
  });

  it("is what the team builder's API route answers", async () => {
    const sets = ouSets();
    sets[2].evs.hp = 252;
    const request = new NextRequest("http://localhost/api/battle/validate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ format: "gen9ou", sets }),
    });
    const res = await validateRoute(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.sets[2]).toEqual(["Gholdengo has 760 total EVs, which is more than this format's limit of 510."]);

    const bad = new NextRequest("http://localhost/api/battle/validate", {
      method: "POST",
      body: JSON.stringify({ format: "gen9madeup", sets }),
    });
    expect((await validateRoute(bad)).status).toBe(400);
  });

  it("deals random teams that are legal in the format", { timeout: 30_000 }, () => {
    for (const format of ["gen9ou", "gen9vgc2025regi", "gen4ou"] as const) {
      const team = randomTeam(format);
      expect(team).toHaveLength(6);
      expect(checkTeam(format, team)).toMatchObject({ ok: true });
      expect(team.every((s) => s.level === (format === "gen9vgc2025regi" ? 50 : 100))).toBe(true);
      // Move names, not ids.
      expect(team.flatMap((s) => s.moves).every((m) => /[A-Z]/.test(m))).toBe(true);
    }
  });
});

describe("damage calc", () => {
  const gens = new Generations(Dex);
  const calc = (gen = 9) => ({ gen: gens.get(gen), lib: adaptable });
  const side = (species: string, opts: Partial<CalcSide>): CalcSide => ({ ...emptySide(species), ...opts });
  const chomp = side("Garchomp", { nature: "Jolly", evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, moves: ["Earthquake", "Dragon Claw", "Swords Dance"] });
  const tran = side("Heatran", { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 } });

  it("gets the standard Garchomp Earthquake vs Heatran range", () => {
    const [eq, claw, sd] = calcMoves(calc(), chomp, tran, emptyField());
    // 359 Atk vs 248 Def into 386 HP: 104-123 base, ×1.5 STAB, ×4 effectiveness.
    expect(eq).toMatchObject({ move: "Earthquake", damage: [624, 736], ko: "guaranteed OHKO" });
    expect(eq.percent[0]).toBeCloseTo(161.66, 1);
    expect(eq.desc).toBe("252 Atk Garchomp Earthquake vs. 252 HP / 0 Def Heatran: 624-736 (161.6 - 190.6%) -- guaranteed OHKO");
    expect(eq.rolls).toHaveLength(16);
    // Steel resists Dragon: 99 base, ×1.5 STAB, ×0.5.
    expect(claw.desc).toBe("252 Atk Garchomp Dragon Claw vs. 252 HP / 0 Def Heatran: 63-74 (16.3 - 19.1%) -- possible 6HKO");
    expect(sd).toMatchObject({ category: "Status", damage: [0, 0], ko: "" });
  });

  it("applies the field: spread, screens, Helping Hand, crits and hazards", () => {
    const field = { ...emptyField(), gameType: "Doubles" as const };
    const helped = { ...chomp, flags: { isHelpingHand: true } };
    const screened = { ...tran, flags: { isReflect: true, isSR: true } };
    const [spread] = calcMoves(calc(), helped, screened, field);
    expect(spread.desc).toMatch(/Helping Hand Earthquake vs\. 252 HP \/ 0 Def Heatran through Reflect/);
    expect(spread.damage[1]).toBeLessThan(736);
    const [crit] = calcMoves(calc(), chomp, tran, { ...emptyField(), crit: true });
    expect(crit.desc).toMatch(/on a critical hit/);
    expect(crit.damage[0]).toBeGreaterThan(624);
    const weakened = calcMoves(calc(), { ...chomp, moves: ["Dragon Claw"] }, { ...tran, flags: { isSR: true }, hpPercent: 50 }, emptyField());
    expect(weakened[0].ko).toMatch(/after Stealth Rock/);
  });

  it("matches @smogon/calc on its own data, across generations", () => {
    const cases: [number, string, string, string, Record<string, unknown>, Record<string, unknown>][] = [
      [9, "Gholdengo", "Kingambit", "Make It Rain", { nature: "Timid", evs: { spa: 252 }, item: "Choice Specs" }, { evs: { hp: 252, atk: 252 } }],
      [9, "Dragapult", "Toxapex", "Draco Meteor", { nature: "Timid", evs: { spa: 252 }, teraType: "Dragon" }, { nature: "Bold", evs: { hp: 252, def: 252 } }],
      [4, "Garchomp", "Heatran", "Earthquake", { nature: "Adamant", evs: { atk: 252 } }, { nature: "Calm", evs: { hp: 252 } }],
      [3, "Metagross", "Skarmory", "Meteor Mash", { nature: "Adamant", evs: { atk: 252 } }, { nature: "Impish", evs: { hp: 252, def: 252 } }],
    ];
    for (const [num, a, d, move, aOpts, dOpts] of cases) {
      const ours = adaptable.calculate(
        gens.get(num) as never,
        new adaptable.Pokemon(gens.get(num) as never, a, aOpts),
        new adaptable.Pokemon(gens.get(num) as never, d, dOpts),
        new adaptable.Move(gens.get(num) as never, move)
      );
      const g = smogon.Generations.get(num as 9);
      const theirs = smogon.calculate(g, new smogon.Pokemon(g, a, aOpts), new smogon.Pokemon(g, d, dOpts), new smogon.Move(g, move));
      expect(ours.desc()).toBe(theirs.desc());
    }
  });

  it("loads a saved set into a calc side", () => {
    const pult = ouSets()[4];
    expect(sideFromSet(pult)).toMatchObject({
      species: "Dragapult",
      nature: "Timid",
      item: "Choice Specs",
      teraType: "Ghost",
      terastallized: false,
      moves: ["Draco Meteor", "Shadow Ball", "Flamethrower", "U-turn"],
      hpPercent: 100,
    });
  });
});

describe("sprites", () => {
  it("uses PokéAPI ids for forms and skips missing animated sprites", () => {
    expect(spriteCandidates({ id: "rotomwash", num: 479 })[0]).toMatch(/other\/showdown\/10009\.gif$/);
    // Ogerpon's masks have no animated sprite: straight to the static one, then the base species.
    expect(spriteCandidates({ id: "ogerponwellspring", num: 1017 })).toEqual([
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10273.png",
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/1017.png",
    ]);
    const shiny = spriteCandidates({ id: "garchomp", num: 445 }, true);
    expect(shiny[0]).toMatch(/showdown\/shiny\/445\.gif$/);
    expect(shiny.at(-1)).toMatch(/\/445\.png$/);
  });
});

// Keep the TeamSet import honest for the type checker.
export type { TeamSet };
