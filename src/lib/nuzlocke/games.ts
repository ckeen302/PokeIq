/**
 * The Nuzlocke Tracker's games, in release order (newest last), and their data loader. Each game's data is its own
 * JSON chunk (src/data/nuzlocke/{id}.json, built by scripts/nuzlocke/build.ts), loaded on demand.
 */
import type { NuzGame, NuzVersion } from "./model";

export interface NuzGameInfo {
  id: string;
  name: string;
  gen: number;
  region: string;
  versions: NuzVersion[];
}

const V = (id: string, name: string): NuzVersion => ({ id, name });

/** Every game with data, in release order (Japanese release), newest last. */
export const NUZ_GAMES: NuzGameInfo[] = [
  { id: "red-blue", name: "Red & Blue", gen: 1, region: "Kanto", versions: [V("red", "Red"), V("blue", "Blue")] },
  { id: "yellow", name: "Yellow", gen: 1, region: "Kanto", versions: [V("yellow", "Yellow")] },
  { id: "gold-silver", name: "Gold & Silver", gen: 2, region: "Johto", versions: [V("gold", "Gold"), V("silver", "Silver")] },
  { id: "crystal", name: "Crystal", gen: 2, region: "Johto", versions: [V("crystal", "Crystal")] },
  { id: "ruby-sapphire", name: "Ruby & Sapphire", gen: 3, region: "Hoenn", versions: [V("ruby", "Ruby"), V("sapphire", "Sapphire")] },
  { id: "firered-leafgreen", name: "FireRed & LeafGreen", gen: 3, region: "Kanto", versions: [V("firered", "FireRed"), V("leafgreen", "LeafGreen")] },
  { id: "emerald", name: "Emerald", gen: 3, region: "Hoenn", versions: [V("emerald", "Emerald")] },
  { id: "diamond-pearl", name: "Diamond & Pearl", gen: 4, region: "Sinnoh", versions: [V("diamond", "Diamond"), V("pearl", "Pearl")] },
  { id: "platinum", name: "Platinum", gen: 4, region: "Sinnoh", versions: [V("platinum", "Platinum")] },
  { id: "heartgold-soulsilver", name: "HeartGold & SoulSilver", gen: 4, region: "Johto", versions: [V("heartgold", "HeartGold"), V("soulsilver", "SoulSilver")] },
  { id: "black-white", name: "Black & White", gen: 5, region: "Unova", versions: [V("black", "Black"), V("white", "White")] },
  { id: "black-2-white-2", name: "Black 2 & White 2", gen: 5, region: "Unova", versions: [V("black-2", "Black 2"), V("white-2", "White 2")] },
  { id: "x-y", name: "X & Y", gen: 6, region: "Kalos", versions: [V("x", "X"), V("y", "Y")] },
  { id: "omega-ruby-alpha-sapphire", name: "Omega Ruby & Alpha Sapphire", gen: 6, region: "Hoenn", versions: [V("omega-ruby", "Omega Ruby"), V("alpha-sapphire", "Alpha Sapphire")] },
  { id: "sun-moon", name: "Sun & Moon", gen: 7, region: "Alola", versions: [V("sun", "Sun"), V("moon", "Moon")] },
  { id: "ultra-sun-ultra-moon", name: "Ultra Sun & Ultra Moon", gen: 7, region: "Alola", versions: [V("ultra-sun", "Ultra Sun"), V("ultra-moon", "Ultra Moon")] },
  { id: "lets-go-pikachu-eevee", name: "Let's Go, Pikachu! & Let's Go, Eevee!", gen: 7, region: "Kanto", versions: [V("lets-go-pikachu", "Let's Go, Pikachu!"), V("lets-go-eevee", "Let's Go, Eevee!")] },
  { id: "sword-shield", name: "Sword & Shield", gen: 8, region: "Galar", versions: [V("sword", "Sword"), V("shield", "Shield")] },
  { id: "brilliant-diamond-shining-pearl", name: "Brilliant Diamond & Shining Pearl", gen: 8, region: "Sinnoh", versions: [V("brilliant-diamond", "Brilliant Diamond"), V("shining-pearl", "Shining Pearl")] },
  { id: "legends-arceus", name: "Legends: Arceus", gen: 8, region: "Hisui", versions: [V("legends-arceus", "Legends: Arceus")] },
  { id: "scarlet-violet", name: "Scarlet & Violet", gen: 9, region: "Paldea", versions: [V("scarlet", "Scarlet"), V("violet", "Violet")] },
  { id: "legends-za", name: "Legends: Z-A", gen: 9, region: "Kalos", versions: [V("legends-za", "Legends: Z-A")] },
];

const IDS = new Set(NUZ_GAMES.map((g) => g.id));

/** A game's full data, or null for an unknown id (or a file that failed to load). */
export async function loadGame(id: string): Promise<NuzGame | null> {
  if (!IDS.has(id)) return null;
  try {
    // A template import: the bundler makes one chunk per JSON file in the folder.
    const mod = (await import(`../../data/nuzlocke/${id}.json`)) as { default: NuzGame };
    return mod.default;
  } catch {
    return null;
  }
}
