import { encodeDesign, newDesign } from "@/lib/shiny-maker/design";
import { LAST_ID } from "@/lib/shiny-maker/data";

/**
 * A link that opens the Shiny Pokémon Maker on a Pokémon: a fresh design of its species (the maker has species, not
 * forms), starting from the official shiny colours or the normal ones. A design carries its part count, which comes
 * from /tools/favorite-pokemon-picker/shiny-parts.json (one digit per species); without it, no link.
 */
export function shinyMakerHref(dex: number, parts: string | null, shiny: boolean): string | null {
  if (!parts || dex < 1 || dex > LAST_ID) return null;
  const n = Number(parts[dex - 1]);
  if (!n) return null;
  return `/tools/shiny-maker?d=${encodeDesign(newDesign(dex, n, shiny ? 1 : 0))}`;
}

let partsPromise: Promise<string | null> | null = null;
/** The part counts, fetched once per visit (null if they don't load). */
export function loadShinyParts(): Promise<string | null> {
  partsPromise ??= fetch("/tools/favorite-pokemon-picker/shiny-parts.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ parts: string }>) : null))
    .then((j) => (j && typeof j.parts === "string" ? j.parts : null))
    .catch(() => null);
  void partsPromise.then((p) => p === null && (partsPromise = null));
  return partsPromise;
}
