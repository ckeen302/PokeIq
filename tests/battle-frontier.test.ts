import { describe, expect, it } from "vitest";
import { Dex, Teams } from "pokemon-showdown";
import { afterBattle, bestOf, frontierCpuLevel, frontierStage, isBoss, swapTeam } from "@/lib/battle/frontier";
import { nextRunBattle, readRun, runResult, signRun, startFactoryRun, swapRun, type FrontierRun } from "@/lib/server/battle-engine/frontier";
import { actOnBattle, battleToken, createMatchedBattle, pollBattle, readBattleToken, updateBattle } from "@/lib/server/battle-engine/service";
import { factoryTeam } from "@/lib/server/battle-engine/teams";
import { recordFrontierBest } from "@/lib/server/frontier-store";
import { loadBattle } from "@/lib/server/battle-engine/store";

const mons = (...species: string[]) => species.map((s, i) => ({ species: s, item: `Item ${i}` }));

describe("streaks", () => {
  it("counts rounds of seven, with the Tycoon closing every Tower round", () => {
    expect(frontierStage(0)).toEqual({ round: 1, battle: 1 });
    expect(frontierStage(6)).toEqual({ round: 1, battle: 7 });
    expect(frontierStage(7)).toEqual({ round: 2, battle: 1 });
    expect(isBoss("tower", 6)).toBe(true);
    expect(isBoss("tower", 13)).toBe(true);
    expect(isBoss("tower", 7)).toBe(false);
    expect(isBoss("factory", 6)).toBe(false);
  });

  it("makes the computer stronger as the streak grows", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => frontierCpuLevel("factory", s))).toEqual(["easy", "easy", "normal", "normal", "normal", "hard", "hard"]);
    expect(frontierCpuLevel("factory", 7)).toBe("normal");
    expect(frontierCpuLevel("factory", 11)).toBe("hard");
    expect(frontierCpuLevel("tower", 6)).toBe("hard");
  });

  it("grows on a win and ends where it stood on a loss; the best is the better one", () => {
    expect(afterBattle(3, true)).toEqual({ streak: 4, over: false });
    expect(afterBattle(3, false)).toEqual({ streak: 3, over: true });
    expect(bestOf(5, 3)).toBe(5);
    expect(bestOf(null, 2)).toBe(2);
  });

  it("keeps a signed-in trainer's best (in memory without the database)", async () => {
    expect(await recordFrontierBest("u1", "factory", 4)).toBe(4);
    expect(await recordFrontierBest("u1", "factory", 2)).toBe(4);
    expect(await recordFrontierBest("u1", "tower", 1)).toBe(1);
  });
});

describe("the Factory swap", () => {
  it("trades one of yours for one of theirs", () => {
    const out = swapTeam(mons("Garchomp", "Rotom-Wash", "Clefable"), mons("Gholdengo", "Kingambit", "Dragapult"), 0, 2);
    expect(out.ok && out.team.map((m) => m.species)).toEqual(["Dragapult", "Rotom-Wash", "Clefable"]);
  });

  it("keeps Species Clause, by base species", () => {
    const base = (s: string) => s.split("-")[0];
    expect(swapTeam(mons("Garchomp", "Rotom-Wash"), mons("Rotom-Heat"), 0, 0, { base }).ok).toBe(false);
    // Swapping a Pokémon for another of the same species is fine.
    expect(swapTeam(mons("Garchomp", "Rotom-Wash"), mons("Rotom-Heat"), 1, 0, { base }).ok).toBe(true);
  });

  it("keeps Item Clause in BSS", () => {
    const mine = [{ species: "A", item: "Leftovers" }, { species: "B", item: "Choice Scarf" }];
    const theirs = [{ species: "C", item: "Leftovers" }];
    expect(swapTeam(mine, theirs, 1, 0, { itemClause: true }).ok).toBe(false);
    expect(swapTeam(mine, theirs, 1, 0).ok).toBe(true);
    expect(swapTeam(mine, theirs, 0, 0, { itemClause: true }).ok).toBe(true);
  });

  it("refuses picks that aren't there", () => {
    expect(swapTeam(mons("A"), mons("B"), 3, 0).ok).toBe(false);
    expect(swapTeam(mons("A"), mons("B"), 0, -1).ok).toBe(false);
  });
});

