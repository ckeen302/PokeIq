/**
 * Pokémon Hunt answer table: the hand-written rules the build applies.
 * Every table here is small and reviewable; anything the build can't place
 * with these rules is left out and listed in src/data/hunt/review.json.
 *
 * See docs/hunt/spec.md (section 3) for the accuracy rules these implement.
 */

/**
 * Version → the geo.json regions its places can be in. Legends: Arceus (Hisui)
 * isn't on the map, so it maps to nothing and its rows are left out.
 * Legends: Z-A is handled separately: every Z-A place is Lumiose City (Kalos).
 */
export const VERSION_REGIONS: Record<string, string[]> = {
  red: ["Kanto"], blue: ["Kanto"], yellow: ["Kanto"],
  gold: ["Johto", "Kanto"], silver: ["Johto", "Kanto"], crystal: ["Johto", "Kanto"],
  ruby: ["Hoenn"], sapphire: ["Hoenn"], emerald: ["Hoenn"],
  firered: ["Kanto", "Sevii Islands"], leafgreen: ["Kanto", "Sevii Islands"],
  diamond: ["Sinnoh"], pearl: ["Sinnoh"], platinum: ["Sinnoh"],
  heartgold: ["Johto", "Kanto"], soulsilver: ["Johto", "Kanto"],
  black: ["Unova"], white: ["Unova"], "black-2": ["Unova"], "white-2": ["Unova"],
  x: ["Kalos"], y: ["Kalos"],
  "omega-ruby": ["Hoenn"], "alpha-sapphire": ["Hoenn"],
  sun: ["Alola"], moon: ["Alola"], "ultra-sun": ["Alola"], "ultra-moon": ["Alola"],
  "lets-go-pikachu": ["Kanto"], "lets-go-eevee": ["Kanto"],
  sword: ["Galar", "Isle of Armor", "Crown Tundra"], shield: ["Galar", "Isle of Armor", "Crown Tundra"],
  "brilliant-diamond": ["Sinnoh"], "shining-pearl": ["Sinnoh"],
  "legends-arceus": [],
  scarlet: ["Paldea", "Kitakami", "Blueberry Academy"], violet: ["Paldea", "Kitakami", "Blueberry Academy"],
  "legends-za": ["Kalos"],
};

/** Every Legends: Z-A place (districts, Wild Zones, the sewers, Lysandre Labs…) is inside Lumiose City. */
export const ZA_PLACE = { region: "Kalos", name: "Lumiose City" } as const;

/**
 * Methods: the reveal's label for each counted method, `null` for a method left out.
 * A method that isn't in this table makes the row uncertain (the Pokémon is left out).
 *
 * Only normal wild encounters count (Hunt v2, the owner's rules): walking in grass and tall
 * grass, caves, surfing, fishing with a rod, and the visible Pokémon that wander the overworld.
 * Everything a player has to know a trick, an item, a device or an event for is left out:
 * Poké Radar, DexNav, Hidden Grottoes, berry trees, Headbutt, Rock Smash, honey trees,
 * hordes, SOS calls, the shaking grass, dust clouds and rippling water of Unova, ambushes,
 * swarms, Max Raids, every one-off scripted or fixed encounter (Static, Interact, Poké Flute,
 * Devon Scope, Squirt Bottle, Wailmer Pail), gifts, eggs, trades and the rest.
 */
