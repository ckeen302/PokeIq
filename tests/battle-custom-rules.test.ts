import { describe, expect, it } from "vitest";
import { Dex } from "pokemon-showdown";
import {
  CUSTOM_GENS,
  DEFAULT_CUSTOM_RULES,
  GIMMICK_GENS,
  customFormatId,
  customTimer,
  normalizeRules,
  ruleStrings,
  type CustomRules,
} from "@/lib/battle/custom-rules";
import { checkRules, customRandomTeam, prepareCustomTeam } from "@/lib/server/battle-engine/custom";
import { SimSession } from "@/lib/server/battle-engine/engine";
import { chooseCpu, seededRandom } from "@/lib/server/battle-engine/cpu";
import { createCpuBattle, readBattleToken, actOnBattle } from "@/lib/server/battle-engine/service";
import { firstChoice } from "@/lib/server/battle-engine/choices";
import { packTeam } from "@/lib/battle/sets";

const rules = (over: Partial<CustomRules>): CustomRules => normalizeRules({ ...DEFAULT_CUSTOM_RULES, ...over });

describe("custom rule strings", () => {
  it("builds Showdown's rules for a level-50 Gen 4 battle with Sleep Clause", () => {
    const r = rules({ gen: 4, level: 50, clauses: { species: false, sleep: true, evasion: false, ohko: false, item: false, endless: false } });
    expect(ruleStrings(r)).toEqual(["Obtainable", "Adjust Level = 50", "Sleep Clause Mod", "!! Max Team Size = 6", ]);
    expect(customFormatId(r)).toBe("gen4customgame@@@Obtainable,Adjust Level = 50,Sleep Clause Mod,!! Max Team Size = 6");
  });

  it("caps levels, turns gimmicks off only where they exist, and sets up bring N pick M", () => {
    const r = rules({ gen: 7, level: 50, levelMode: "cap", gimmicks: { tera: false, dynamax: false, mega: false, zmoves: true }, teamSize: 6, pick: 3 });
    const s = ruleStrings(r);
    expect(s).toContain("!! Max Level = 50");
    expect(s).toContain("-Mega");
    expect(s).not.toContain("Terastal Clause");
    expect(s).not.toContain("Dynamax Clause");
    expect(s).toContain("Picked Team Size = 3");
    expect(s).not.toContain("Team Preview");
    expect(ruleStrings(rules({ gen: 3, pick: 2, teamSize: 4 }))).toEqual(expect.arrayContaining(["Team Preview", "Picked Team Size = 2", "!! Max Team Size = 4"]));
    expect(ruleStrings(rules({ gen: 9, pick: null }))).toContain("!Team Preview");
  });

  it("normalizes anything into a well-formed ruleset", () => {
    const r = normalizeRules({ gen: 42, level: -3, teamSize: 9, pick: 7, timerSeconds: 5, gimmicks: "x" });
    expect(r.gen).toBe(9);
    expect(r.level).toBe(1);
    expect(r.teamSize).toBe(6);
    expect(r.pick).toBe(6);
    expect(r.timerSeconds).toBe(20);
    expect(r.gimmicks).toEqual(DEFAULT_CUSTOM_RULES.gimmicks);
    expect(customTimer(rules({ timer: false }))).toBeNull();
    expect(customTimer(rules({ timer: true, timerSeconds: 60 }))?.cap).toBe(60_000);
  });

  it("matches Showdown's data on which gens have each gimmick and team preview", () => {
    for (const gen of CUSTOM_GENS) {
      const table = Dex.formats.getRuleTable(Dex.formats.get(`gen${gen}customgame`));
      // Our rule strings add Team Preview only where the gen's Custom Game lacks it.
      expect(ruleStrings(rules({ gen, pick: 3 })).includes("Team Preview")).toBe(!table.has("teampreview"));
      const dex = Dex.forGen(gen);
      expect(GIMMICK_GENS.mega.includes(gen)).toBe(gen >= 6 && dex.items.get("Venusaurite").isNonstandard !== "Past" && gen <= 7);
      expect(GIMMICK_GENS.zmoves.includes(gen)).toBe(gen === 7);
    }
  });
});

describe("custom rules validated by Showdown, every gen", () => {
  for (const gen of CUSTOM_GENS) {
    it(`Gen ${gen}: the ruleset validates, a quick team passes, and a battle plays with the computer`, () => {
      const r = rules({ gen, level: 50, pick: gen >= 5 ? 3 : null });
      const checked = checkRules(r);
      expect(checked.ok).toBe(true);
      if (!checked.ok) return;
      const team = customRandomTeam(r);
      expect(team.length).toBe(6);
      const ok = prepareCustomTeam(r, packTeam(team));
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      const session = SimSession.create({ formatid: checked.formatid, seed: "1,2,3,4", p1: { name: "Red", team: ok.packed }, p2: { name: "Blue", team: ok.packed } });
      expect(session.battle.gen).toBe(gen);
      expect(session.battle.ruleTable.has("sleepclausemod")).toBe(true);
      for (let i = 0; i < 40 && !session.ended; i++) {
        for (const side of ["p1", "p2"] as const) {
          if (!session.pending(side)) continue;
          const choice = chooseCpu(session.battle, session.battle[side], "hard", seededRandom(`${gen}:${i}:${side}`));
          if (!session.choose(side, choice).ok) expect(session.choose(side, firstChoice(session.pending(side)!, false)).ok).toBe(true);
        }
      }
      expect(session.turn).toBeGreaterThan(3);
      // Level 50 for everyone (Adjust Level).
      expect(session.battle.p1.pokemon.every((p) => p.level === 50)).toBe(true);
    });
  }

  it("reports Showdown's own reasons for a team that breaks the rules", () => {
    const r = rules({ gen: 4, level: 50, levelMode: "cap" });
    const bad = prepareCustomTeam(r, "Garchomp @ Choice Scarf\nAbility: Sand Veil\nLevel: 100\n- Earthquake\n- Close Combat\n\nGarchomp\nAbility: Sand Veil\nLevel: 100\n- Earthquake\n");
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toMatch(/level|Evasion/i);
    expect(bad.errors.join(" ")).toMatch(/Close Combat/);
  });

  it("refuses team sizes the ruleset doesn't allow", () => {
    const r = rules({ gen: 9, teamSize: 2 });
    const team = customRandomTeam(rules({ gen: 9 }));
    const out = prepareCustomTeam(r, packTeam(team));
    expect(out.ok).toBe(false);
  });

  it("starts a Gen 4 custom battle against the computer and plays turns", async () => {
    const r = rules({ gen: 4, level: 50 });
    const team = packTeam(customRandomTeam(r));
    const made = await createCpuBattle({ name: "Red", format: "custom", level: "hard", team, rules: r });
    if (!made.ok) throw new Error(made.error);
    expect(made.view.formatName).toContain("Gen 4");
    expect(made.view.rules?.gen).toBe(4);
    let view = made.view;
    const me = readBattleToken(made.token, made.code)!;
    for (let i = 0; i < 5 && view.request; i++) {
      const out = await actOnBattle(made.code, me.playerId, { action: "choose", rqid: view.request.rqid, choice: firstChoice(view.request.data, false) }, view.log.total);
      if (!out.ok) throw new Error(out.error);
      view = out.view;
    }
    expect(view.turn).toBeGreaterThan(1);
    expect(view.log.lines.join("\n")).not.toContain("|split|");
  });
});
