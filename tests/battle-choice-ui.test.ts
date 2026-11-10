import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Battle, Dex, Teams } from "pokemon-showdown";
import { Controls } from "@/components/battle/play/Controls";
import { emptySide, type Snap } from "@/components/battle/play/model";
import { choiceLine, cycleExtra, teamOrder } from "@/components/battle/play/choice";
import { gimmicksOf, isDynamaxed, moveAsUsed, type BattleRequest, type GameType } from "@/lib/battle/play";
import { moveSlotOptions, randomChoice } from "@/lib/battle/choices";
import { seededRandom } from "@/lib/battle/cpu-policy";

/** A battle in `formatid` between two teams (Showdown export text), past team preview: [battle, p1's request]. */
function battleOf(formatid: string, p1: string, p2: string): Battle {
  const battle = new Battle({ formatid: formatid as never, seed: "1,2,3,4" });
  battle.setPlayer("p1", { name: "Red", team: Teams.pack(Teams.import(p1)) });
  battle.setPlayer("p2", { name: "Blue", team: Teams.pack(Teams.import(p2)) });
  for (const side of battle.sides) if ((side.activeRequest as unknown as BattleRequest | null)?.teamPreview) battle.choose(side.id, "team 1");
  return battle;
}
const requestOf = (battle: Battle, side: "p1" | "p2" = "p1") => JSON.parse(JSON.stringify(battle[side].activeRequest)) as BattleRequest;

const snapOf = (gen: number): Snap => ({ gen, turn: 1, sides: { p1: emptySide("p1"), p2: emptySide("p2"), p3: emptySide("p3"), p4: emptySide("p4") }, weather: "", terrain: "", pseudo: [] });

function render(request: BattleRequest, gen: number, gameType: GameType = "singles", format = "gen8customgame") {
  return renderToStaticMarkup(createElement(Controls, { request, snap: snapOf(gen), me: "p1", gameType, busy: false, onChoose: () => undefined, format }));
}

const nameOf = (id: string) => {
  const m = Dex.moves.get(id);
  return { name: m.name, type: m.type };
};

const CORVIKNIGHT = `Corviknight @ Leftovers
Ability: Pressure
EVs: 252 HP / 252 Def / 4 SpD
- Brave Bird
- Body Press
- Roost
- Iron Defense`;
const SNORLAX = `Snorlax @ Leftovers
Ability: Thick Fat
- Body Slam
- Rest
- Curse
- Earthquake`;

describe("Dynamax shows and sends Max Moves", () => {
  it("offers Dynamax, and with it on the buttons are the Max Moves, aimed as those are", () => {
    const req = requestOf(battleOf("gen8customgame", CORVIKNIGHT, SNORLAX));
    const active = req.active![0];
    expect(gimmicksOf(active)).toEqual(["dynamax"]);
    expect(isDynamaxed(active)).toBe(false);
    expect(active.moves.map((_, i) => moveAsUsed(active, i, "dynamax", nameOf).move)).toEqual(["Max Airstream", "Max Knuckle", "Max Guard", "Max Guard"]);
    expect(moveAsUsed(active, 0, "dynamax", nameOf).target).toBe(active.maxMoves!.maxMoves[0].target);
    // Off, the base moves.
    expect(moveAsUsed(active, 0, null, nameOf).move).toBe("Brave Bird");
    const html = render(req, 8);
    expect(html).toContain("Dynamax");
    expect(html).toContain("Brave Bird");
  });

  it("shows the Max Moves once the Pokémon is Dynamaxed", () => {
    const battle = battleOf("gen8customgame", CORVIKNIGHT, SNORLAX);
    expect(battle.choose("p1", "move 1 dynamax")).toBe(true);
    expect(battle.choose("p2", "move 3")).toBe(true);
    const req = requestOf(battle);
    const active = req.active![0];
    expect(isDynamaxed(active)).toBe(true);
    expect(gimmicksOf(active)).toEqual([]);
    const html = render(req, 8);
    expect(html).toContain("Max Airstream");
    expect(html).toContain("Max Knuckle");
    expect(html).not.toContain("Brave Bird");
    expect(html).not.toContain("dynamax-toggle");
  });
});

