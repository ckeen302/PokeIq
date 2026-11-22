import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import sizesLines from "@/messages/sizes-lines";
import sizesNames from "@/messages/sizes-names";
import { SIZE_BY_KEY, SIZE_ITEMS } from "@/lib/sizes/data";
import { PRESETS, presetLineup } from "@/lib/sizes/presets";
import { ORDERS, dirLabel, orderInfo, orderTitle, type Order } from "@/lib/sizes/order";
import { listCaption, listNote, type ListSpec } from "@/lib/sizes/list";
import { compareHook, searchItems } from "@/lib/sizes/lineup";
import { compareHookText, compareTitle, dirText, listCaptionText, listNoteText, orderLabel, presetHook, presetTitle, stopCaptionText, badgeText } from "@/components/sizes/words";
import { buildSizesLocal } from "@/components/sizes/local";
import { localizeItems } from "@/components/sizes/local-names";

const en = translator(sizesLines, "en", undefined);
const ORDER_LIST: Order[] = ORDERS.flatMap((o) => (["asc", "desc"] as const).map((dir) => ({ by: o.key, dir })));

async function lines(locale: Exclude<Locale, "en">) {
  return translator(sizesLines, locale, (await import(`@/messages/${locale}/sizes-lines.json`)).default as Tree);
}
async function names(locale: Exclude<Locale, "en">) {
  return translator(sizesNames, locale, (await import(`@/messages/${locale}/sizes-names.json`)).default as Tree);
}

describe("Pokémon Sizes' English text from the messages", () => {
  it("words every lineup's title and hook in every order exactly as lib/sizes does", () => {
    for (const p of PRESETS) {
      for (const o of ORDER_LIST) {
        expect(presetTitle(p.id, o, en)).toBe(orderTitle(p.title, o));
        expect(presetHook(p.id, o, en)).toBe(orderTitle(p.hook, o));
      }
    }
  });

  it("labels orders and directions as before", () => {
    for (const o of ORDERS) {
      expect(orderLabel(o.key, en)).toBe(o.label);
      expect(en(`order.${o.key}.short`)).toBe(o.short);
      for (const d of ["asc", "desc"] as const) expect(dirText(o.key, d, en)).toBe(dirLabel(o.key, d));
      expect(en(`order.${o.key}.none`)).toBe(orderInfo(o.key).missing.replace(/^(a )?listed /, "listed "));
    }
  });

  it("captions and notes every table exactly as lib/sizes does", () => {
    const specs: ListSpec[] = [
      ...PRESETS.map((p) => ({ preset: p.id })),
      { preset: "every-pokemon", focus: "pikachu" },
      { preset: "every-pokemon", focus: "charizard-gmax" },
      { preset: "every-pokemon", focus: "wailord" },
      { preset: "every-pokemon", vs: ["wailord", "eternatus"] },
      { preset: "every-pokemon", vs: ["pikachu", "snorlax-gmax", "onix"] },
    ];
    for (const spec of specs) {
      for (const o of ORDER_LIST) {
        expect(listCaptionText(SIZE_ITEMS, spec, o, en)).toBe(listCaption(SIZE_ITEMS, spec, o));
        expect(listNoteText(SIZE_ITEMS, spec, o, en)).toBe(listNote(SIZE_ITEMS, spec, o));
      }
    }
  });

  it("words comparison hooks and titles as before", () => {
    const a = ["wailord", "eternatus", "ref-human"].map((k) => SIZE_BY_KEY.get(k)!);
    for (const o of ORDER_LIST) {
      expect(compareHookText(a, o, en)).toBe(compareHook(a, o));
      expect(compareHookText([], o, en)).toBe(compareHook([], o));
    }
    expect(compareTitle(a, en)).toBe(compareHook(a).replace(/ 😳$/, ""));
    expect(compareTitle([], en)).toBe(compareHook([]).replace(/ 😳$/, ""));
  });
});

describe("Pokémon Sizes in other languages", () => {
  it("names forms and references with the games' names", async () => {
    const ja = buildSizesLocal("ja", await names("ja"));
    expect(ja.byKey.get("charizard-mega-x")!.name).toBe("メガリザードンX");
    expect(ja.byKey.get("raichu-alola")!.name).toBe("ライチュウ（アローラのすがた）");
    expect(ja.byKey.get("pikachu")!.name).toBe("ピカチュウ");
    expect(ja.local.alt["pikachu"]).toContain("pikachuu");
    expect(ja.local.types.fire).toBe("ほのお");
    const de = buildSizesLocal("de", await names("de"));
    expect(de.byKey.get("charizard-gmax")!.name).toBe("Gigadynamax-Glurak");
    expect(de.byKey.get("ref-car")!.name).not.toBe("Car");
    for (const locale of ["ja", "es", "fr", "de", "it"] as const) {
      const b = buildSizesLocal(locale, await names(locale));
      // Every Mega, Gigantamax, regional and Eternamax form gets its name in the language.
      for (const i of b.items) if (i.kind !== "pokemon" && i.kind !== "ref") expect(b.local.names[i.key], `${locale} ${i.key}`).toBeTruthy();
    }
  });

  it("finds figures by their name in the language, in English and in rōmaji", async () => {
    const ja = buildSizesLocal("ja", await names("ja"));
    const alt = new Map<string, string[]>();
    const items = localizeItems(SIZE_ITEMS, ja.local, alt);
    for (const q of ["ピカチュウ", "ぴかちゅう", "Pikachu", "pikachuu"]) expect(searchItems(items, q, 3, alt)[0]?.key, q).toBe("pikachu");
  });

  it("words captions and badges without English", async () => {
    for (const locale of ["ja", "es", "fr", "de", "it"] as const) {
      const t = await lines(locale);
      const line = presetLineup(PRESETS[0], SIZE_ITEMS);
      const facts = line.slice(0, 200).map((i) => stopCaptionText(i, line, { by: "height", dir: "asc" }, false, t));
      expect(facts.filter(Boolean).length).toBeGreaterThan(100);
      for (const f of facts) if (f) expect(f).not.toMatch(/ the size of | as tall as | weighs /);
      const speed = { by: "spe", dir: "desc" } as const;
      expect(stopCaptionText(undefined, line, speed, true, t)).toBeTruthy();
      expect(badgeText(SIZE_BY_KEY.get("wailord")!, speed, {}, t).unit).not.toBe("meter length");
    }
  });
});
