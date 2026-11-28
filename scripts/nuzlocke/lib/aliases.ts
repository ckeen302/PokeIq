/**
 * Per-game place aliases: a source's place name (by placeKey) -> the area it belongs to, and optionally the part of it
 * the name is. Every entry says why (the source that names the place that way).
 */
export interface Alias {
  /** The area's name. */
  area: string;
  /** The part of the area this name is (becomes the encounter's condition). */
  sub?: string;
  /** Why: which source names it so. */
  why: string;
}

const tanoby = (c: string, serebii?: string): [string, Alias][] => [
  [c.toLowerCase(), { area: "Tanoby Ruins", sub: c, why: "Bulbapedia's Tanoby Ruins page holds the seven chambers" }],
  [`tanoby ruins ${(serebii ?? c).toLowerCase()}`, { area: "Tanoby Ruins", sub: c, why: "Serebii names the chamber under Tanoby Ruins" }],
];

export const ALIASES: Record<string, Record<string, Alias>> = {
  "firered-leafgreen": {
    // Serebii's "Kanto - Roaming After Nat. Dex & If … Chosen" is PokéAPI's "Roaming Kanto".
    kanto: { area: "Roaming Kanto", why: "Serebii lists the roaming beasts under 'Kanto - Roaming…'; PokéAPI under Roaming Kanto" },
    // The harbour where the S.S. Anne docks: PokéAPI files its water under the ship (the decomp's "SS Anne Exterior" map),
    // Serebii as "Vermilion City - Harbor", Bulbapedia's Vermilion City page as its "Port" table. One named place: Vermilion City.
    "ss anne": { area: "Vermilion City", sub: "Harbor", why: "Bulbapedia's Vermilion City page lists this water as the city's Port (PokéAPI files it under S.S. Anne)" },
    "vermilion city harbor": { area: "Vermilion City", sub: "Harbor", why: "Serebii's 'Vermilion City - Harbor'; Bulbapedia's Vermilion City Port table" },
    ...Object.fromEntries([
      ...tanoby("Monean Chamber"),
      ...tanoby("Liptoo Chamber"),
      ...tanoby("Weepth Chamber", "Weepeth Chamber"),
      ...tanoby("Dilford Chamber"),
      ...tanoby("Scufib Chamber"),
      ...tanoby("Rixy Chamber"),
      ...tanoby("Viapos Chamber", "Viapois Chamber"),
    ]),
  },
};

/** Extra Bulbapedia pages that hold an area's table (by area key), beyond the one found by name. */
export const BULBA_PAGES: Record<string, Record<string, string[]>> = {
  "firered-leafgreen": {
    "tanoby ruins": ["Tanoby Ruins", "Tanoby Chambers"],
  },
};
