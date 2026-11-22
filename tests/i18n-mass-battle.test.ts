import { describe, expect, it } from "vitest";
import { translator } from "@/i18n/catalog";
import type { OtherLocale } from "@/i18n/config";
import { PRESETS } from "@/lib/mass-battle/presets";
import { bossDownLine, fmt, groupName, multiKoLine, questionText, resultLine, resultTitle, spreadText, winRateText } from "@/lib/mass-battle/copy";
import { localPreset, mbNames } from "@/lib/mass-battle/i18n";
import { videoHook } from "@/components/mass-battle/record";
import mbCopy from "@/messages/mass-battle-copy";
import mbPages from "@/messages/mass-battle-pages";
import mbUi from "@/messages/mass-battle-ui";
import mbPagesEn from "@/messages/en/mass-battle-pages.json";

/**
 * Pokémon Mass Battle in other languages: the ready-made battles' words match the English data exactly, each language
 * fills every placeholder, the game's own names come from the official data, and English stays as it was.
 */

const LOCALES: OtherLocale[] = ["ja", "es", "fr", "de", "it"];
const NS = ["mass-battle-copy", "mass-battle-pages", "mass-battle-ui", "mass-battle-setup", "mass-battle-how"];
/** A language's compiled messages (through the same ICU compiler as the build). */
const MSG: Record<string, Record<string, never>> = {};
for (const l of LOCALES) for (const ns of NS) MSG[`${l}/${ns}`] = (await import(`@/messages/${l}/${ns}.json`)).default;

describe("Mass Battle's messages", () => {
  it("hold the ready-made battles' English exactly", () => {
    const en = mbPagesEn.presets as Record<string, { title: string; hook: string; blurb: string; a?: string; b?: string }>;
    expect(Object.keys(en).sort()).toEqual(PRESETS.map((p) => p.id).sort());
    for (const p of PRESETS) {
      expect(en[p.id].title, p.id).toBe(p.title);
      expect(en[p.id].hook, p.id).toBe(p.hook);
      expect(en[p.id].blurb, p.id).toBe(p.blurb);
      expect(p.labels ? [en[p.id].a, en[p.id].b] : null, p.id).toEqual(p.labels ?? null);
    }
    const t = translator(mbPages, "en", undefined);
    for (const p of PRESETS) expect(localPreset({ ...p, labels: p.labels ?? null }, t)).toEqual({ ...p, labels: p.labels ?? null });
  });

  it("keep English's words", () => {
    expect(questionText("Magikarp", "Arceus")).toBe("How many Magikarp beat Arceus?");
    expect(spreadText(3, 120)).toBe("± 3 over 120 battles");
    expect(winRateText(60, 120, 48)).toBe("48 won 60 of 120 battles");
    expect(multiKoLine("Garchomp", "Earthquake", 12, "Magikarp")).toBe("Garchomp's Earthquake KO'd 12 Magikarp");
    expect(bossDownLine("Pikachu", "Thunderbolt", "Snorlax")).toBe("Pikachu's Thunderbolt knocked out Snorlax!");
    expect(resultTitle(0, ["Pikachu", "Snorlax"], [3, 0])).toBe("Pikachu win!");
    expect(groupName({ types: ["fire"] })).toBe("Fire types");
    expect(videoHook({ question: { army: {}, boss: {} } as never, names: ["Magikarp", "Arceus"], hook: "" })).toBe("How many Magikarp does it take to beat Arceus? 😳");
    expect(fmt(1234)).toBe("1,234");
    expect(mbNames("en")).toBeNull();
  });

  it("fill every placeholder in every language", () => {
    for (const l of LOCALES) {
      const c = translator(mbCopy, l, MSG[`${l}/mass-battle-copy`]);
      const u = translator(mbUi, l, MSG[`${l}/mass-battle-ui`]);
      const p = translator(mbPages, l, MSG[`${l}/mass-battle-pages`]);
      const lines = [
        questionText("Magikarp", "Arceus", c),
        spreadText(3, 120, c),
        winRateText(60, 120, 48, c),
        multiKoLine("Garchomp", "Earthquake", 12, "Magikarp", c),
        bossDownLine("Pikachu", "Thunderbolt", "Snorlax", c),
        resultTitle(0, ["Pikachu", "Snorlax"], [3, 0], c),
        resultLine({ winner: 0, left: [3, 0], seconds: 12.5, kos: [1, 40] } as never, ["Pikachu", "Snorlax"], c),
        videoHook({ question: { army: {}, boss: {} } as never, names: ["Magikarp", "Arceus"], hook: "" }, u),
        u("vid.sub"),
        u("notes.struggle"),
        ...PRESETS.map((x) => localPreset({ ...x, labels: x.labels ?? null }, p).title),
      ];
      for (const s of lines) {
        expect(s, `${l}: ${s}`).not.toMatch(/[{}]|\[\[/);
        expect(s.length, l).toBeGreaterThan(0);
      }
      expect(localPreset({ ...PRESETS[0], labels: null }, p).title, l).not.toBe(PRESETS[0].title);
    }
  });

  it("use the games' official names", () => {
    const fr = translator(mbPages, "fr", MSG["fr/mass-battle-pages"]);
    expect(localPreset({ ...PRESETS[0], labels: null }, fr).title).toBe("Combien de Magicarpe pour battre Arceus ?");
    const de = translator(mbUi, "de", MSG["de/mass-battle-ui"]);
    expect(de("notes.struggle")).toBe("Keine AP: Verzweifler");
    const ja = mbNames("ja")!;
    expect(ja.moves.Earthquake).toBe("じしん");
    expect(fmt(1234, "de")).toBe("1.234");
  });
});
