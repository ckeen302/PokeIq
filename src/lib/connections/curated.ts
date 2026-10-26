import { FACTS, MOVES, type Facts } from "./facts";
import type { Category } from "./categories";

/**
 * PokéConnections' hand-checked lists: the facts a Pokémon's data can't
 * tell us (who a Gym Leader's ace is, which legendary is on a box, what a
 * name was borrowed from). Every entry is one Pokémon by name, checked
 * against the sources named above its list; entries I could not be sure of
 * are left out, not guessed. A Pokémon is only ever listed under the game
 * fact that is true of it in the main series (spin-offs and remakes with a
 * different cover star are not counted).
 *
 * Signature moves aren't typed in: the list names the moves and the
 * Pokédex snapshot decides who learns them, and tests/connections-wordplay.test.ts
 * checks that exactly one evolution family learns each move.
 */

/** [Pokémon, the line shown in the "Why?" panel]. */
export type CuratedEntry = readonly [name: string, why: string];

// Sources: Serebii's Gym Leader pages per generation,
// https://www.serebii.net/swordshield/gymleaders.shtml (Galar),
// https://www.serebii.net/scarletviolet/gymleaders.shtml (Paldea),
// and Poképédia's "Champion d'arène" / each leader's page for the older games
// (https://www.pokepedia.fr/Champion_d'Arène). Only the leader's final, highest-level
// Pokémon in their main-series gym battle, where no other gym leader has the
// same one as ace (Kingdra, Haxorus and Lucario are left out for that reason).
export const GYM_ACES: CuratedEntry[] = [
  ["Onix", "Brock's ace in Pewter City"],
  ["Starmie", "Misty's ace in Cerulean City"],
  ["Alakazam", "Sabrina's ace in Saffron City"],
  ["Miltank", "Whitney's ace in Goldenrod City"],
  ["Nosepass", "Roxanne's ace in Rustboro City"],
  ["Manectric", "Wattson's ace in Mauville City"],
  ["Torkoal", "Flannery's ace in Lavaridge Town"],
  ["Milotic", "Wallace's ace in Sootopolis City"],
  ["Roserade", "Gardenia's ace in Eterna City"],
  ["Bastiodon", "Byron's ace in Canalave City"],
  ["Mismagius", "Fantina's ace in Hearthome City"],
  ["Luxray", "Volkner's ace in Sunyshore City"],
  ["Abomasnow", "Candice's ace in Snowpoint City"],
  ["Leavanny", "Burgh's ace in Castelia City"],
  ["Zebstrika", "Elesa's ace in Nimbasa City"],
  ["Excadrill", "Clay's ace in Driftveil City"],
  ["Swanna", "Skyla's ace in Mistralton City"],
  ["Sylveon", "Valerie's ace in Laverre City"],
  ["Eldegoss", "Milo's ace in Turffield"],
  ["Drednaw", "Nessa's ace in Hulbury"],
  ["Centiskorch", "Kabu's ace in Motostoke"],
  ["Coalossal", "Gordie's ace in Circhester (Shield)"],
  ["Gengar", "Allister's ace in Stow-on-Side (Shield)"],
  ["Machamp", "Bea's ace in Stow-on-Side (Sword)"],
  ["Alcremie", "Opal's ace in Ballonlea"],
  ["Lapras", "Melony's ace in Circhester"],
  ["Duraludon", "Raihan's ace in Hammerlocke"],
  ["Sudowoodo", "Brassius's ace in Cascarrafa"],
  ["Bellibolt", "Iono's ace in Levincia"],
  ["Toxtricity", "Ryme's ace in Montenevera"],
  ["Altaria", "Grusha's ace in Glaseado"],
  ["Crabominable", "Kofu's ace in Medali"],
];

// Sources: each main game's box art on Serebii's game pages
// (https://www.serebii.net/games/), cross-checked with PokémonDB's game list
// (https://pokemondb.net/game). Gold, Silver, Crystal, Ruby, Sapphire, Emerald,
// Diamond, Pearl, Platinum, Black, White, Black 2, White 2, X, Y, Sun, Moon,
// Ultra Sun, Ultra Moon, Sword, Shield, Scarlet, Violet and Legends: Arceus.
export const BOX_LEGENDARIES: CuratedEntry[] = [
  ["Ho-Oh", "Gold and HeartGold"],
  ["Lugia", "Silver and SoulSilver"],
  ["Suicune", "Crystal"],
  ["Groudon", "Ruby and Omega Ruby"],
  ["Kyogre", "Sapphire and Alpha Sapphire"],
  ["Rayquaza", "Emerald"],
  ["Dialga", "Diamond"],
  ["Palkia", "Pearl"],
  ["Giratina", "Platinum"],
  ["Reshiram", "Black"],
  ["Zekrom", "White"],
  ["Kyurem", "Black 2 and White 2 (as Black and White Kyurem)"],
  ["Xerneas", "X"],
  ["Yveltal", "Y"],
  ["Solgaleo", "Sun"],
  ["Lunala", "Moon"],
  ["Necrozma", "Ultra Sun and Ultra Moon (as Dusk Mane and Dawn Wings)"],
  ["Zacian", "Sword"],
  ["Zamazenta", "Shield"],
  ["Koraidon", "Scarlet"],
  ["Miraidon", "Violet"],
  ["Arceus", "Legends: Arceus"],
];

