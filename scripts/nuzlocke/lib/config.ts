/**
 * The games the Nuzlocke Tracker covers and, for each, where its data comes from. The names and version ids here are
 * the contract with src/lib/nuzlocke/games.ts (which copies the public part).
 */
import type { NuzVersion } from "../../../src/lib/nuzlocke/model";

export type SerebiiSource = "lgpe" | "swsh" | "bdsp" | "la" | "sv" | "za";

export interface GameCfg {
  id: string;
  name: string;
  gen: number;
  region: string;
  versions: NuzVersion[];
  /** Bulbapedia walkthrough (index page). */
  walkthrough: string;
  /** PokéAPI version name -> our version id, when PokéAPI has this game's encounters. */
  pokeapi?: Record<string, string>;
  /** Serebii per-generation location pages used to cross-check PokéAPI (scripts/dex/serebii-loc.ts LOC_PAGES key). */
  serebiiLoc?: "rby" | "gs" | "rs" | "dp" | "bw" | "xy" | "sm";
  /** Serebii species pages that are this game's source (Let's Go and Gen 8-9). */
  serebii?: SerebiiSource;
  /** Bulbapedia {{Catch/entry…}} template(s) of this game (scripts/nuzlocke/lib/bulba-catch.ts SPECS). */
  bulba: string[];
  /** Region names used in Bulbapedia's location titles ("Kanto Route 1"). */
  bulbaRegions: string[];
}

const V = (id: string, name: string): NuzVersion => ({ id, name });
const same = (...ids: string[]) => Object.fromEntries(ids.map((i) => [i, i]));

