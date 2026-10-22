/**
 * PokéGuessr's game families: the paired and enhanced versions of a game that
 * look the same (Red / Blue / Yellow, Sun / Moon and Ultra Sun / Ultra Moon…).
 * Remakes are families of their own. Every screenshot belongs to one family,
 * and keeps its specific game ("Crystal", "Platinum") as detail when known.
 *
 * Shared by the server (filters, scoring the "guess the game" bonus) and the
 * browser (the filter pickers), so nothing here is secret.
 */

export const GEO_FAMILIES = [
  { id: "rby", name: "Red / Blue / Yellow", short: "RBY", era: "2d" },
  { id: "gsc", name: "Gold / Silver / Crystal", short: "GSC", era: "2d" },
  { id: "rse", name: "Ruby / Sapphire / Emerald", short: "RSE", era: "2d" },
  { id: "frlg", name: "FireRed / LeafGreen", short: "FRLG", era: "2d" },
  { id: "dppt", name: "Diamond / Pearl / Platinum", short: "DPPt", era: "2d" },
  { id: "hgss", name: "HeartGold / SoulSilver", short: "HGSS", era: "2d" },
  { id: "bw", name: "Black / White / Black 2 / White 2", short: "BW · B2W2", era: "2d" },
  { id: "xy", name: "X / Y", short: "XY", era: "3d" },
  { id: "oras", name: "Omega Ruby / Alpha Sapphire", short: "ORAS", era: "3d" },
  { id: "sm", name: "Sun / Moon / Ultra Sun / Ultra Moon", short: "SM · USUM", era: "3d" },
  { id: "lgpe", name: "Let's Go, Pikachu! / Eevee!", short: "LGPE", era: "3d" },
  { id: "swsh", name: "Sword / Shield", short: "SwSh", era: "3d" },
  { id: "bdsp", name: "Brilliant Diamond / Shining Pearl", short: "BDSP", era: "3d" },
  { id: "pla", name: "Legends: Arceus", short: "PLA", era: "3d" },
  { id: "sv", name: "Scarlet / Violet", short: "SV", era: "3d" },
  { id: "za", name: "Legends: Z-A", short: "Z-A", era: "3d" },
] as const;

export type GeoFamilyId = (typeof GEO_FAMILIES)[number]["id"];
export type GeoFamily = (typeof GEO_FAMILIES)[number];

/** Classic 2D: the sprite games up to Black 2 / White 2. Modern 3D: X / Y onwards, remakes included. */
export const GEO_ERAS = ["2d", "3d"] as const;
export type GeoEra = (typeof GEO_ERAS)[number];
export const GEO_ERA_NAMES: Record<GeoEra | "all", string> = { all: "All games", "2d": "Classic 2D", "3d": "Modern 3D" };

export const GEO_FAMILY_IDS = GEO_FAMILIES.map((f) => f.id) as GeoFamilyId[];
const BY_ID = new Map<string, GeoFamily>(GEO_FAMILIES.map((f) => [f.id, f]));

export const isGeoFamily = (id: unknown): id is GeoFamilyId => typeof id === "string" && BY_ID.has(id);
export const geoFamily = (id: GeoFamilyId): GeoFamily => BY_ID.get(id)!;
export const familyEra = (id: GeoFamilyId): GeoEra => geoFamily(id).era;
/** Release order (the order of GEO_FAMILIES). */
export const familyRank = (id: string) => GEO_FAMILY_IDS.indexOf(id as GeoFamilyId);

/**
 * Every label a screenshot's game has had in the data, by family. A label
 * names the specific game when it's known ("Crystal", "Black 2 / White 2"),
 * else the family.
 */
const GAME_FAMILY: Record<string, GeoFamilyId> = {
  "Red / Blue / Yellow": "rby",
  "Red / Green / Blue / Yellow": "rby",
  "Red / Blue": "rby",
  Yellow: "rby",
  "Gold / Silver / Crystal": "gsc",
  "Gold / Silver": "gsc",
  Crystal: "gsc",
  "Ruby / Sapphire / Emerald": "rse",
  "Ruby / Sapphire": "rse",
  "Sapphire / Emerald": "rse",
  Emerald: "rse",
  "FireRed / LeafGreen": "frlg",
  "Diamond / Pearl / Platinum": "dppt",
  "Diamond / Pearl": "dppt",
  Platinum: "dppt",
  "HeartGold / SoulSilver": "hgss",
  "Black / White / Black 2 / White 2": "bw",
  "Black / White": "bw",
  "Black 2 / White 2": "bw",
  "X / Y": "xy",
  "Omega Ruby / Alpha Sapphire": "oras",
  "Omega Ruby": "oras",
  "Alpha Sapphire": "oras",
  "Sun / Moon / Ultra Sun / Ultra Moon": "sm",
  "Sun / Moon": "sm",
  "Ultra Sun / Ultra Moon": "sm",
  "Let's Go, Pikachu! / Eevee!": "lgpe",
  "Sword / Shield": "swsh",
  "Brilliant Diamond / Shining Pearl": "bdsp",
  "Legends: Arceus": "pla",
  "Scarlet / Violet": "sv",
  "Legends: Z-A": "za",
};

/** The family of a screenshot's game label, or null for a label that isn't a known game. */
export function familyOfGame(game: string): GeoFamilyId | null {
  return GAME_FAMILY[game.trim()] ?? null;
}

/** The families a filter lets through: an era, optionally narrowed to some families (none picked: the whole era). */
export function allowedFamilies(filter: { era?: GeoEra; families?: readonly string[] }): Set<GeoFamilyId> {
  const inEra = GEO_FAMILY_IDS.filter((id) => !filter.era || familyEra(id) === filter.era);
  const picked = (filter.families ?? []).filter(isGeoFamily);
  return new Set(picked.length ? inEra.filter((id) => picked.includes(id)) : inEra);
}

/**
 * A filter's families as the server keeps them: known ids, in release order,
 * without repeats, and only those in the era. Undefined when they add nothing
 * to the era (none picked, or all of the era's).
 */
export function normalizeFamilies(era: GeoEra | undefined, families: readonly string[] | undefined): GeoFamilyId[] | undefined {
  const inEra = GEO_FAMILY_IDS.filter((id) => !era || familyEra(id) === era);
  const picked = inEra.filter((id) => families?.includes(id));
  return picked.length && picked.length < inEra.length ? picked : undefined;
}

/** How a region's places are spread over the families: "rby,frlg" → places whose screenshots are from exactly those families. */
export type FamilyCombos = Record<string, number>;

/** Places on a map that a filter can play: those with a screenshot from any family it lets through. */
export function placesFor(combos: FamilyCombos, filter: { era?: GeoEra; families?: readonly string[] }): number {
  const allowed = allowedFamilies(filter);
  let n = 0;
  for (const [combo, count] of Object.entries(combos)) if (combo.split(",").some((id) => allowed.has(id as GeoFamilyId))) n += count;
  return n;
}

/** Points for naming the screenshot's game family (the "guess the game too" bonus), per round. */
export const GEO_GAME_BONUS = 1000;
