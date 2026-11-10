import { describe, expect, it } from "vitest";
import { Battle, Teams, type PokemonSet, type PRNGSeed } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { Generations } from "@smogon/calc";
import { chooseCpu, seededRandom } from "@/lib/battle/cpu-policy";
import { calcName, cpuRequest, pointlessMove } from "@/lib/battle/cpu-policy-legacy";
import { completeSet } from "@/lib/battle/sets";
import { GUEST_TRAINER, type BattleRequest, type CpuLevel } from "@/lib/battle/play";
import { isCleanName } from "@/lib/name-filter";

Teams.setGeneratorFactory(TeamGenerators);

const LEVELS: CpuLevel[] = ["easy", "normal", "hard"];

/** A singles battle from two sets lists, past team preview, with the first Pokémon of each side out. */
function position(p1: Partial<PokemonSet>[], p2: Partial<PokemonSet>[], formatid = "gen9customgame"): Battle {
  const fill = (sets: Partial<PokemonSet>[]) => Teams.pack(sets.map((s) => completeSet({ level: 100, ...s } as never)) as PokemonSet[]);
  const battle = new Battle({ formatid: formatid as never, seed: "1,2,3,4" as PRNGSeed });
  battle.setPlayer("p1", { name: "CPU", team: fill(p1) });
  battle.setPlayer("p2", { name: "Player", team: fill(p2) });
  for (const side of battle.sides) {
    const request = side.activeRequest as unknown as BattleRequest | null;
    if (request?.teamPreview) battle.choose(side.id, "team 1");
  }
  return battle;
}

const throwOn = (err: unknown) => {
  throw err;
};

describe("the computer never makes a choice the simulator refuses", () => {
  // Dugtrio's Arena Trap isn't shown yet, so the request only says "maybe trapped": a player finds out by trying to switch.
  const trappedBattle = () =>
    position(
      [
        { species: "Pikachu", ability: "Static", moves: ["Nuzzle", "Volt Switch", "Thunderbolt", "Surf"] },
        { species: "Gyarados", ability: "Intimidate", moves: ["Waterfall"] },
      ],
      [{ species: "Dugtrio", ability: "Arena Trap", moves: ["Earthquake"] }]
    );

  it("reads a hidden trap as a trap", () => {
    const battle = trappedBattle();
    const raw = battle.p1.activeRequest as unknown as BattleRequest;
    expect(raw.active![0].maybeTrapped).toBe(true);
    expect(raw.active![0].trapped).toBeFalsy();
    const seen = cpuRequest(battle.p1)!;
    expect(seen.active![0].trapped).toBe(true);
    expect(seen.active![0].maybeTrapped).toBeUndefined();
    // The player's own request is untouched.
    expect((battle.p1.activeRequest as unknown as BattleRequest).active![0].maybeTrapped).toBe(true);
  });

  it.each(LEVELS)("%s never tries to switch out of Arena Trap", (level) => {
    for (let i = 0; i < 12; i++) {
      const battle = trappedBattle();
      const choice = chooseCpu(battle, battle.p1, level, seededRandom(`trap:${level}:${i}`), throwOn);
      expect(choice, `try ${i}`).toMatch(/^move /);
      expect(battle.p1.choose(choice), `try ${i}: ${choice}`).toBe(true);
    }
  });

  it("leaves a maybe-trapped Pokémon free to switch when nothing traps it", () => {
    // Shadow Tag against Shadow Tag traps nobody, but an unrevealed one still shows as "maybe trapped".
    const battle = position(
      [
        { species: "Gothitelle", ability: "Shadow Tag", moves: ["Psychic"] },
        { species: "Gyarados", ability: "Intimidate", moves: ["Waterfall"] },
      ],
      [{ species: "Gothitelle", ability: "Shadow Tag", moves: ["Psychic"] }]
    );
    const seen = cpuRequest(battle.p1)!;
    expect(seen.active![0].maybeTrapped).toBeUndefined();
    expect(seen.active![0].trapped).toBeFalsy();
  });
});

