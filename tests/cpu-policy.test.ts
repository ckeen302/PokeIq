import { describe, expect, it } from "vitest";
import { Battle, Teams, type PokemonSet, type PRNGSeed } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { chooseCpu, explainCpu, foeProfile, knownSet, seededRandom } from "@/lib/battle/cpu-policy";
import { chooseCpuLegacy } from "@/lib/battle/cpu-policy-legacy";
import { completeSet } from "@/lib/battle/sets";
import { defaultSetup, emptySide, labMon } from "@/lib/battle/lab/setup";
import { prepareLab, runLabBattle } from "@/lib/battle/lab/simulate";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";

Teams.setGeneratorFactory(TeamGenerators);

const team = (seed: string) => Teams.generate("gen9randombattle", { seed: seed as never }).map((s) => labMon(completeSet({ ...s, species: s.species, nature: s.nature || "" })));

/** A singles battle from two sets lists (Gen 9, no rules), past team preview, with the first Pokémon of each side out. */
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

/** The move the CPU's choice names. */
function chosenMove(battle: Battle, choice: string): string {
  const request = battle.p1.activeRequest as unknown as BattleRequest;
  const m = /^move (\d+)/.exec(choice);
  return m ? request.active![0].moves[Number(m[1]) - 1].move : choice;
}

const reveal = (battle: Battle, side: "p1" | "p2", slot: number, moves: string[]) => {
  const p = battle[side].pokemon[slot];
  for (const ms of p.moveSlots) if (moves.includes(ms.move)) ms.used = true;
};

describe("cpu policy: legal choices", () => {
  it.each(["hard", "normal"] as CpuLevel[])("%s plays whole random battles against the old policy without a refused choice", (level) => {
    const times: number[] = [];
    for (let g = 0; g < 4; g++) {
      const setup = { ...defaultSetup(), gen: 9 as const, doubles: false, sides: [{ ...emptySide(), team: team(`${g},1,2,3`) }, { ...emptySide(), team: team(`${g},4,5,6`) }] as never };
      const prep = prepareLab(setup);
      prep.formatid = "gen9randombattle";
      const { record } = runLabBattle(prep, "test", g, {
        choosers: (rands) => [
          (battle, side) => {
            const t0 = performance.now();
            const choice = chooseCpu(battle, side, level, rands[0], (err) => {
              throw err;
            });
            times.push(performance.now() - t0);
            return choice;
          },
          (battle, side) => chooseCpuLegacy(battle, side, "hard", rands[1]),
        ],
      });
      expect(record.refused, `game ${g}`).toBe(0);
      expect(record.fallbacks, `game ${g}`).toBe(0);
      expect(record.broken, `game ${g}`).toBe(false);
      expect(record.turns).toBeGreaterThan(3);
    }
    times.sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(40);
    expect(times[Math.floor(times.length / 2)], "median think time").toBeLessThan(150);
  });

  it("easy still plays (the old policy)", () => {
    const battle = position([{ species: "Pikachu", moves: ["Thunderbolt"] }], [{ species: "Garchomp", moves: ["Earthquake"] }]);
    expect(chooseCpu(battle, battle.p1, "easy", seededRandom("x"))).toBe("move 1");
  });
});

describe("cpu policy: set knowledge", () => {
  it("knows what a random-battle Pokémon can carry", () => {
    const set = knownSet("gen9randombattle", "Garchomp");
    expect(set?.moves).toContain("Earthquake");
    expect(set?.abilities).toContain("Rough Skin");
    expect(set?.level).toBeGreaterThan(60);
    expect(knownSet("gen9randombattle", "Gastrodon-East", "Gastrodon")).toEqual(knownSet("gen9randombattle", "Gastrodon"));
    expect(knownSet("gen9ou", "Garchomp")).toBeNull();
  });

  it("assumes a foe's set in a random battle, narrowed by what it has shown, and a STAB guess elsewhere", () => {
    const random = position([{ species: "Pikachu", moves: ["Thunderbolt"] }], [{ species: "Garchomp", moves: ["Earthquake", "Stone Edge", "Swords Dance", "Scale Shot"] }], "gen9randombattle");
    const unseen = foeProfile(random, random.p2.active[0]);
    expect(unseen.fromSets).toBe(true);
    expect(unseen.moves).toEqual(knownSet("gen9randombattle", "Garchomp")!.moves);
    expect(unseen.ability).toBe("Rough Skin");
    reveal(random, "p2", 0, ["Stone Edge"]);
    const shown = foeProfile(random, random.p2.active[0]);
    expect(shown.moves[0]).toBe("Stone Edge");
    expect(shown.moves.filter((m) => m === "Stone Edge")).toHaveLength(1);
    expect(shown.moves).toContain("Earthquake");

    const custom = position([{ species: "Pikachu", moves: ["Thunderbolt"] }], [{ species: "Garchomp", moves: ["Earthquake"] }]);
    const guess = foeProfile(custom, custom.p2.active[0]);
    expect(guess.fromSets).toBe(false);
    expect(guess.moves).toEqual(["Outrage", "Earthquake"]);
  });
});