describe("Z-Moves, Mega Evolution and Ultra Burst", () => {
  it("labels a Z-Move with its Z name and greys out moves without one", () => {
    const req = requestOf(
      battleOf(
        "gen7customgame",
        `Pikachu @ Electrium Z
Ability: Static
- Thunderbolt
- Quick Attack
- Iron Tail
- Grass Knot`,
        SNORLAX
      )
    );
    const active = req.active![0];
    expect(gimmicksOf(active)).toEqual(["zmove"]);
    expect(moveAsUsed(active, 0, "zmove", nameOf)).toMatchObject({ move: "Gigavolt Havoc", target: "normal" });
    expect(moveAsUsed(active, 1, "zmove", nameOf).disabled).toBe(true);
    expect(render(req, 7, "singles", "gen7customgame")).toContain("Z-Move");
  });

  it("offers Ultra Burst, and the simulator takes the choice", () => {
    const battle = battleOf(
      "gen7customgame",
      `Necrozma-Dusk-Mane @ Ultranecrozium Z
Ability: Prism Armor
- Sunsteel Strike
- Earthquake
- Swords Dance
- Photon Geyser`,
      SNORLAX
    );
    const req = requestOf(battle);
    expect(req.active![0].canUltraBurst).toBe(true);
    expect(gimmicksOf(req.active![0])).toContain("ultra");
    expect(render(req, 7, "singles", "gen7customgame")).toContain("Ultra Burst");
    expect(battle.choose("p1", "move 1 ultra")).toBe(true);
  });

  it("offers Mega Evolution", () => {
    const req = requestOf(
      battleOf(
        "gen7customgame",
        `Charizard @ Charizardite X
Ability: Blaze
- Flare Blitz
- Dragon Claw
- Earthquake
- Roost`,
        SNORLAX
      )
    );
    expect(gimmicksOf(req.active![0])).toEqual(["mega"]);
    expect(render(req, 7, "singles", "gen7customgame")).toContain("Mega Evolve");
  });
});

describe("the M hotkey and team preview", () => {
  it("cycles through none, each option, then none", () => {
    const extras = ["mega", "zmove", "dynamax"];
    const seen: (string | null)[] = [];
    let x: string | null = null;
    for (let i = 0; i < 5; i++) seen.push((x = cycleExtra(x, extras)));
    expect(seen).toEqual(["mega", "zmove", "dynamax", null, "mega"]);
    expect(cycleExtra(null, [])).toBeNull();
  });

  it("sends the whole team order, not only the lead", () => {
    expect(teamOrder([3, 1, 6, 2, 5], 6, true)).toBe("team 316254");
    expect(teamOrder([4], 6, true)).toBe("team 412356");
    // Bring 6, pick 4: only the four that battle.
    expect(teamOrder([2, 5, 1, 6], 6, false)).toBe("team 2516");
  });

  it("offers to set the whole order at team preview", () => {
    const battle = new Battle({ formatid: "gen9ou" as never, seed: "1,2,3,4" });
    const team = Teams.pack(Teams.import(`${CORVIKNIGHT}\n\n${SNORLAX}`));
    battle.setPlayer("p1", { name: "Red", team });
    battle.setPlayer("p2", { name: "Blue", team });
    const req = requestOf(battle);
    expect(req.teamPreview).toBe(true);
    const html = render(req, 9, "singles", "gen9ou");
    expect(html).toContain("order-all");
    expect(battle.choose("p1", teamOrder([2], 2, true))).toBe(true);
  });
});

describe("maybe trapped", () => {
  it("warns that a switch can't be cancelled", () => {
    const req = requestOf(battleOf("gen8customgame", `${CORVIKNIGHT}\n\n${SNORLAX}`, SNORLAX));
    req.active![0].maybeTrapped = true;
    expect(render(req, 8)).toContain("maybe-trapped");
    delete req.active![0].maybeTrapped;
    expect(render(req, 8)).not.toContain("maybe-trapped");
  });
});

