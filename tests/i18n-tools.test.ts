import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OtherLocale } from "@/i18n/config";
import { localizeSpecies } from "@/components/tools/shiny-maker/local";
import { decodeSpecies, type SpeciesFile } from "@/lib/shiny-maker/data";
import { firstDesign } from "@/lib/shiny-maker/presets";
import { shinyLocal } from "@/lib/shiny-maker/local";

const LOCALES: OtherLocale[] = ["ja", "es", "fr", "de", "it"];
const DIR = "public/shiny-maker/px";
const file = (id: number) => JSON.parse(readFileSync(`${DIR}/${id}.json`, "utf8")) as SpeciesFile;

describe("the Shiny Pokémon Maker in other languages", () => {
  it("names every part the data has, in every language", () => {
    const parts = new Set<string>();
    for (const f of readdirSync(DIR)) for (const p of (JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as SpeciesFile).parts) parts.add(p.n);
    for (const l of LOCALES) {
      const own = shinyLocal(l).parts;
      for (const n of parts) expect(own[n], `${l}: ${n}`).toBeTruthy();
      expect(Object.keys(own).sort()).toEqual([...parts].sort());
    }
  });

  it("names every Pokémon, and the picker also takes its English name", () => {
    const ja = shinyLocal("ja");
    expect(ja.names[25]).toBe("ピカチュウ");
    expect(ja.alt[25].split(" ")).toContain("pikachu");
    expect(Object.keys(shinyLocal("de").names)).toHaveLength(1025);
  });

  it("keeps the parts' English names, so the first design is the same in every language", () => {
    const sp = decodeSpecies(file(6));
    const local = localizeSpecies(sp, shinyLocal("fr"));
    expect(local.name).toBe("Dracaufeu");
    expect(local.parts.map((p) => p.n)).toEqual(sp.parts.map((p) => p.n));
    expect(local.parts.every((p) => p.l)).toBe(true);
    expect(firstDesign(local)).toEqual(firstDesign(sp));
  });
});
