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

/** Emerald / Ruby / Sapphire: the villains' hideouts and Mirage Island. */
const HOENN3: Record<string, Alias> = {
  "team magma hideout": { area: "Magma Hideout", why: "PokéAPI splits the hideout's statics into a 'Team Magma Hideout' location; the game calls it MAGMA HIDEOUT" },
  "team aqua hideout": { area: "Aqua Hideout", why: "PokéAPI's 'Team Aqua Hideout'; the game (and Serebii) call it AQUA HIDEOUT" },
  "mirage island": { area: "Route 130", sub: "Mirage Island", why: "Mirage Island appears on Route 130: Bulbapedia's Route 130 page lists its Wynaut (and PokéAPI files them under Route 130)" },
  hoenn: { area: "Roaming Hoenn", why: "Serebii lists the roaming Latias/Latios under 'Hoenn'; PokéAPI under Roaming Hoenn" },
};

const GSC: Record<string, Alias> = {
  "bell tower": { area: "Tin Tower", why: "PokéAPI uses HeartGold/SoulSilver's name; in Gold, Silver and Crystal it is Tin Tower (Serebii, Bulbapedia's walkthrough)" },
  "silver cave": { area: "Mt. Silver", why: "Serebii's Silver Cave is the cave of Mt. Silver (PokéAPI and Bulbapedia's walkthrough: Mt. Silver)" },
  "rocket hideout": { area: "Team Rocket HQ", why: "Serebii's Rocket Hideout is Mahogany Town's Team Rocket HQ (PokéAPI)" },
  "team rockets hideout": { area: "Team Rocket HQ", why: "Bulbapedia's walkthrough heading for Mahogany Town's Team Rocket HQ" },
};
const SINNOH4: Record<string, Alias> = {
  "ruins maniacs cave": { area: "Ruin Maniac Cave", why: "Serebii's spelling of PokéAPI's Ruin Maniac Cave" },
  "ruins maniacs tunnel": { area: "Maniac Tunnel", why: "Serebii's spelling of PokéAPI's Maniac Tunnel" },
};
const ALOLA7: Record<string, Alias> = {};

export const ALIASES: Record<string, Record<string, Alias>> = {
  emerald: HOENN3,
  "ruby-sapphire": HOENN3,
  "omega-ruby-alpha-sapphire": { "team magma hideout": HOENN3["team magma hideout"], "team aqua hideout": HOENN3["team aqua hideout"] },
  "gold-silver": GSC,
  crystal: GSC,
  "diamond-pearl": SINNOH4,
  platinum: SINNOH4,
  "heartgold-soulsilver": {
    "route 47 inside cave": { area: "Cliff Cave", why: "PokéAPI files Cliff Cave under Route 47 ('inside cave'); Serebii and Bulbapedia name it Cliff Cave" },
    "route 47 cave gate": { area: "Cliff Edge Gate", why: "PokéAPI files Cliff Edge Gate under Route 47 ('cave gate'); Serebii and Bulbapedia name it Cliff Edge Gate" },
  },
  "black-2-white-2": {
    "nature sanctuary": { area: "Nature Preserve", why: "PokéAPI's 'Nature Sanctuary' is Black 2/White 2's Nature Preserve (Serebii, Bulbapedia)" },
    "victory road b2w2": { area: "Victory Road", why: "Serebii's 'Victory Road B2W2' is the game's Victory Road" },
    "rocky mountain room": { area: "Underground Ruins", sub: "Rocky Mountain Room", why: "Regirock's room is in the Underground Ruins (Bulbapedia's Underground Ruins page)" },
    "glacier room": { area: "Underground Ruins", sub: "Glacier Room", why: "Regice's room is in the Underground Ruins (Bulbapedia's Underground Ruins page)" },
    "iron room": { area: "Underground Ruins", sub: "Iron Room", why: "Registeel's room is in the Underground Ruins (Bulbapedia's Underground Ruins page)" },
  },
  // Serebii names a zone's space-time distortion as a place of its own; it is an event in the zone.
  "legends-arceus": Object.fromEntries(
    ["Obsidian Fieldlands", "Crimson Mirelands", "Cobalt Coastlands", "Coronet Highlands", "Alabaster Icelands"].map((z) => [
      `space time distortion in ${z.toLowerCase()}`,
      { area: z, sub: `Space-time Distortion in ${z}`, why: "a space-time distortion is an event in its zone" },
    ]),
  ),
  // Serebii names a few sectors of Lumiose's districts as places of their own (one Pokémon each); the walkthrough's
  // "Wild Zones 18" heading is Wild Zone 18.
  "legends-za": {
    "rouge district rouge sector 2": { area: "Rouge District", sub: "Rouge Sector 2", why: "a sector of Rouge District" },
    "magenta district magenta sector 8": { area: "Magenta District", sub: "Magenta Sector 8", why: "a sector of Magenta District" },
    "rouge district rouge sector 1": { area: "Rouge District", sub: "Rouge Sector 1", why: "a sector of Rouge District" },
    "rouge sector 1": { area: "Rouge District", sub: "Rouge Sector 1", why: "a sector of Rouge District" },
    "wild zones 18": { area: "Wild Zone 18", why: "the walkthrough's heading for Wild Zone 18" },
  },
  "sword-shield": {
    "isle of armor": { area: "Roaming the Isle of Armor", why: "Serebii's place for Galarian Moltres, PokéAPI's roaming-isle-of-armor" },
    "crown tundra": { area: "Roaming the Crown Tundra", why: "Serebii's place for Galarian Articuno, PokéAPI's roaming-crown-tundra" },
    "wild area": { area: "Roaming Galar Wild Areas", why: "Serebii's place for Galarian Zapdos, PokéAPI's roaming-galar-wild-area" },
  },
  "scarlet-violet": { "alfornado cavern": { area: "Alfornada Cavern", why: "Serebii's misspelling of Alfornada Cavern" } },
  "x-y": { roaming: { area: "Roaming Kalos", why: "PokéAPI's '(Roaming)' location: the roaming legendary bird" } },
  "sun-moon": ALOLA7,
  "ultra-sun-ultra-moon": ALOLA7,
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
  "omega-ruby-alpha-sapphire": { "magma hideout": ["Team Magma Hideout"], "aqua hideout": ["Team Aqua Hideout"] },


};

