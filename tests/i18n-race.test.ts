import { describe, expect, it } from "vitest";
import { translator, type Tree } from "@/i18n/catalog";
import type { Locale } from "@/i18n/config";
import raceNs from "@/messages/race";
import sizesNames from "@/messages/sizes-names";
import { RACE_ENTRANTS } from "@/lib/race/data";
import { PRESETS } from "@/lib/race/presets";
import { fieldFor, searchEntrants, specFor } from "@/lib/race/lineup";
import { fieldText, presetLabel, roundName } from "@/components/race/words";
import { buildRaceLocal } from "@/components/race/local";
import { localizeEntrants } from "@/components/race/local-names";

const en = translator(raceNs, "en", undefined);
const LOCALES = ["ja", "es", "fr", "de", "it"] as const;
async function race(locale: Exclude<Locale, "en">) {
  return translator(raceNs, locale, (await import(`@/messages/${locale}/race.json`)).default as Tree);
}
async function names(locale: Exclude<Locale, "en">) {
  return translator(sizesNames, locale, (await import(`@/messages/${locale}/sizes-names.json`)).default as Tree);
}

describe("the race's English text from the messages", () => {
  it("titles and hooks every field exactly as lib/race/lineup does", () => {
    const specs = [
      ...PRESETS.map((p) => specFor(p.id)),
      specFor("fastest-eight", ["pikachu"]),
      specFor("fastest-eight", ["regieleki", "shuckle"]),
      specFor("fastest-eight", ["charizard-mega-x", "raichu-alola", "deoxys-speed"], 200),
    ];
    for (const spec of specs) {
      const field = fieldFor(spec, RACE_ENTRANTS);
      expect(fieldText(spec, field.entrants, en)).toEqual({ title: field.title, hook: field.hook });
    }
    for (const p of PRESETS) expect(presetLabel(p.id, en)).toBe(p.label);
  });

  it("names the knockout's rounds as before", () => {
    const field = fieldFor(specFor("every-pokemon"), RACE_ENTRANTS);
    for (const r of field.tournament!.rounds) expect(roundName(r.name, en)).toBe(r.name);
  });
});

describe("the race in other languages", () => {
  it("names runners in the language and finds them by any of their names", async () => {
    const ja = buildRaceLocal("ja", await names("ja"));
    expect(ja.byKey.get("regieleki")!.name).toBe("レジエレキ");
    expect(ja.byKey.get("charizard-mega-x")!.name).toBe("メガリザードンX");
    const alt = new Map<string, string[]>();
    const all = localizeEntrants(RACE_ENTRANTS, ja.local, alt);
    for (const q of ["レジエレキ", "れじえれき", "Regieleki", "rejiereki"]) expect(searchEntrants(all, q, 3, alt)[0]?.key, q).toBe("regieleki");
  });

  it("words fields, rounds and presets without English", async () => {
    for (const locale of LOCALES) {
      const t = await race(locale);
      const spec = specFor("every-pokemon");
      const field = fieldFor(spec, RACE_ENTRANTS);
      expect(fieldText(spec, field.entrants, t).title).not.toBe(field.title);
      // ("Final" is also the Spanish word.)
      for (const r of field.tournament!.rounds) if (locale === "ja" || r.name !== "Final") expect(roundName(r.name, t)).not.toBe(r.name);
      for (const p of PRESETS) expect(presetLabel(p.id, t), `${locale} ${p.id}`).toBeTruthy();
    }
  });
});