describe("a Factory run", () => {
  it("deals Showdown's Factory sets for both styles", () => {
    expect(factoryTeam("open", "OU", "1,2,3,4")).toHaveLength(6);
    const bss = factoryTeam("bss", "", "1,2,3,5");
    expect(bss).toHaveLength(6);
    expect(bss.every((s) => s.level === 50)).toBe(true);
  });

  it("plays a battle, offers the beaten team after a win, swaps, and can't replay a battle", async () => {
    const started = startFactoryRun("Red", "open");
    if (!started.ok) throw new Error(started.error);
    expect(started.run.team).toHaveLength(6);
    expect(started.run.streak).toBe(0);
    expect(started.run.next.level).toBe("easy");

    const battle = await nextRunBattle(started.run.token);
    if (!battle.ok) throw new Error(battle.error);
    // The same step can't start a second battle.
    expect((await nextRunBattle(started.run.token)).ok).toBe(false);

    // Before the end there's no result.
    expect((await runResult(battle.code, battle.token, null)).ok).toBe(false);
    // Someone else's token gets nothing.
    expect((await runResult(battle.code, "nope", null)).ok).toBe(false);

    // The computer loses.
    const ended = await updateBattle(battle.code, (work, now) => {
      const session = work.session(now)!;
      session.lose("p2");
      work.absorb(now);
      return { ok: true };
    });
    expect(ended.ok).toBe(true);

    const result = await runResult(battle.code, battle.token, "user-1");
    if (!result.ok) throw new Error(result.error);
    expect(result.won).toBe(true);
    expect(result.run.streak).toBe(1);
    expect(result.best).toBe(1);
    expect(result.run.offer).toHaveLength(6);

    // A trade that keeps Species Clause.
    const mine = result.run.team.map((m) => m.species);
    const take = result.run.offer!.findIndex((m) => !mine.includes(m.species));
    const swapped = swapRun(result.run.token, 0, take);
    if (!swapped.ok) throw new Error(swapped.error);
    expect(swapped.run.team[0].species).toBe(result.run.offer![take].species);
    expect(swapped.run.offer).toBeUndefined();
    expect(readRun(swapped.run.token)?.streak).toBe(1);

    // The next battle uses the new team.
    const second = await nextRunBattle(swapped.run.token);
    if (!second.ok) throw new Error(second.error);
    // The battle is played with the run's (swapped) team, never a generated one.
    const played = Teams.unpack((await loadBattle(second.code))!.rec.meta.seats[0].team!)!;
    expect(played.map((m) => m.species)).toEqual(swapped.run.team.map((m) => m.species));
    const polled = await pollBattle(second.code, second.token, 0);
    if (!polled.ok) throw new Error(polled.error);
    // The battle shows some forms by their base name (Greninja-Bond is "Greninja" in battle), so compare base species.
    const base = (n: string) => Dex.species.get(n).baseSpecies;
    expect(polled.view.request!.data.side.pokemon.map((p) => base(p.details.split(",")[0]))).toEqual(swapped.run.team.map((m) => base(m.species)));
    const me = readBattleToken(second.token, second.code)!;
    const forfeited = await actOnBattle(second.code, me.playerId, { action: "forfeit" }, 0);
    expect(forfeited.ok).toBe(true);
    const lost = await runResult(second.code, second.token, null);
    if (!lost.ok) throw new Error(lost.error);
    expect(lost.won).toBe(false);
    expect(lost.run.over).toBe(true);
    expect(lost.run.streak).toBe(1);
    expect((await nextRunBattle(lost.run.token)).ok).toBe(false);
  });

  it("starts a live Factory battle: both trainers rent teams from the same tier", async () => {
    const made = await createMatchedBattle("factory", [{ name: "Red" }, { name: "Blue" }]);
    expect(made).not.toBeNull();
    const red = await pollBattle(made!.code, battleToken(made!.code, made!.ids[0], 0), 0);
    if (!red.ok) throw new Error(red.error);
    expect(red.view.status).toBe("playing");
    expect(red.view.formatName).toMatch(/Battle Factory · (Uber|OU|UU|RU|NU|PU)/);
    // Team preview shows species, never the foe's sets.
    expect(red.view.log.lines.join("\n")).not.toMatch(/\|split\|/);
  });

  it("refuses a forged run", async () => {
    const started = startFactoryRun("Red", "open");
    if (!started.ok) throw new Error(started.error);
    const [body, sig] = started.run.token.split(".");
    const forged = JSON.parse(Buffer.from(body, "base64url").toString());
    forged.streak = 40;
    const token = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect((await nextRunBattle(token)).ok).toBe(false);
    expect(readRun(token)).toBeNull();
    expect(Teams.unpack(readRun(started.run.token)!.team)).toHaveLength(6);
  });

  describe("trades with Showdown's own Factory sets", () => {
    // Greninja-Bond's Factory set has 0 Attack IVs, which the standard
    // validator's event check refuses; Showdown's Factory never validates it.
    const set = (species: string, ability: string, item: string, moves: string[], ivs: Partial<Record<string, number>> = {}) => ({
      name: "", species, ability, item, moves, nature: "Timid", gender: "", level: 100,
      evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...ivs },
    });
    const greninja = set("Greninja-Bond", "Battle Bond", "Life Orb", ["Hydro Pump", "Dark Pulse", "Ice Beam", "U-turn"], { atk: 0 });
    const others = [
      set("Metagross", "Clear Body", "Choice Band", ["Meteor Mash", "Earthquake", "Bullet Punch", "Zen Headbutt"]),
      set("Garchomp", "Rough Skin", "Rocky Helmet", ["Earthquake", "Stealth Rock", "Dragon Tail", "Spikes"]),
      set("Corviknight", "Pressure", "Leftovers", ["Brave Bird", "Roost", "Defog", "U-turn"]),
      set("Clefable", "Magic Guard", "Sticky Barb", ["Moonblast", "Moonlight", "Calm Mind", "Flamethrower"]),
      set("Heatran", "Flash Fire", "Air Balloon", ["Magma Storm", "Earth Power", "Taunt", "Stealth Rock"]),
    ];
    const foe = [
      set("Clodsire", "Water Absorb", "Heavy-Duty Boots", ["Earthquake", "Recover", "Toxic", "Spikes"]),
      { ...greninja },
      set("Rotom-Wash", "Levitate", "Choice Scarf", ["Hydro Pump", "Volt Switch", "Trick", "Will-O-Wisp"]),
      set("Garchomp", "Rough Skin", "Choice Scarf", ["Earthquake", "Outrage", "Stone Edge", "Fire Fang"]),
    ];
    const won = (team: object[], offer: object[], extra: Partial<FrontierRun> = {}) =>
      signRun({ v: 1, id: `trade-${Math.random()}`, mode: "factory", style: "open", tier: "OU", name: "Red", team: Teams.pack(team as never), streak: 1, over: false, offer: Teams.pack(offer as never), ...extra });

    const playsWith = async (token: string, species: string[]) => {
      const battle = await nextRunBattle(token);
      if (!battle.ok) throw new Error(battle.error);
      const polled = await pollBattle(battle.code, battle.token, 0);
      if (!polled.ok) throw new Error(polled.error);
      expect(polled.view.status).toBe("playing");
      // Showdown shows Greninja-Bond as plain "Greninja" until Battle Bond triggers.
      const base = (s: string) => Dex.species.get(s).baseSpecies;
      expect(polled.view.request!.data.side.pokemon.map((p) => base(p.details.split(",")[0]))).toEqual(species.map(base));
      expect((await loadBattle(battle.code))!.rec.meta.seats[0].team).toBe(readRun(token)!.team);
    };

    it("keeps an event-only set the player already rented, and the next battle starts", async () => {
      const swapped = swapRun(won([greninja, ...others], foe), 1, 0);
      if (!swapped.ok) throw new Error(swapped.error);
      expect(swapped.run.team.map((m) => m.species)).toEqual(["Greninja-Bond", "Clodsire", "Garchomp", "Corviknight", "Clefable", "Heatran"]);
      await playsWith(swapped.run.token, ["Greninja-Bond", "Clodsire", "Garchomp", "Corviknight", "Clefable", "Heatran"]);
    });

    it("takes an event-only set from the beaten team, and the next battle starts", async () => {
      const swapped = swapRun(won([set("Dragapult", "Infiltrator", "Choice Specs", ["Shadow Ball", "Draco Meteor", "Flamethrower", "U-turn"]), ...others], foe), 0, 1);
      if (!swapped.ok) throw new Error(swapped.error);
      expect(swapped.run.team[0].species).toBe("Greninja-Bond");
      await playsWith(swapped.run.token, ["Greninja-Bond", "Metagross", "Garchomp", "Corviknight", "Clefable", "Heatran"]);
    });

    it("still keeps Species Clause and Item Clause", () => {
      expect(swapRun(won([greninja, ...others], foe), 0, 3).ok).toBe(false); // a second Garchomp
      const bss = (s: object) => ({ ...s, level: 50 });
      // Corviknight already holds Leftovers: a second one is refused unless it's Corviknight that goes.
      const mine = [greninja, ...others].map(bss);
      const theirs = [bss(set("Rotom-Wash", "Levitate", "Leftovers", ["Hydro Pump", "Volt Switch", "Protect", "Will-O-Wisp"]))];
      expect(swapRun(won(mine, theirs, { style: "bss", tier: undefined }), 0, 0).ok).toBe(false);
      expect(swapRun(won(mine, theirs, { style: "bss", tier: undefined }), 3, 0).ok).toBe(true);
    });

    it("refuses forged trades", () => {
      const token = won([greninja, ...others], foe);
      // A set that isn't on the beaten team.
      expect(swapRun(token, 0, foe.length).ok).toBe(false);
      // A tampered offer breaks the run's signature.
      const [body, sig] = token.split(".");
      const forged = JSON.parse(Buffer.from(body, "base64url").toString());
      forged.offer = Teams.pack([set("Koraidon", "Orichalcum Pulse", "Choice Band", ["Flare Blitz", "Close Combat", "U-turn", "Outrage"])] as never);
      expect(swapRun(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, 0, 0).ok).toBe(false);
      // No trade without a win to trade after.
      expect(swapRun(won([greninja, ...others], foe, { offer: undefined }), 0, 0).ok).toBe(false);
      expect(swapRun(won([greninja, ...others], foe, { over: true }), 0, 0).ok).toBe(false);
    });
  });
});