describe("the computer's damage model knows every Pokémon", () => {
  it("names Aegislash as the calculator does, in every generation it's in", () => {
    for (const gen of [6, 7, 8, 9] as const) {
      const battle = position([{ species: "Aegislash", ability: "Stance Change", moves: ["Shadow Sneak"] }], [{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"] }], `gen${gen}customgame`);
      const name = calcName(Generations.get(gen), battle.p1.active[0]);
      expect(Generations.get(gen).species.get(name.toLowerCase().replace(/[^a-z0-9]/g, "") as never), `gen ${gen}`).toBeTruthy();
    }
  });

  it.each(["normal", "hard"] as CpuLevel[])("%s thinks with an Aegislash on either side without falling back", (level) => {
    const sets: Partial<PokemonSet>[] = [
      { species: "Aegislash", ability: "Stance Change", item: "Leftovers", moves: ["Shadow Sneak", "Iron Head", "King's Shield", "Swords Dance"] },
      { species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Dragon Claw"] },
    ];
    for (const formatid of ["gen6customgame", "gen9customgame"]) {
      const mine = position(sets, [{ species: "Gyarados", ability: "Intimidate", moves: ["Waterfall", "Crunch"] }], formatid);
      expect(() => chooseCpu(mine, mine.p1, level, seededRandom("aegis:1"), throwOn), formatid).not.toThrow();
      const theirs = position([{ species: "Gyarados", ability: "Intimidate", moves: ["Waterfall", "Crunch"] }], sets, formatid);
      expect(() => chooseCpu(theirs, theirs.p1, level, seededRandom("aegis:2"), throwOn), formatid).not.toThrow();
    }
  });
});

describe("the computer doesn't waste a turn on a move that plainly does nothing", () => {
  const moves = (battle: Battle) => (cpuRequest(battle.p1)!.active![0].moves ?? []).filter((m) => !m.disabled).map((m) => m.id);

  it("an attack into a type immunity, spread moves included", () => {
    const battle = position([{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Dragon Claw", "Thunder Wave", "Stone Edge"] }], [{ species: "Salamence", ability: "Intimidate", moves: ["Dragon Claw"] }]);
    expect(pointlessMove(battle, battle.p1.active[0], battle.p2.active[0], "earthquake")).toBe(true);
    expect(pointlessMove(battle, battle.p1.active[0], battle.p2.active[0], "stoneedge")).toBe(false);
    expect(moves(battle)).not.toContain("earthquake");
    for (const level of LEVELS) {
      for (let i = 0; i < 8; i++) {
        const choice = chooseCpu(battle, battle.p1, level, seededRandom(`immune:${level}:${i}`), throwOn);
        expect(choice, `${level} ${i}`).not.toMatch(/^move 1\b/);
      }
    }
  });

  it("Thunder Wave on a Ground type, or on a Pokémon that already has a status", () => {
    const ground = position([{ species: "Pikachu", ability: "Static", moves: ["Thunder Wave", "Surf"] }], [{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake"] }]);
    expect(moves(ground)).toEqual(["surf"]);
    const burned = position([{ species: "Pikachu", ability: "Static", moves: ["Thunder Wave", "Toxic", "Surf"] }], [{ species: "Gyarados", ability: "Intimidate", moves: ["Waterfall"] }]);
    expect(moves(burned)).toContain("thunderwave");
    burned.p2.active[0].setStatus("brn");
    expect(moves(burned)).toEqual(["surf"]);
  });

  it("Stealth Rock that's already up, a boost at +6, recovery at full HP", () => {
    const battle = position([{ species: "Garchomp", ability: "Rough Skin", moves: ["Stealth Rock", "Swords Dance", "Dragon Claw"] }], [{ species: "Gyarados", ability: "Intimidate", moves: ["Waterfall"] }]);
    expect(moves(battle)).toEqual(["stealthrock", "swordsdance", "dragonclaw"]);
    battle.p2.addSideCondition("stealthrock", battle.p1.active[0]);
    battle.p1.active[0].setBoost({ atk: 6 });
    expect(moves(battle)).toEqual(["dragonclaw"]);
    const healer = position([{ species: "Blissey", ability: "Natural Cure", moves: ["Soft-Boiled", "Seismic Toss"] }], [{ species: "Gyarados", ability: "Intimidate", moves: ["Waterfall"] }]);
    expect(moves(healer)).toEqual(["seismictoss"]);
    healer.p1.active[0].sethp(10);
    expect(moves(healer)).toEqual(["softboiled", "seismictoss"]);
  });

  it("never goes by an ability the foe hasn't shown, and never leaves no move at all", () => {
    // Levitate isn't visible from the types: Earthquake stays on the table.
    const levitate = position([{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Dragon Claw"] }], [{ species: "Rotom", ability: "Levitate", moves: ["Thunderbolt"] }]);
    expect(moves(levitate)).toContain("earthquake");
    // Both moves do nothing: the request is left as it is rather than emptied.
    const stuck = position([{ species: "Garchomp", ability: "Rough Skin", moves: ["Earthquake", "Bulldoze"] }], [{ species: "Salamence", ability: "Intimidate", moves: ["Dragon Claw"] }]);
    expect(moves(stuck)).toEqual(["earthquake", "bulldoze"]);
    expect(stuck.p1.choose(chooseCpu(stuck, stuck.p1, "hard", seededRandom("stuck"), throwOn))).toBe(true);
  });
});

describe("a first battle against the computer needs no name", () => {
  it("the stand-in name passes the name rules", () => {
    expect(isCleanName(GUEST_TRAINER)).toBe(true);
    expect(GUEST_TRAINER.length).toBeLessThanOrEqual(24);
  });
});
