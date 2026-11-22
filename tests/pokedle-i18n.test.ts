import { describe, expect, it } from "vitest";
import { translator } from "@/i18n/catalog";
import board from "@/messages/pokedle-board";
import es from "@/messages/es/pokedle-board.json";
import ja from "@/messages/ja/pokedle-board.json";
import de from "@/messages/de/pokedle-board.json";
import fr from "@/messages/fr/pokedle-board.json";
import { DLE_ASSISTS, DLE_ASSIST_INFO, multiplierText } from "@/lib/dle-assist";
import { CLASSIC_RULES, DLE_FORMAT_LABEL, DLE_TIMER_LABEL, bonusText, dleRules, gensText, rulesTags } from "@/lib/dle-format";
import { DLE_COLUMNS, DLE_HINT_LABEL } from "@/lib/dle-types";
import { stageLabel } from "@/lib/dle-compare";
import { dataKey, dexTag, localBonusText, localCellValue, localGensText, localMeasure, localMultiplier, localRulesTags, localStage } from "@/lib/dle-i18n";
import { dleLabels, dleNames } from "@/lib/dle-lexicon";
import { POKEDEX } from "@/lib/pokemon/pokedex";

const en = translator(board, "en", undefined);
const tEs = translator(board, "es", es);
const tJa = translator(board, "ja", ja);
const tDe = translator(board, "de", de);
const tFr = translator(board, "fr", fr);

const RULES = [
  CLASSIC_RULES,
  dleRules({ format: "squirdle" }),
  dleRules({ format: "squirdle", gens: [1, 4], guesses: 8 }),
  dleRules({ format: "custom", columns: ["gen", "type1", "color"], gens: [3, 3], timer: "60s" }),
  dleRules({ close: false, hints: false, pool: "legendary", timer: "3m" }),
];

describe("Pokédle's words in English stay as they were", () => {
  it("rules tags, gens, bonus and the format, timer, assist and hint labels", () => {
    for (const r of RULES) {
      expect(localRulesTags(r, en)).toEqual(rulesTags(r));
      expect(localRulesTags(r, en, { dex: "No dex", hard: true })).toEqual(rulesTags(r, { dex: "No dex", hard: true }));
      expect(localRulesTags(r, en, { guesses: false })).toEqual(rulesTags(r).filter((t) => !/ guesses$/.test(t)));
      expect(localBonusText(r, en)).toBe(bonusText(r));
      expect(localGensText(r.gens, en)).toBe(gensText(r.gens));
    }
    expect(localGensText([1, 3, 5], en)).toBe(gensText([1, 3, 5]));
    for (const f of ["classic", "squirdle", "custom"] as const) expect(en(`format.${f}`)).toBe(DLE_FORMAT_LABEL[f]);
    for (const t of ["none", "3m", "60s"] as const) expect(en(`timer.${t}`)).toBe(DLE_TIMER_LABEL[t]);
    for (const a of DLE_ASSISTS) {
      expect(en(`assist.${a}.label`)).toBe(DLE_ASSIST_INFO[a].label);
      expect(en(`assist.${a}.blurb`)).toBe(DLE_ASSIST_INFO[a].blurb);
      expect(localMultiplier(a, en)).toBe(multiplierText(a));
    }
    expect(dexTag("off", en)).toBe("No dex");
    expect(dexTag("field", en)).toBe("Field Guide");
    for (const h of ["genus", "silhouette"] as const) expect(en(`hint.${h}`)).toBe(DLE_HINT_LABEL[h]);
    for (const c of DLE_COLUMNS) expect(en(`column.${c.key}`)).toBe(c.label);
    for (const s of [0, 1, 2, 3]) expect(localStage(s, en)).toBe(stageLabel(s));
  });

  it("board values and measures, untouched without labels", () => {
    for (const [col, v] of [["type1", "Fire"], ["type2", "None"], ["height", "1.2 m"], ["weight", "60.0 kg"], ["color", "Red"], ["stage", "Baby"], ["gen", "4"]] as const) {
      expect(localCellValue(col, v, en, undefined)).toBe(v);
    }
    expect(localMeasure(4, "m", en)).toBe("0.4 m");
    expect(localMeasure(9999, "kg", en)).toBe("999.9 kg");
  });

  it("the English page's names are [id, name, gen] only, and no labels", () => {
    const names = dleNames("en");
    expect(names[0]).toEqual([1, "Bulbasaur", 1]);
    expect(names.every((e) => e.length === 3)).toBe(true);
    expect(dleLabels("en")).toBeUndefined();
  });
});

describe("Pokédle's words in other languages", () => {
  it("translates the API's English board values", () => {
    const labels = dleLabels("es")!;
    expect(localCellValue("type1", "Fire", tEs, labels)).toBe("Fuego");
    expect(localCellValue("type2", "None", tEs, labels)).toBe("Ninguno");
    expect(localCellValue("color", "Red", tEs, labels)).toBe("Rojo");
    expect(localCellValue("height", "1.2 m", tEs, labels)).toBe("1,2 m");
    expect(localCellValue("weight", "60.0 kg", tEs, labels)).toBe("60,0 kg");
    expect(localCellValue("stage", "Baby", tEs, labels)).toBe("Bebé");
    expect(localCellValue("stage", "2", tEs, labels)).toBe("2");
    const jl = dleLabels("ja")!;
    expect(localCellValue("type1", "Electric", tJa, jl)).toBe("でんき");
    expect(localCellValue("stage", "Baby", tJa, jl)).toBe("ベイビィ");
    expect(localCellValue("height", "0.4 m", tJa, jl)).toBe("0.4 m");
    expect(localMeasure(60, "kg", tDe)).toBe("6,0 kg");
  });

  it("rules tags, gens and multipliers", () => {
    expect(localRulesTags(dleRules({ format: "squirdle", gens: [1, 4], guesses: 8 }), tEs, { dex: dexTag("off", tEs) })).toEqual(["Datos", "Gen. 1–4", "8 intentos", "Sin Pokédex"]);
    expect(localGensText([2], tJa)).toBe("第2世代");
    expect(localGensText([1, 2, 3, 4], tJa)).toBe("第1〜4世代");
    expect(localMultiplier("full", tDe)).toBe("×0,7");
    expect(localBonusText(dleRules({ format: "squirdle" }), tFr)).toBe("+20 %");
  });

  it("sends only the page's language: its labels and names with aliases", () => {
    const labels = dleLabels("fr")!;
    expect(labels.types.electric).toBe("Électrik");
    expect(labels.regions.kanto).toBeTruthy();
    expect(Object.keys(labels.types)).not.toContain("stellar");
    const names = dleNames("ja");
    const pika = names.find((e) => e[0] === 25)!;
    expect(pika[1]).toBe("ピカチュウ");
    expect(pika[3]).toContain("Pikachu");
    expect(names).toHaveLength(POKEDEX.length);
  });

  it("keys data the way the data files do", () => {
    expect(dataKey("Mouse Pokémon")).toBe("mousepokemon");
  });
});
