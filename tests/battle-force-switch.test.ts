import { describe, expect, it } from "vitest";
import { Teams } from "pokemon-showdown";
import { SimSession } from "@/lib/server/battle-engine/engine";
import type { BattleRequest, BattleRequestPokemon } from "@/lib/battle/play";
import { emptiedSlots, fillPasses, slotPasses, switchOptions } from "@/components/battle/play/choice";

/**
 * Doubles switch-ins after a faint (the Controls' choice builder): every
 * forceSwitch combination has to come out as a choice the simulator takes,
 * passing the spots nobody is left to fill ("switch 3, pass").
 */

const mon = (name: string, opts: { active?: boolean; fnt?: boolean; reviving?: boolean } = {}): BattleRequestPokemon => ({
  ident: `p1: ${name}`,
  details: `${name}, L50`,
  condition: opts.fnt ? "0 fnt" : "100/100",
  active: !!opts.active,
  stats: { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
  moves: ["tackle"],
  baseAbility: "pressure",
  item: "",
  pokeball: "pokeball",
  ...(opts.reviving ? { reviving: true } : {}),
});

const req = (forceSwitch: boolean[], pokemon: BattleRequestPokemon[]): BattleRequest => ({ forceSwitch, side: { name: "Red", id: "p1", pokemon } });

/** What the Controls send: for each slot that asks, the first Pokémon it may send in (a click on the grid). */
function clickThrough(request: BattleRequest): string {
  let parts = fillPasses(request, []);
  while (parts.length < (request.forceSwitch?.length ?? 0)) {
    const options = switchOptions(request, parts.length, parts);
    expect(options.length, `slot ${parts.length} asks with nothing to pick`).toBeGreaterThan(0);
    parts = fillPasses(request, [...parts, `switch ${options[0]}`]);
  }
  return parts.join(", ");
}

describe("forced switches in doubles", () => {
  it("both fainted, one left on the bench: it comes in, the other spot passes", () => {
    // Recorded from Random Doubles: Pikachu and Eevee down, only Snorlax left.
    const r = req([true, true], [mon("Pikachu", { active: true, fnt: true }), mon("Eevee", { active: true, fnt: true }), mon("Snorlax"), mon("Mew", { fnt: true })]);
    expect(slotPasses(r, 0, [])).toBe(false);
    expect(switchOptions(r, 0, [])).toEqual([3]);
    expect(emptiedSlots(r, [])).toEqual([1]);
    expect(fillPasses(r, ["switch 3"])).toEqual(["switch 3", "pass"]);
    expect(clickThrough(r)).toBe("switch 3, pass");
  });

  it("both fainted, two left: each spot gets one, and the second can't pick the first's", () => {
    const r = req([true, true], [mon("Pikachu", { active: true, fnt: true }), mon("Eevee", { active: true, fnt: true }), mon("Snorlax"), mon("Mew")]);
    expect(emptiedSlots(r, [])).toEqual([]);
    expect(switchOptions(r, 1, ["switch 3"])).toEqual([4]);
    expect(clickThrough(r)).toBe("switch 3, switch 4");
  });

  it("one fainted (either side), one on the bench", () => {
    const left = req([true, false], [mon("Pikachu", { active: true, fnt: true }), mon("Eevee", { active: true }), mon("Snorlax")]);
    expect(clickThrough(left)).toBe("switch 3, pass");
    const right = req([false, true], [mon("Pikachu", { active: true }), mon("Eevee", { active: true, fnt: true }), mon("Snorlax")]);
    expect(fillPasses(right, [])).toEqual(["pass"]);
    expect(clickThrough(right)).toBe("pass, switch 3");
  });

  it("nobody left on the bench at all: every spot passes without asking", () => {
    const r = req([true, true], [mon("Pikachu", { active: true, fnt: true }), mon("Eevee", { active: true, fnt: true }), mon("Snorlax", { fnt: true })]);
    expect(fillPasses(r, [])).toEqual(["pass", "pass"]);
  });

  it("Revival Blessing picks among the fainted", () => {
    const r = req([true, false], [mon("Pawmot", { active: true, reviving: true }), mon("Eevee", { active: true }), mon("Snorlax", { fnt: true }), mon("Mew")]);
    expect(switchOptions(r, 0, [])).toEqual([3]);
    expect(clickThrough(r)).toBe("switch 3, pass");
  });

  it("singles: one slot, send one out", () => {
    const r = req([true], [mon("Pikachu", { active: true, fnt: true }), mon("Snorlax", { fnt: true }), mon("Mew")]);
    expect(clickThrough(r)).toBe("switch 3");
  });

  it("the simulator takes the choice when both fall at once with one left (and every forced switch after)", () => {
    const team = (text: string) => Teams.pack(Teams.import(text));
    // Three level-1 Magikarp against two Garchomp with Earthquake: both Magikarp on the field go down each turn.
    const red = team(["Magikarp|||SwiftSwim|Splash||||||1|", "Magikarp|||SwiftSwim|Splash||||||1|", "Magikarp|||SwiftSwim|Splash||||||1|"].join("]"));
    const blue = team(["Garchomp|||RoughSkin|Earthquake,Rock Slide||||||100|", "Garchomp|||RoughSkin|Earthquake,Rock Slide||||||100|"].join("]"));
    const session = SimSession.create({ formatid: "gen9doublescustomgame", seed: "1,2,3,4", p1: { name: "Red", team: red }, p2: { name: "Blue", team: blue } });
    const seen: string[] = [];
    for (let i = 0; i < 12 && !session.ended; i++) {
      for (const side of ["p1", "p2"] as const) {
        const r = session.pending(side);
        if (!r || r.wait) continue;
        let choice: string;
        if (r.teamPreview) choice = "default";
        else if (side === "p2") choice = r.forceSwitch ? "pass" : r.active!.map((_, s) => (r.side.pokemon[s].condition.endsWith(" fnt") ? "pass" : "move 1")).join(", ");
        else if (r.forceSwitch) {
          choice = clickThrough(r);
          seen.push(`${JSON.stringify(r.forceSwitch)} → ${choice}`);
        } else choice = r.active!.map((_, s) => (r.side.pokemon[s].condition.endsWith(" fnt") ? "pass" : "move 1")).join(", ");
        expect(session.choose(side, choice), `${side}: ${choice}`).toEqual({ ok: true });
      }
    }
    expect(seen).toContain("[true,true] → switch 3, pass");
    expect(session.ended).toBe(true);
  });
});