describe("the timer's random choice can use gimmicks, as Showdown's random player does", () => {
  it("sometimes Dynamaxes, Z-Moves, Mega Evolves or Ultra Bursts, and every such choice is legal", () => {
    const cases: [string, string, string][] = [
      ["gen8customgame", CORVIKNIGHT, "dynamax"],
      ["gen7customgame", "Pikachu @ Electrium Z\nAbility: Static\n- Thunderbolt\n- Quick Attack", "zmove"],
      ["gen7customgame", "Charizard @ Charizardite X\nAbility: Blaze\n- Flare Blitz\n- Dragon Claw", "mega"],
      ["gen7customgame", "Necrozma-Dusk-Mane @ Ultranecrozium Z\nAbility: Prism Armor\n- Sunsteel Strike\n- Earthquake", "ultra"],
    ];
    for (const [format, team, gimmick] of cases) {
      const battle = battleOf(format, team, SNORLAX);
      const req = requestOf(battle);
      expect(moveSlotOptions(req, 0, false, { gimmicks: true }).some((o) => o.gimmick === gimmick), gimmick).toBe(true);
      // Without asking, the options are the moves as they are (what the computer's policies weigh).
      expect(moveSlotOptions(req, 0, false).some((o) => o.gimmick)).toBe(false);
      const rand = seededRandom(`gimmick:${gimmick}`);
      const picks = Array.from({ length: 60 }, () => randomChoice(req, false, rand));
      const using = picks.filter((c) => c.endsWith(` ${gimmick}`));
      expect(using.length, gimmick).toBeGreaterThan(0);
      for (const choice of new Set(picks)) {
        const fresh = battleOf(format, team, SNORLAX);
        expect(fresh.choose("p1", choice), `${format} ${choice}`).toBe(true);
      }
    }
  });

  it("uses at most one Dynamax a turn across a doubles side, aimed as the Max Move is", () => {
    const battle = battleOf("gen8doublescustomgame", `${CORVIKNIGHT}\n\n${CORVIKNIGHT}`, `${SNORLAX}\n\n${SNORLAX}`);
    const req = requestOf(battle);
    const rand = seededRandom("doubles");
    for (let i = 0; i < 40; i++) {
      const choice = randomChoice(req, true, rand);
      expect(choice.split(", ").filter((c) => c.endsWith(" dynamax")).length).toBeLessThanOrEqual(1);
      expect(battleOf("gen8doublescustomgame", `${CORVIKNIGHT}\n\n${CORVIKNIGHT}`, `${SNORLAX}\n\n${SNORLAX}`).choose("p1", choice), choice).toBe(true);
    }
  });
});

describe("the text box answers a choice at once", () => {
  const request = {
    side: { name: "Ash", id: "p1", pokemon: [{ ident: "p1: Garchomp" }, { ident: "p1: Rotom" }, { ident: "p1: Blissey" }] },
    active: [{ moves: [{ move: "Earthquake", id: "earthquake" }, { move: "Dragon Claw", id: "dragonclaw" }] }, { moves: [{ move: "Volt Switch", id: "voltswitch" }] }],
  } as unknown as BattleRequest;

  it("says what was chosen, never how the turn goes", () => {
    expect(choiceLine(request, "move 2")).toBe("Garchomp will use Dragon Claw.");
    expect(choiceLine(request, "move 1 terastallize")).toBe("Garchomp will use Earthquake.");
    expect(choiceLine(request, "switch 3")).toBe("Garchomp will switch out for Blissey.");
    expect(choiceLine(request, "move 1 1, move 1 -1")).toBe("Garchomp will use Earthquake. Rotom will use Volt Switch.");
  });

  it("a forced switch names who's coming in; team preview says nothing", () => {
    expect(choiceLine({ ...request, forceSwitch: [true], active: undefined } as BattleRequest, "switch 2")).toBe("Rotom is on the way.");
    expect(choiceLine({ ...request, teamPreview: true } as BattleRequest, "team 213")).toBe("");
    expect(choiceLine(request, "pass")).toBe("");
  });
});
