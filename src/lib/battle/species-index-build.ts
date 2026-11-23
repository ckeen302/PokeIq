import { Dex, toID } from "@pkmn/dex";

/**
 * Builds src/data/battle-species.json (scripts/battle-species.ts; tests/battle-species.test.ts checks the committed
 * file is what this builds from the installed @pkmn/dex): every species and forme Showdown knows, cosmetic formes
 * included, as its id → its National Dex number (what a sprite needs). Node only: it reads the whole dex.
 */
export function buildSpeciesIndex(): Record<string, number> {
  const num: Record<string, number> = {};
  const add = (name: string) => {
    const s = Dex.species.get(name);
    // Every name here is its species' own (Showdown's id is the name's id); the test checks that holds.
    if (s.exists && s.id === toID(name)) num[s.id] = s.num;
  };
  for (const s of Dex.species.all()) {
    add(s.name);
    for (const f of s.cosmeticFormes ?? []) add(f);
  }
  return Object.fromEntries(Object.entries(num).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