export const METHODS: Record<string, string | null> = {
  // Walking in grass (every game's kinds of tall grass: Unova's dark grass, Kalos's flowers and rough terrain, Galar's swamp).
  Grass: "Grass", "Tall grass": "Grass", "Grass (random)": "Grass", "Dark grass": "Grass",
  "Yellow Flowers": "Grass", "Yellow flowers": "Grass", "Purple Flowers": "Grass", "Purple flowers": "Grass",
  "Red Flowers": "Grass", "Red flowers": "Grass", "Rough terrain": "Grass", Swamp: "Grass",
  /** Let's Go's rarer spawns: still Pokémon you see in the grass and walk into. */
  "Grass - Rare Spawns": "Grass",
  // Caves.
  Cave: "Cave",
  // Water: surfing, and fishing with a rod.
  Surf: "Surf", Water: "Surf", "Surf Details": "Surf", "Surf - Blocks Details": "Surf", "Water - Rare Spawns": "Surf",
  "Old Rod": "Old Rod", "Good Rod": "Good Rod", "Super Rod": "Super Rod",
  /** Unova's fishing spots, Alola's bubbling fishing spots, Feebas's tiles: a rod cast where the game lets you fish. */
  Fishing: "Fishing", "Fishing spot": "Fishing", "Bubbling spot": "Fishing", "Feebas tile": "Fishing",
  // Pokémon you see wandering the world (Let's Go, Sword / Shield, Scarlet / Violet, Legends: Z-A).
  Wild: "Overworld", Overworld: "Overworld", "In the Sky": "Overworld", "In the Sky - Rare Spawns": "Overworld", Flying: "Overworld",
  Wandering: "Overworld", "Wandering Surf": "Overworld",

  // ---- Left out: needs a device, an item, a trick or an event ----
  PokeRadar: null, DexNav: null, "Hidden Grotto": null,
  "Rustling grass": null, "Dust cloud": null, "Rippling water": null, Dive: null,
  Headbutt: null, "Headbutt (low)": null, "Headbutt (high)": null,
  "Berry Tree": null, "Berry tree": null, "Berry pile": null, "Shaking tree": null,
  "Rock Smash": null,
  "Honey tree": null, "Honey Tree": null, "Honey Tree - Rare": null, "Honey Tree - Very Rare": null,
  Horde: null, "SOS call": null, "SOS (bubbling spot)": null,
  "Ground ambush": null, "Sky ambush": null, "Ceiling ambush": null, "Trash can ambush": null,
  "Rustling bush ambush": null, "Bridge shadow": null, "Special encounter": null,
  // One-off scripted or fixed encounters.
  Static: null, Interact: null, "Interact At Night": null,
  "Poké Flute": null, "Devon Scope": null, "Squirt Bottle": null, "Wailmer Pail": null,
  // Galar's dens.
  "Max Raid": null,
  // Not a spot on the map, or not met in the wild.
  Gift: null, "Gift (Egg)": null, Trade: null, Curry: null, "Tera Raid": null, Hyperspace: null, Underground: null,
  "Massive mass outbreak": null, Roaming: null, "Roaming (water)": null,
  /** Swarms and mass outbreaks: a random, short-lived event, not a standing spot (rows with a "Swarm" note are left out too). */
  Swarm: null, "Swarm - Fish": null, "Swarm - Surf": null,
  /** Sun/Moon's Island Scan: a once-a-day scan feature, not a normal wild spot. */
  "Island Scan": null,
  /** Gen 4 dual-slot: only with a Game Boy Advance cartridge in the second slot. */
  Ruby: null, Sapphire: null, Emerald: null, FireRed: null, LeafGreen: null,
  "Colosseum bonus disc jpn": null, "Colosseum bonus disc us": null, "Pokemon channel pal": null, "Pokemon ranger": null,
};

/** A place Bulbapedia and Serebii both list as a wild spot without naming the method (see AGREED_NEEDS_WILD). */
export const AGREED_LABEL_WILD = "Wild";

/** The labels a counted method can carry: the reveal's and the place hint's vocabulary. */
export const COUNTED_LABELS = ["Grass", "Cave", "Surf", "Old Rod", "Good Rod", "Super Rod", "Fishing", "Overworld", AGREED_LABEL_WILD] as const;

/**
 * A method label one of the two sources gave a place both list (scripts/hunt/make-agreed.ts), as
 * the build counts it: a counted label, or null when the source's label is one the rules leave out.
 */
export const AGREED_LABELS: Record<string, string | null> = {
  Grass: "Grass", Cave: "Cave", Surf: "Surf", "Old Rod": "Old Rod", "Good Rod": "Good Rod", "Super Rod": "Super Rod", Fishing: "Fishing",
  Overworld: "Overworld", Wandering: "Overworld",
};

/**
 * A place Bulbapedia and Serebii both list that the data lacks, when neither names the method, is
 * added only for a species already met in the wild in that game (so it's a wild spot the data
 * missed, not a gift or a one-off), under the label of its own wild rows there.
 */
export const AGREED_NEEDS_WILD = true;

/** Max Raid dens only ever happen in Sword and Shield; they're left out now, but a den row in another game is still a data error. */
export const MAX_RAID_VERSIONS = new Set(["sword", "shield"]);

/**
 * Places that aren't spots on the map (rule 1): rows here are left out, they never
 * count against a Pokémon. Compared after normPlace().
 */
export const OFF_MAP_PLACES = [
  "Hyperspace Lumiose", "Tera Raid Battles", "Grand Underground", "Friend Safari",
  "Ultra Space Wilds", "Ultra Space", "Ultra Deep Sea", "Ultra Megalopolis", "Ultra Ruin", "Ultra Desert",
  "Ultra Crater", "Ultra Forest", "Ultra Jungle", "Ultra Plant",
  "Pokewalker", "Pal Park", "Dream World",
];

/**
 * Names that differ between the encounter data and the map, per region. Each is the same
 * place under another name (checked by hand); a name maps only within that region.
 */