// Sources: the English names' origins as given on Serebii's Pokédex pages
// (https://www.serebii.net/pokedex-swsh/applin/ and the like) and Poképédia's
// "Étymologie" sections (per species). Only
// names that plainly contain the food: apple, cherry, vanilla, pumpkin, chestnut,
// dough, bun, olive, tea, matcha, cream, milk, egg.
export const FOOD_NAMES: CuratedEntry[] = [
  ["Applin", "named after the apple"],
  ["Flapple", "apple"],
  ["Appletun", "apple"],
  ["Cherubi", "cherry"],
  ["Cherrim", "cherry"],
  ["Vanillite", "vanilla"],
  ["Vanillish", "vanilla"],
  ["Vanilluxe", "vanilla"],
  ["Pumpkaboo", "pumpkin"],
  ["Gourgeist", "gourd"],
  ["Chespin", "chestnut"],
  ["Chesnaught", "chestnut"],
  ["Fidough", "dough"],
  ["Dachsbun", "bun"],
  ["Smoliv", "olive"],
  ["Dolliv", "olive"],
  ["Arboliva", "olive"],
  ["Sinistea", "tea"],
  ["Polteageist", "tea"],
  ["Poltchageist", "matcha"],
  ["Sinistcha", "matcha"],
  ["Milcery", "milk"],
  ["Alcremie", "cream (à la crème)"],
  ["Exeggcute", "egg"],
  ["Exeggutor", "egg"],
  ["Dipplin", "apple (a candied, dipped apple)"],
  ["Hydrapple", "apple"],
  ["Pecharunt", "peach"],
];

/*
 * The guards: Pokémon a fan could argue into a list, so they never sit in
 * ANOTHER group beside it (a player who picks one isn't wrong, just not
 * what the list says). They are never in the group either.
 */

/** Other Gym Leaders' aces, shared aces and version or remake differences (Johto, Kanto in GSC, Hoenn, Sinnoh, Unova, Kalos, Paldea). */
export const GYM_ACE_GUARD = [
  "Pidgeotto", "Pidgeot", "Scyther", "Scizor", "Poliwrath", "Steelix", "Piloswine", "Mamoswine", "Kingdra", "Raichu", "Vileplume", "Victreebel", "Bellossom",
  "Tangela", "Weezing", "Muk", "Venomoth", "Arcanine", "Rapidash", "Magcargo", "Ninetales", "Rhydon", "Nidoking", "Persian", "Gyarados", "Exeggutor",
  "Kabutops", "Omastar", "Golem", "Hariyama", "Medicham", "Slaking", "Pelipper", "Swellow", "Solrock", "Lunatone", "Whiscash", "Magneton", "Rampardos",
  "Lucario", "Floatzel", "Drifblim", "Electivire", "Froslass", "Simisage", "Simisear", "Simipour", "Watchog", "Stoutland", "Scolipede", "Jellicent",
  "Haxorus", "Gigalith", "Vivillon", "Tyrunt", "Amaura", "Gogoat", "Heliolisk", "Meowstic", "Avalugg", "Teddiursa", "Ursaring", "Dudunsparce", "Florges",
  "Tinkaton", "Kilowattrel", "Klawf", "Rabsca", "Gholdengo",
];

/** Names with a food in them that the list leaves out as less plain (milk, pork, sweets, salt, honey, chilli...). */
export const FOOD_GUARD = [
  "Miltank", "Lechonk", "Oinkologne", "Slurpuff", "Swirlix", "Capsakid", "Scovillain", "Bounsweet", "Steenee", "Tsareena", "Nacli", "Naclstack",
  "Garganacl", "Munchlax", "Snorlax", "Sunkern", "Sunflora", "Combee", "Vespiquen", "Shuckle", "Tropius", "Farfetch’d", "Sirfetch’d",
];

