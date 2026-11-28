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
  { id: "firered-leafgreen", name: "FireRed & LeafGreen", gen: 3, region: "Kanto", versions: [V("firered", "FireRed"), V("leafgreen", "LeafGreen")] },
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
