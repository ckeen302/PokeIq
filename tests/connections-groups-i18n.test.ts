import { describe, expect, it } from "vitest";
import { ALL_CATEGORIES, categoryOf } from "@/lib/connections/categories";
import { FACTS } from "@/lib/connections/facts";
import { MIXED_CATEGORIES } from "@/lib/connections/mixed";
import { OTHER_LOCALES } from "@/i18n/config";

/** PokéConnections' groups in every language: the same categories, every word written out. */
describe("groups in other languages", () => {
  const ids = [...ALL_CATEGORIES, ...MIXED_CATEGORIES].map((c) => c.id);
  const sample = FACTS.filter((f) => f.pooled);

  for (const l of OTHER_LOCALES) {
    it(`${l}: every label, rule, line and red herring is written out`, () => {
      for (const id of ids) {
        const en = categoryOf(id);
        const c = categoryOf(id, l);
        expect(c.id).toBe(en.id);
        expect(c.difficulty).toBe(en.difficulty);
        for (const text of [c.label, c.rule]) expect(text, `${l} ${id}`).not.toMatch(/\{|\}|undefined|^$/);
        // English-only groups keep the English wording of the names; every other group is in the language.
        if (!c.englishOnly && !/^(dual|type|pure|mixed|gen|move|ability|hidden|egg|colour):/.test(id)) expect(c.label, `${l} ${id}`).not.toBe(en.label);
        for (const f of sample) {
          if (c.test(f)) expect(c.why(f), `${l} ${id} ${f.name}`).not.toMatch(/\{|\}|undefined/);
          else {
            const lure = c.lure?.(f);
            if (lure) expect(lure, `${l} ${id} ${f.name}`).not.toMatch(/\{|\}|undefined/);
          }
        }
      }
    });
  }

  it("reads naturally (spot checks)", () => {
    expect(categoryOf("type:fire", "fr").label).toBe("Type Feu");
    expect(categoryOf("stone:fire-stone", "fr").label).toBe("Évolue avec une Pierre Feu");
    expect(categoryOf("form:alola", "fr").label).toBe("A une forme d'Alola");
    expect(categoryOf("form:alola", "de").label).toBe("Hat eine Alola-Form");
    expect(categoryOf("gen:5", "de").label).toBe("Debüt in Generation 5 (Einall)");
    expect(categoryOf("type:fire", "ja").label).toBe("ほのおタイプ");
    expect(categoryOf("ability:levitate", "es").label).toBe("Puede tener Levitación");
    expect(categoryOf("top:spe", "it").label).toBe("Statistica più alta: Velocità");
    const pikachu = FACTS.find((f) => f.name === "Pikachu")!;
    const raichu = FACTS.find((f) => f.name === "Raichu")!;
    expect(categoryOf("stone", "ja").why(raichu)).toBe("ピカチュウからかみなりのいしで進化");
    expect(categoryOf("form:alola", "it").why(raichu)).toBe("esiste Raichu di Alola");
    expect(categoryOf("baby", "fr").why(FACTS.find((f) => f.name === "Pichu")!)).toBe(`forme bébé de ${pikachu.name}`);
  });
});
