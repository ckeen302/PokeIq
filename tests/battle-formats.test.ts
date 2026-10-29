import { describe, expect, it } from "vitest";
import { Dex } from "pokemon-showdown";
import { BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { FORMAT_CATALOGUE, PLAYABLE_FORMATS, POPULAR_FORMAT_IDS, catalogueFormat, isPlayableFormat } from "@/lib/battle/format-catalogue";
import { ALL_FORMATS } from "@/lib/battle/play";
import { customFormatId, customName, describeRules, normalizeRules, DEFAULT_CUSTOM_RULES } from "@/lib/battle/custom-rules";
import { checkRules, customRandomTeam, prepareCustomTeam } from "@/lib/server/battle-engine/custom";
import FORMAT_RULES from "@/data/battle/format-rules.json";
import { smokeFormat } from "../scripts/build-formats";

describe("format catalogue", () => {
  it("lists every format Showdown ships, once", () => {
    const engine = Dex.formats.all().filter((f) => f.effectType === "Format");
    expect(FORMAT_CATALOGUE.map((f) => f.id).sort()).toEqual(engine.map((f) => f.id).sort());
    expect(Object.keys(FORMAT_RULES).length).toBe(FORMAT_CATALOGUE.length);
    expect(PLAYABLE_FORMATS.length).toBeGreaterThan(200);
  });

  it("keeps every format the site already plays", () => {
    for (const id of [...BATTLE_FORMAT_IDS, ...ALL_FORMATS]) expect(catalogueFormat(id)?.supported, id).toBe(true);
  });

  it("names only real formats as popular", () => {
    for (const id of POPULAR_FORMAT_IDS) expect(catalogueFormat(id), id).toBeTruthy();
  });

  it("gives unsupported formats a reason", () => {
    for (const f of FORMAT_CATALOGUE.filter((x) => !x.supported)) expect(f.reason, f.id).toBeTruthy();
  });

  it("starts a battle in every supported format", { timeout: 240_000 }, () => {
    const failed: string[] = [];
    for (const f of PLAYABLE_FORMATS) {
      // Teams are random: a hard format gets a second deal before it counts as broken.
      const reason = smokeFormat(f.id) && smokeFormat(f.id);
      if (reason) failed.push(`${f.id}: ${reason}`);
    }
    expect(failed).toEqual([]);
  });
});

describe("custom rules on a Showdown format", () => {
  it("plays the format's own id and name", () => {
    const rules = normalizeRules({
      ...DEFAULT_CUSTOM_RULES,
      base: "gen4uu",
      baseName: "[Gen 4] UU",
    });
    expect(customFormatId(rules)).toBe("gen4uu");
    expect(customName(rules)).toBe("[Gen 4] UU");
    expect(describeRules(rules)[0].text).toContain("[Gen 4] UU");
    expect(normalizeRules({ base: "Not An Id!" }).base).toBeUndefined();
  });

  it("is checked against the catalogue, which sets its name and gen", () => {
    const checked = checkRules({
      ...DEFAULT_CUSTOM_RULES,
      base: "gen4uu",
      baseName: "spoofed",
    });
    expect(checked.ok && checked.formatid).toBe("gen4uu");
    expect(checked.ok && checked.rules.baseName).toBe("[Gen 4] UU");
    expect(checked.ok && checked.rules.gen).toBe(4);
    expect(checkRules({ base: "gen9madeupformat" }).ok).toBe(false);
    const unsupported = FORMAT_CATALOGUE.find((f) => !f.supported);
    if (unsupported) expect(isPlayableFormat(unsupported.id)).toBe(false);
  });

  it("deals random formats' teams from the engine, whatever was sent", () => {
    const rules = { ...DEFAULT_CUSTOM_RULES, base: "gen7randombattle" };
    const team = prepareCustomTeam(rules, "random");
    expect(team.ok && team.size).toBe(6);
    expect(customRandomTeam(rules)).toHaveLength(6);
  });

  it("builds legal quick teams for team formats", () => {
    const team = customRandomTeam({
      ...DEFAULT_CUSTOM_RULES,
      base: "gen9vgc2025regi",
    });
    expect(team).toHaveLength(6);
    expect(team.every((s) => s.level === 50)).toBe(true);
  });
});