/** A part of an area a source doesn't name, where the place itself says which part it is. */
export interface SubRule {
  games: string[];
  /** Area key. */
  area: string;
  method: RegExp;
  sub: string;
  why: string;
}
export const SUB_RULES: SubRule[] = [
  { games: ["emerald", "ruby-sapphire"], area: "route 130", method: /^(Walking|Grass)$/, sub: "Mirage Island", why: "Route 130's only land is Mirage Island (Bulbapedia's Route 130 table)" },
];

/** PokéAPI locations whose English name is wrong in PokéAPI (by location slug) -> the place's name. */
export const API_NAMES: Record<string, { name: string; why: string }> = {
  "thrifty-megamart": { name: "Thrifty Megamart", why: "PokéAPI names this location 'Royal Avenue'; its encounters are the abandoned Thrifty Megamart's (Serebii, Bulbapedia)" },
};

/** Serebii labels that are not one place (they list a method across many places). */
export const NOT_A_PLACE = new Set(["honey trees", "tera raid battles", "all over paldea", "dynamax adventures", "everywhere"]);
/** PokéAPI's placeholder locations ("Unknown; all bugs"). */
export const PLACEHOLDER = /^Unknown; /;

/** PokéAPI places that don't exist in that game (PokéAPI data errors), by game and place key. */
export const DATA_ERRORS: Record<string, Record<string, string>> = {
  "black-white": { "team flare secret hq": "a Kalos place: PokéAPI files Black/White's Tornadus and Thundurus there (they roam Unova: Serebii, Bulbapedia)" },
  "sun-moon": { "new mauville": "a Hoenn place: PokéAPI lists Voltorb and Electrode there for Sun" },
  "ultra-sun-ultra-moon": { "new mauville": "a Hoenn place: PokéAPI lists Voltorb and Electrode there" },
};

/**
 * Serebii rows (where Serebii is a game's only encounter source) that Bulbapedia contradicts twice over: the place's
 * table and the Pokémon's own availability list both leave the Pokémon out there. Per game: [place key, species, why].
 */
export const SEREBII_ERRORS: Record<string, [string, number, string][]> = {
  "brilliant-diamond-shining-pearl": [
    [
      "victory road",
      223,
      "Serebii lists Remoraid for Victory Road's Good Rod; Bulbapedia's Victory Road table has Magikarp only (https://bulbapedia.bulbagarden.net/wiki/Sinnoh_Victory_Road) and Remoraid's availability names Routes 213, 222, 223, 224 and 230, Pastoria City, Sunyshore City and the Pokémon League, not Victory Road (https://bulbapedia.bulbagarden.net/wiki/Remoraid_(Pok%C3%A9mon))",
    ],
  ],
};

/** PokéAPI rows Bulbapedia shows at another place: per game, [place key, species, why]. */
export const API_ROW_ERRORS: Record<string, [string, number, string][]> = {
  "sword-shield": [
    [
      "energy plant",
      888,
      "PokéAPI files Zacian at the Energy Plant, where it fights beside the player against Eternatus; it is caught in the Slumbering Weald after the main story (https://bulbapedia.bulbagarden.net/wiki/Slumbering_Weald)",
    ],
    [
      "energy plant",
      889,
      "PokéAPI files Zamazenta at the Energy Plant, where it fights beside the player against Eternatus; it is caught in the Slumbering Weald after the main story (https://bulbapedia.bulbagarden.net/wiki/Slumbering_Weald)",
    ],
  ],
};