// Sources: PokémonDB's move pages list every Pokémon that learns each move,
// https://pokemondb.net/move/<move name> (aeroblast, mist-ball, ...); Serebii's attackdex
// (https://www.serebii.net/attackdex-sv/) agrees. The Pokédex snapshot is checked in
// tests/connections-wordplay.test.ts.test.ts: each move is learned by exactly one evolution family.
export const SIGNATURE_MOVES: string[] = [
  "Aeroblast",
  "Mist Ball",
  "Luster Purge",
  "Origin Pulse",
  "Precipice Blades",
  "Dragon Ascent",
  "Doom Desire",
  "Psycho Boost",
  "Roar of Time",
  "Spacial Rend",
  "Magma Storm",
  "Crush Grip",
  "Shadow Force",
  "Lunar Dance",
  "Dark Void",
  "Seed Flare",
  "Judgment",
  "V-create",
  "Blue Flare",
  "Bolt Strike",
  "Glaciate",
  "Secret Sword",
  "Relic Song",
  "Techno Blast",
  "King’s Shield",
  "Flying Press",
  "Geomancy",
  "Oblivion Wing",
  "Diamond Storm",
  "Spirit Shackle",
  "Beak Blast",
  "Baneful Bunker",
  "Instruct",
  "Multi-Attack",
  "Sunsteel Strike",
  "Moongeist Beam",
  "Fleur Cannon",
  "Spectral Thief",
  "Plasma Fists",
  "Drum Beating",
  "Pyro Ball",
  "Tar Shot",
  "Grav Apple",
  "Apple Acid",
  "Aura Wheel",
  "Dragon Darts",
  "Stone Axe",
  "Dire Claw",
  "Torch Song",
  "Armor Cannon",
  "Gigaton Hammer",
  "Kowtow Cleave",
  "Make It Rain",
  "Collision Course",
  "Electro Drift",
  "Psystrike",
  "Raging Bull",
];

const BY_NAME = new Map(FACTS.map((f) => [f.name, f]));

/** The Pokémon a list names (throws on a name the Pokédex doesn't have: a typo). */
export function resolveEntries(list: readonly CuratedEntry[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const [name, why] of list) {
    const f = BY_NAME.get(name);
    if (!f) throw new Error(`Curated list: no Pokémon called ${name}`);
    out.set(f.id, why);
  }
  return out;
}

const MOVE_IDS = new Map(Object.entries(MOVES).map(([id, m]) => [m.name, Number(id)]));

/** The signature moves' ids in the snapshot (throws on a move it doesn't have). */
export function signatureMoveIds(): Map<number, string> {
  const out = new Map<number, string>();
  for (const name of SIGNATURE_MOVES) {
    const id = MOVE_IDS.get(name);
    if (id === undefined) throw new Error(`Curated list: no move called ${name}`);
    out.set(id, name);
  }
  return out;
}

function listCategory(id: string, label: string, rule: string, difficulty: number, list: readonly CuratedEntry[], guard?: readonly string[] | ((f: Facts) => boolean)): Category {
  const entries = resolveEntries(list);
  const near = Array.isArray(guard) ? resolveEntries(guard.map((n) => [n, ""] as const)) : null;
  const guardFn = typeof guard === "function" ? guard : near ? (f: Facts) => near.has(f.id) : undefined;
  return { id, family: "lore", label, rule, difficulty, test: (f) => entries.has(f.id), why: (f) => entries.get(f.id)!, ...(guardFn && { guard: guardFn }) };
}

export function curatedCategories(): Category[] {
  const moves = signatureMoveIds();
  const signature = (f: Facts) => [...moves].filter(([id]) => f.learnable.has(id)).map(([, name]) => name);
  return [
    listCategory("lore:ace", "Gym Leaders' aces", "Each is the final, strongest Pokémon of a Gym Leader in the main games.", 3.0, GYM_ACES, GYM_ACE_GUARD),
    // Any Legendary or Mythical (or a cover star like Pikachu, Eevee or a Kanto starter) could be argued onto some box.
    listCategory("lore:box", "Box-art legendaries", "Each is the legendary Pokémon on the cover of a main-series game.", 2.95, BOX_LEGENDARIES, (f) => f.legendary || f.mythical || [3, 6, 9, 25, 133].includes(f.id)),
    listCategory("lore:food", "Named after food", "Each name is built from a food: apple, cherry, vanilla, pumpkin, chestnut, dough, olive, tea, egg, peach...", 3.05, FOOD_NAMES, FOOD_GUARD),
    {
      id: "lore:move",
      family: "lore",
      label: "Signature move",
      rule: "Each learns a move that no other evolution family can learn.",
      difficulty: 3.35,
      test: (f) => signature(f).length > 0,
      why: (f) => `the only one to learn ${signature(f).join(" and ")}`,
    },
  ];
}
