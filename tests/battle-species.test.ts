import { describe, expect, it } from "vitest";
import { Dex } from "@pkmn/dex";
import committed from "@/data/battle-species.json";
import { buildSpeciesIndex } from "@/lib/battle/species-index-build";
import { loadQuickSpriteLookup } from "@/lib/battle/sprite-lookup";

describe("battle species index (sprites without the full dex)", () => {
  it("is what the installed @pkmn/dex gives (npm run battle:species after a bump)", () => {
    expect(committed).toEqual(buildSpeciesIndex());
  });

  it("answers exactly as Dex.species.get for every species, forme and cosmetic forme name", async () => {
    const quick = await loadQuickSpriteLookup();
    const names = Dex.species.all().flatMap((s) => [s.name, ...(s.cosmeticFormes ?? [])]);
    expect(names.length).toBeGreaterThan(1500);
    for (const name of names) {
      const s = Dex.species.get(name);
      expect(quick(name), name).toEqual({ id: s.id, num: s.num });
      // Sets and pastes spell names in other cases and with spaces around them.
      expect(quick(` ${name.toUpperCase()} `), name).toEqual({ id: s.id, num: s.num });
    }
    expect(quick("Nidoran♀")).toEqual({ id: "nidoranf", num: 29 });
    expect(quick("Nidoran♂")).toEqual({ id: "nidoranm", num: 32 });
  });

  it("leaves to the full dex only what it can't answer, and knows an empty slot", async () => {
    const quick = await loadQuickSpriteLookup();
    expect(quick("")).toBeNull();
    // An alias: the dex resolves it, the index doesn't know it (the page then loads the dex).
    expect(Dex.species.get("lando").exists).toBe(true);
    expect(quick("lando")).toBeUndefined();
    expect(quick("Not A Pokemon")).toBeUndefined();
  });
});
