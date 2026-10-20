/**
 * Who Am I?'s move questions ("Can I learn Surf?").
 *
 *   npx tsx scripts/whoami-moves.ts
 *
 * Writes src/data/whoami-moves.json: for each move in MOVES, the Pokédex
 * numbers that can learn it in any generation, by any method (a Pokémon
 * also counts its pre-evolutions' moves). Learnsets come from @pkmn/dex;
 * they're large, so the game reads this small table instead.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Dex } from "@pkmn/dex";

/** Well-known moves that split the Pokédex well (each learnable by about 10% to 50% of it). */
export const MOVES = [
  "surf",
  "fly",
  "earthquake",
  "thunderbolt",
  "flamethrower",
  "icebeam",
  "psychic",
  "swordsdance",
  "solarbeam",
  "shadowball",
  "dragonclaw",
  "sludgebomb",
  "closecombat",
  "dig",
  "uturn",
  "recover",
] as const;

async function main() {
  const out: Record<string, number[]> = {};
  const learnable = new Map<number, Set<string>>();
  for (let num = 1; num <= 1025; num++) {
    const species = Dex.species.all().find((s) => s.num === num && !s.forme);
    if (!species) throw new Error(`No species #${num}`);
    const moves = new Set<string>();
    for (let s: typeof species | undefined = species; s?.exists; s = s.prevo ? Dex.species.get(s.prevo) : undefined) {
      const ls = await Dex.learnsets.get(s.id);
      for (const m of Object.keys(ls.learnset ?? {})) moves.add(m);
    }
    learnable.set(num, moves);
  }
  for (const move of MOVES) {
    out[move] = [...learnable].filter(([, set]) => set.has(move)).map(([num]) => num);
    console.log(move, out[move].length);
  }
  writeFileSync(path.join(import.meta.dirname, "../src/data/whoami-moves.json"), JSON.stringify(out) + "\n");
}

void main();