describe("cpu policy: lookahead", () => {
  it("finishes a faster threat with priority instead of a stronger slower move", () => {
    const battle = position(
      [{ species: "Lucario", ability: "Inner Focus", item: "Life Orb", nature: "Adamant", evs: { atk: 252, spe: 252 } as never, moves: ["Close Combat", "Extreme Speed", "Swords Dance", "Meteor Mash"] }],
      [{ species: "Weavile", ability: "Pressure", nature: "Jolly", evs: { atk: 252, spe: 252 } as never, moves: ["Close Combat", "Knock Off", "Ice Shard", "Swords Dance"] }]
    );
    battle.p1.active[0].hp = Math.floor(battle.p1.active[0].maxhp * 0.45);
    battle.p2.active[0].hp = Math.floor(battle.p2.active[0].maxhp * 0.15);
    reveal(battle, "p2", 0, ["Close Combat"]);
    const choice = chooseCpu(battle, battle.p1, "hard", seededRandom("x"));
    expect(chosenMove(battle, choice)).toBe("Extreme Speed");
  });

  it("doesn't set up in front of a faster foe that KOs it", () => {
    const battle = position(
      [
        { species: "Dragonite", ability: "Multiscale", item: "Heavy-Duty Boots", nature: "Adamant", evs: { atk: 252, spe: 252 } as never, moves: ["Dragon Dance", "Outrage", "Earthquake", "Extreme Speed"] },
        { species: "Corviknight", ability: "Pressure", item: "Leftovers", moves: ["Brave Bird", "Roost", "U-turn", "Defog"] },
      ],
      [{ species: "Weavile", ability: "Pressure", item: "Choice Band", nature: "Jolly", evs: { atk: 252, spe: 252 } as never, moves: ["Icicle Crash", "Knock Off", "Ice Shard", "Low Kick"] }]
    );
    battle.p1.active[0].hp = Math.floor(battle.p1.active[0].maxhp * 0.55);
    reveal(battle, "p2", 0, ["Icicle Crash"]);
    const { options } = explainCpu(battle, battle.p1);
    const dd = options.find((o) => o.text.includes("Dragon Dance"))!;
    expect(options[0].text).not.toContain("Dragon Dance");
    expect(options[0].ev).toBeGreaterThan(dd.ev + 0.05);
    const choice = chooseCpu(battle, battle.p1, "hard", seededRandom("x"));
    expect(chosenMove(battle, choice)).not.toBe("Dragon Dance");
  });

  it("doesn't attack into the immune switch the player is about to make", () => {
    // Pikachu can't touch Excadrill and has shown Gyarados, so the switch is coming and Earthquake would hit nothing:
    // Iron Head KOs the weakened Pikachu just as well and still hits Gyarados.
    const battle = position(
      [{ species: "Excadrill", ability: "Sand Rush", item: "Leftovers", nature: "Adamant", evs: { atk: 252, spe: 252 } as never, moves: ["Earthquake", "Iron Head", "Rapid Spin", "Swords Dance"] }],
      [
        { species: "Pikachu", ability: "Static", item: "Light Ball", moves: ["Thunderbolt", "Volt Switch", "Nasty Plot", "Surf"] },
        { species: "Gyarados", ability: "Moxie", item: "Leftovers", nature: "Jolly", evs: { atk: 252, spe: 252 } as never, moves: ["Waterfall", "Dragon Dance", "Earthquake", "Ice Fang"] },
      ]
    );
    reveal(battle, "p2", 0, ["Thunderbolt", "Volt Switch"]);
    battle.p2.active[0].hp = Math.floor(battle.p2.active[0].maxhp * 0.4);
    // Gyarados has been in battle before (a scratch shows it).
    battle.p2.pokemon[1].hp -= 1;
    const { options, replies } = explainCpu(battle, battle.p1);
    expect(replies[0].text).toBe("switch Gyarados");
    const eq = options.find((o) => o.text === "move 1 (Earthquake)")!;
    const ih = options.find((o) => o.text === "move 2 (Iron Head)")!;
    expect(ih.ev).toBeGreaterThan(eq.ev);
    const choice = chooseCpu(battle, battle.p1, "hard", seededRandom("x"));
    expect(chosenMove(battle, choice)).not.toBe("Earthquake");
  });

  it("takes the KO on a foe about to drop rather than switching", () => {
    const battle = position(
      [
        { species: "Gallade", ability: "Sharpness", item: "Choice Scarf", nature: "Jolly", evs: { atk: 252, spe: 252 } as never, moves: ["Night Slash", "Psycho Cut", "Sacred Sword", "Leaf Blade"] },
        { species: "Qwilfish", ability: "Intimidate", moves: ["Waterfall", "Flip Turn", "Toxic Spikes", "Gunk Shot"] },
      ],
      [
        { species: "Skeledirge", ability: "Unaware", item: "Heavy-Duty Boots", moves: ["Torch Song", "Shadow Ball", "Will-O-Wisp", "Slack Off"] },
        { species: "Zekrom", ability: "Teravolt", moves: ["Bolt Strike", "Outrage", "Dragon Dance", "Roost"] },
      ]
    );
    battle.p2.active[0].hp = 14;
    battle.p2.pokemon[1].hp -= 1;
    reveal(battle, "p2", 0, ["Torch Song", "Shadow Ball"]);
    const choice = chooseCpu(battle, battle.p1, "hard", seededRandom("x"));
    expect(choice.startsWith("move")).toBe(true);
    expect(chosenMove(battle, choice)).not.toBe("Sacred Sword");
  });
});
