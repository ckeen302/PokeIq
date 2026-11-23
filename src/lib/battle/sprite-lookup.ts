import type { SpriteSpecies } from "./sprites";

/** Showdown's id for a name: lower case, letters and digits only. */
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * A sprite's species from its name, from the small species index (src/data/battle-species.json, about 10 KB) rather
 * than all of @pkmn/dex. It answers what the dex would for every species and forme name (tests/battle-species.test.ts);
 * `undefined` means the name isn't one of those (an alias, a typo), which only the full dex can settle.
 */
export type QuickSpriteLookup = (name: string) => SpriteSpecies | null | undefined;

let index: Promise<QuickSpriteLookup> | null = null;

export function loadQuickSpriteLookup(): Promise<QuickSpriteLookup> {
  index ??= import("@/data/battle-species.json").then(({ default: num }: { default: Record<string, number> }) => (name: string) => {
    const raw = name.trim();
    let id = toID(raw);
    // As the dex reads them: "Nidoran♀" and "Nidoran♂".
    if (id === "nidoran" && raw.endsWith("♀")) id = "nidoranf";
    else if (id === "nidoran" && raw.endsWith("♂")) id = "nidoranm";
    if (!id) return null;
    const n = num[id];
    return n === undefined ? undefined : { id, num: n };
  });
  index.catch(() => (index = null));
  return index;
}
