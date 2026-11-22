import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import formats from "@/messages/battle-formats";
import rulesNs from "@/messages/battle-rules";
import pagesNs from "@/messages/battle-pages";
import frontierNs from "@/messages/battle-frontier";
import frFormats from "@/messages/fr/battle-formats.json";
import jaFormats from "@/messages/ja/battle-formats.json";
import deRules from "@/messages/de/battle-rules.json";
import { ALL_FORMATS, CPU_LEVELS, CPU_LEVEL_INFO, PLAY_FORMAT_INFO, type PlayFormatId } from "@/lib/battle/play";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { FRONTIER_INFO } from "@/lib/battle/frontier";
import { CLAUSES, CLAUSE_INFO, DEFAULT_CUSTOM_RULES, GIMMICKS, GIMMICK_INFO, customName, describeRules, normalizeRules } from "@/lib/battle/custom-rules";
import { cpuLevelName, customRulesName, formatBlurb, formatName, formatShort } from "@/lib/battle/format-labels";
import { describeRulesIn } from "@/lib/battle/custom-rules-text";
import { loadBattleNames } from "@/lib/battle/local-names";

const IDS = Object.keys(PLAY_FORMAT_INFO) as PlayFormatId[];
const en = translator(formats, "en", undefined);

describe("battle setup words: English exactly as before", () => {
  it("formats, blurbs and computer levels come from play.ts untouched", () => {
    for (const id of IDS) {
      expect(formatName(en, id)).toBe(PLAY_FORMAT_INFO[id].name);
      expect(formatShort(en, id)).toBe(PLAY_FORMAT_INFO[id].short);
      expect(formatBlurb(en, id)).toBe(PLAY_FORMAT_INFO[id].blurb);
    }
    for (const l of CPU_LEVELS) expect(cpuLevelName(en, l)).toBe(CPU_LEVEL_INFO[l].name);
  });

  it("the English messages hold the libraries' own English", () => {
    // Another language's page reads these keys, so each must say what the library says in English.
    for (const [id, blurb] of Object.entries(formats.en.blurb)) expect(PLAY_FORMAT_INFO[id as PlayFormatId].blurb).toBe(blurb);
    for (const [id, short] of Object.entries(formats.en.short)) expect(PLAY_FORMAT_INFO[id as PlayFormatId].short).toBe(short);
    for (const l of CPU_LEVELS) expect(formats.en.cpu[l]).toEqual(CPU_LEVEL_INFO[l]);
    for (const id of BATTLE_FORMAT_IDS) expect(pagesNs.en.hub.formatBlurb[id]).toBe(BATTLE_FORMATS[id].blurb);
    for (const [k, v] of Object.entries(FRONTIER_INFO)) expect(frontierNs.en.info[k as keyof typeof FRONTIER_INFO]).toEqual(v);
    for (const g of GIMMICKS) expect(rulesNs.en.gimmick[g]).toBe(GIMMICK_INFO[g].name);
    for (const c of CLAUSES) expect(rulesNs.en.clause[c]).toEqual({ name: CLAUSE_INFO[c].name, blurb: CLAUSE_INFO[c].blurb });
  });

  it("rulesets read as before", () => {
    const t = translator(rulesNs, "en", undefined);
    const tf = translator(formats, "en", undefined);
    for (const rules of [DEFAULT_CUSTOM_RULES, normalizeRules({ gen: 4, level: 50, levelMode: "cap", pick: 3, teamSize: 6 }), normalizeRules({ base: "gen9ou", baseName: "[Gen 9] OU", baseRandom: true })]) {
      expect(describeRulesIn(t, rules)).toEqual(describeRules(rules));
      expect(customRulesName(tf, rules)).toBe(customName(rules));
    }
  });
});

describe("battle setup words in another language", () => {
  const fr = translator(formats, "fr", frFormats as Tree);
  const ja = translator(formats, "ja", jaFormats as Tree);

  it("translates our labels and keeps Showdown's format names", () => {
    expect(formatShort(fr, "gen9randombattle")).toBe("Combat aléatoire");
    expect(formatShort(fr, "gen4randombattle")).toBe("Gen 4 aléatoire");
    expect(formatShort(ja, "gen3ou")).toBe("第3世代OU");
    expect(formatShort(fr, "gen9ou")).toBe("OU");
    expect(formatName(fr, "gen9ou")).toBe("[Gen 9] OU");
    expect(formatName(fr, "custom")).toBe("Règles perso");
    expect(formatBlurb(fr, "gen9ou")).toContain("Showdown");
    expect(formatBlurb(ja, "gen2randombattle")).toContain("第2世代");
    for (const id of ALL_FORMATS) expect(formatBlurb(fr, id)).not.toBe(PLAY_FORMAT_INFO[id].blurb);
    expect(customRulesName(fr, normalizeRules({ gen: 4, level: 50, levelMode: "cap" }))).toBe("[Gen 4] Perso · N. ≤50");
  });

  it("describes a ruleset in the language", () => {
    const de = translator(rulesNs, "de", deRules as Tree);
    const lines = describeRulesIn(de, DEFAULT_CUSTOM_RULES);
    expect(lines.map((l) => l.label)).toEqual(["Mechanik", "Level", "Teams", "Klauseln", "Spezialmechaniken"]);
    expect(lines[0].text).toBe("Generation 9");
    expect(lines[4].text).toBe("Terakristallisierung an");
  });

  it("names Showdown's Pokémon, moves, items and abilities officially, forms included", async () => {
    const fr = await loadBattleNames("fr");
    expect(fr.species("Rotom")).toBe("Motisma");
    expect(fr.species("Landorus-Therian")).toBe("Démétéros-Therian");
    expect(fr.species("Ho-Oh")).toBe("Ho-Oh");
    expect(fr.species("Nidoran-F")).toBe("Nidoran♀");
    expect(fr.move("U-turn")).toBe("Demi-Tour");
    expect(fr.move("Thunderbolt")).toBe("Tonnerre");
    expect(fr.species("Not A Pokemon")).toBe("Not A Pokemon");
    const ja = await loadBattleNames("ja");
    expect(ja.species("Pikachu")).toBe("ピカチュウ");
    expect(ja.item("Choice Specs")).toBe("こだわりメガネ");
  });
});