/** In release order (Japanese release), newest last. */
export const GAMES: GameCfg[] = [
  { id: "red-blue", name: "Red & Blue", gen: 1, region: "Kanto", versions: [V("red", "Red"), V("blue", "Blue")], walkthrough: "Walkthrough:Pokémon Red and Blue", pokeapi: same("red", "blue"), serebiiLoc: "rby", bulba: ["entry1"], bulbaRegions: ["Kanto"] },
  { id: "yellow", name: "Yellow", gen: 1, region: "Kanto", versions: [V("yellow", "Yellow")], walkthrough: "Walkthrough:Pokémon Yellow", pokeapi: same("yellow"), serebiiLoc: "rby", bulba: ["entry1"], bulbaRegions: ["Kanto"] },
  { id: "gold-silver", name: "Gold & Silver", gen: 2, region: "Johto", versions: [V("gold", "Gold"), V("silver", "Silver")], walkthrough: "Walkthrough:Pokémon Gold and Silver", pokeapi: same("gold", "silver"), serebiiLoc: "gs", bulba: ["entry2"], bulbaRegions: ["Johto", "Kanto"] },
  { id: "crystal", name: "Crystal", gen: 2, region: "Johto", versions: [V("crystal", "Crystal")], walkthrough: "Walkthrough:Pokémon Crystal", pokeapi: same("crystal"), serebiiLoc: "gs", bulba: ["entry2"], bulbaRegions: ["Johto", "Kanto"] },
  { id: "ruby-sapphire", name: "Ruby & Sapphire", gen: 3, region: "Hoenn", versions: [V("ruby", "Ruby"), V("sapphire", "Sapphire")], walkthrough: "Walkthrough:Pokémon Ruby and Sapphire", pokeapi: same("ruby", "sapphire"), serebiiLoc: "rs", bulba: ["entry3"], bulbaRegions: ["Hoenn"] },
  { id: "firered-leafgreen", name: "FireRed & LeafGreen", gen: 3, region: "Kanto", versions: [V("firered", "FireRed"), V("leafgreen", "LeafGreen")], walkthrough: "Walkthrough:Pokémon FireRed and LeafGreen", pokeapi: same("firered", "leafgreen"), serebiiLoc: "rs", bulba: ["entryfl", "entry3a"], bulbaRegions: ["Kanto", "Sevii Islands"] },
  { id: "emerald", name: "Emerald", gen: 3, region: "Hoenn", versions: [V("emerald", "Emerald")], walkthrough: "Walkthrough:Pokémon Emerald", pokeapi: same("emerald"), serebiiLoc: "rs", bulba: ["entry3", "entry3a"], bulbaRegions: ["Hoenn"] },
  { id: "diamond-pearl", name: "Diamond & Pearl", gen: 4, region: "Sinnoh", versions: [V("diamond", "Diamond"), V("pearl", "Pearl")], walkthrough: "Walkthrough:Pokémon Diamond and Pearl", pokeapi: same("diamond", "pearl"), serebiiLoc: "dp", bulba: ["entry4"], bulbaRegions: ["Sinnoh"] },
  { id: "platinum", name: "Platinum", gen: 4, region: "Sinnoh", versions: [V("platinum", "Platinum")], walkthrough: "Walkthrough:Pokémon Platinum", pokeapi: same("platinum"), serebiiLoc: "dp", bulba: ["entry4"], bulbaRegions: ["Sinnoh"] },
  { id: "heartgold-soulsilver", name: "HeartGold & SoulSilver", gen: 4, region: "Johto", versions: [V("heartgold", "HeartGold"), V("soulsilver", "SoulSilver")], walkthrough: "Walkthrough:Pokémon HeartGold and SoulSilver", pokeapi: same("heartgold", "soulsilver"), serebiiLoc: "dp", bulba: ["entryhs"], bulbaRegions: ["Johto", "Kanto"] },
  { id: "black-white", name: "Black & White", gen: 5, region: "Unova", versions: [V("black", "Black"), V("white", "White")], walkthrough: "Walkthrough:Pokémon Black and White", pokeapi: same("black", "white"), serebiiLoc: "bw", bulba: ["entry5"], bulbaRegions: ["Unova"] },
  { id: "black-2-white-2", name: "Black 2 & White 2", gen: 5, region: "Unova", versions: [V("black-2", "Black 2"), V("white-2", "White 2")], walkthrough: "Walkthrough:Pokémon Black 2 and White 2", pokeapi: same("black-2", "white-2"), serebiiLoc: "bw", bulba: ["entry5-2"], bulbaRegions: ["Unova"] },
  { id: "x-y", name: "X & Y", gen: 6, region: "Kalos", versions: [V("x", "X"), V("y", "Y")], walkthrough: "Walkthrough:Pokémon X and Y", pokeapi: same("x", "y"), serebiiLoc: "xy", bulba: ["entry6"], bulbaRegions: ["Kalos"] },
  { id: "omega-ruby-alpha-sapphire", name: "Omega Ruby & Alpha Sapphire", gen: 6, region: "Hoenn", versions: [V("omega-ruby", "Omega Ruby"), V("alpha-sapphire", "Alpha Sapphire")], walkthrough: "Walkthrough:Pokémon Omega Ruby and Alpha Sapphire", pokeapi: same("omega-ruby", "alpha-sapphire"), serebiiLoc: "xy", bulba: ["entryoras"], bulbaRegions: ["Hoenn"] },
  { id: "sun-moon", name: "Sun & Moon", gen: 7, region: "Alola", versions: [V("sun", "Sun"), V("moon", "Moon")], walkthrough: "Walkthrough:Pokémon Sun and Moon", pokeapi: same("sun", "moon"), serebiiLoc: "sm", bulba: ["entry7"], bulbaRegions: ["Alola"] },
  { id: "ultra-sun-ultra-moon", name: "Ultra Sun & Ultra Moon", gen: 7, region: "Alola", versions: [V("ultra-sun", "Ultra Sun"), V("ultra-moon", "Ultra Moon")], walkthrough: "Walkthrough:Pokémon Ultra Sun and Ultra Moon", pokeapi: same("ultra-sun", "ultra-moon"), serebiiLoc: "sm", bulba: ["entryusum"], bulbaRegions: ["Alola"] },
  { id: "lets-go-pikachu-eevee", name: "Let's Go, Pikachu! & Let's Go, Eevee!", gen: 7, region: "Kanto", versions: [V("lets-go-pikachu", "Let's Go, Pikachu!"), V("lets-go-eevee", "Let's Go, Eevee!")], walkthrough: "Walkthrough:Pokémon Let's Go, Pikachu! and Let's Go, Eevee!", pokeapi: same("lets-go-pikachu", "lets-go-eevee"), serebii: "lgpe", bulba: ["entrype"], bulbaRegions: ["Kanto"] },
  {
    id: "sword-shield",
    name: "Sword & Shield",
    gen: 8,
    region: "Galar",
    versions: [V("sword", "Sword"), V("shield", "Shield")],
    walkthrough: "Walkthrough:Pokémon Sword and Shield",
    pokeapi: { sword: "sword", shield: "shield", "the-isle-of-armor-sword": "sword", "the-isle-of-armor-shield": "shield", "the-crown-tundra-sword": "sword", "the-crown-tundra-shield": "shield" },
    serebii: "swsh",
    bulba: ["entry8"],
    bulbaRegions: ["Galar"],
  },
  { id: "brilliant-diamond-shining-pearl", name: "Brilliant Diamond & Shining Pearl", gen: 8, region: "Sinnoh", versions: [V("brilliant-diamond", "Brilliant Diamond"), V("shining-pearl", "Shining Pearl")], walkthrough: "Walkthrough:Pokémon Brilliant Diamond and Shining Pearl", serebii: "bdsp", bulba: ["entrybdsp"], bulbaRegions: ["Sinnoh"] },
  { id: "legends-arceus", name: "Legends: Arceus", gen: 8, region: "Hisui", versions: [V("legends-arceus", "Legends: Arceus")], walkthrough: "Walkthrough:Pokémon Legends: Arceus", serebii: "la", bulba: ["entryla"], bulbaRegions: [] },
  { id: "scarlet-violet", name: "Scarlet & Violet", gen: 9, region: "Paldea", versions: [V("scarlet", "Scarlet"), V("violet", "Violet")], walkthrough: "Walkthrough:Pokémon Scarlet and Violet", serebii: "sv", bulba: ["entry9", "entry9/special"], bulbaRegions: ["Paldea"] },
  { id: "legends-za", name: "Legends: Z-A", gen: 9, region: "Kalos", versions: [V("legends-za", "Legends: Z-A")], walkthrough: "Walkthrough:Pokémon Legends: Z-A", serebii: "za", bulba: ["entryza"], bulbaRegions: ["Kalos"] },
];

export const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));