export const PLACE_ALIASES: { region: string; from: string; to: string; versions?: string[]; why: string }[] = [
  { region: "Kanto", from: "Safari Zone", to: "Safari Zone / Pal Park", versions: ["red", "blue", "yellow", "firered", "leafgreen"], why: "Kanto's Safari Zone in Fuchsia City; the map names it with Pal Park, which replaced it" },
  { region: "Unova", from: "Victory Road", to: "Victory Road (B2W2)", versions: ["black-2", "white-2"], why: "the map's Victory Road is Black 2 / White 2's (Black / White's is a different cave, not on the map)" },
  { region: "Alola", from: "Lake of the Sunne", to: "Lake of the Sunne / Moone", why: "one map place for the lake in both games" },
  { region: "Alola", from: "Lake of the Moone", to: "Lake of the Sunne / Moone", why: "one map place for the lake in both games" },
  { region: "Alola", from: "Altar of the Sunne", to: "Altar of the Sunne / Moone", why: "one map place for the altar in both games" },
  { region: "Alola", from: "Altar of the Moone", to: "Altar of the Sunne / Moone", why: "one map place for the altar in both games" },
  { region: "Unova", from: "Black City", to: "Black City / White Forest", why: "one map place for both" },
  { region: "Hoenn", from: "Team Magma Hideout", to: "Magma Hideout (Jagged Pass)", why: "the same hideout; the map files it under Jagged Pass" },
  { region: "Hoenn", from: "Aqua Hideout", to: "Team Aqua Hideout", why: "the same hideout" },
  { region: "Sinnoh", from: "Trophy Garden", to: "Pokémon Mansion", why: "Bulbapedia: the Trophy Garden is part of the Pokémon Mansion, behind it on Route 212" },
  { region: "Johto", from: "Tin Tower", to: "Bell Tower", why: "Gold / Silver / Crystal's name for the Bell Tower" },
  { region: "Johto", from: "Mt. Silver Cave", to: "Mt. Silver", why: "the cave inside Mt. Silver" },
  { region: "Kalos", from: "Unknown Dungeon", to: "Pokémon Village", versions: ["x", "y"], why: "Bulbapedia gives the Unknown Dungeon's location as Pokémon Village: a small cave reached from the village" },
];

/**
 * Places a name matches on the map that are a different place in these games: no match.
 * Omega Ruby / Alpha Sapphire's Mirage spots appear in many places around Hoenn, not where
 * Ruby / Sapphire / Emerald's Mirage Island (the map's) is.
 */
export const NOT_THE_SAME: { versions: string[]; loc: string; why: string }[] = [
  { versions: ["omega-ruby", "alpha-sapphire"], loc: "Mirage Island", why: "Omega Ruby / Alpha Sapphire's Mirage Islands move around Hoenn; the map's Mirage Island is Ruby / Sapphire / Emerald's" },
];

/**
 * Encounters that need an event (a ticket, a pass, a QR code, another game's save data or key),
 * left out by rule 1. `loc` and `versions` narrow a row; leaving one out means every row.
 * Each is from Bulbapedia's location table for that Pokémon.
 */
export const EVENT_ONLY: { dex: number; versions?: string[]; loc?: string; why: string }[] = [
  { dex: 151, loc: "Faraway Island", why: "Old Sea Map event" },
  { dex: 172, versions: ["heartgold", "soulsilver"], loc: "Ilex Forest", why: "Spiky-eared Pichu event" },
  { dex: 249, loc: "Navel Rock", why: "Mystic Ticket event" },
  { dex: 250, loc: "Navel Rock", why: "Mystic Ticket event" },
  { dex: 380, versions: ["ruby", "sapphire", "emerald"], loc: "Southern Island", why: "Eon Ticket event" },
  { dex: 381, versions: ["ruby", "sapphire", "emerald"], loc: "Southern Island", why: "Eon Ticket event" },
  { dex: 380, versions: ["omega-ruby"], loc: "Southern Island", why: "Eon Ticket event (the other game gives it as a gift)" },
  { dex: 381, versions: ["alpha-sapphire"], loc: "Southern Island", why: "Eon Ticket event (the other game gives it as a gift)" },
  { dex: 380, versions: ["heartgold", "soulsilver"], loc: "Pewter City", why: "Enigma Stone event" },
  { dex: 381, versions: ["heartgold", "soulsilver"], loc: "Pewter City", why: "Enigma Stone event" },
  { dex: 386, loc: "Birth Island", why: "Aurora Ticket event" },
  { dex: 491, why: "Member Card event (or another game's save data in Brilliant Diamond / Shining Pearl)" },
  { dex: 492, why: "Oak's Letter event (or another game's save data in Brilliant Diamond / Shining Pearl)" },
  { dex: 493, why: "Azure Flute event (or another game's save data in Brilliant Diamond / Shining Pearl)" },
  { dex: 494, versions: ["black", "white"], loc: "Liberty Garden", why: "Liberty Pass event" },
  { dex: 801, versions: ["ultra-sun", "ultra-moon"], why: "QR Scanner event" },
  { dex: 378, versions: ["black-2"], loc: "Underground Ruins", why: "needs the Iceberg Key, which only White 2 unlocks (another game's Key System)" },
  { dex: 379, versions: ["white-2"], loc: "Underground Ruins", why: "needs the Iron Key, which only Black 2 unlocks (another game's Key System)" },
];

/** FireRed / LeafGreen and Emerald's Altering Cave only has Zubat without a Mystery Gift event. */
export const ALTERING_CAVE = { versions: ["firered", "leafgreen", "emerald"], loc: "Altering Cave", normal: [41] };
