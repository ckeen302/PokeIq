import { writeFileSync } from "node:fs";
import { Dex, Teams } from "pokemon-showdown";
import singles from "pokemon-showdown/dist/data/random-battles/gen9/sets.json";
import doubles from "pokemon-showdown/dist/data/random-battles/gen9/doubles-sets.json";
import { createRequire } from "node:module";
import type { RandSetsInfo } from "../src/lib/battle/tooltip-calc";

/**
 * What every random-battle Pokémon may have (level, abilities, moves, Tera
 * types, items), from Showdown's own data, written once to
 * src/data/battle/randsets.json so /api/battle/randsets answers from a file
 * instead of running the generator. Rerun after a pokemon-showdown update:
 * tests/battle-randsets.test.ts checks the version.
 *   npx tsx scripts/build-randsets.ts
 */

type SetsFile = Record<string, { level?: number; sets: { movepool: string[]; abilities: string[]; teraTypes?: string[] }[] }>;
const PS_VERSION = String((createRequire(import.meta.url)("pokemon-showdown/package.json") as { version: string }).version);
const uniq = (list: string[]) => [...new Set(list)].sort();

function itemsFor(format: string, species: string): string[] {
  const generator = Teams.getGenerator(format) as unknown as { randomSet: (s: string, teamDetails: object, isLead: boolean, isDoubles: boolean) => { item?: string } };
  const items: string[] = [];
  for (let i = 0; i < 48; i++) {
    try {
      const set = generator.randomSet(species, {}, i % 4 === 0, format === "gen9randomdoublesbattle");
      if (set.item) items.push(set.item);
    } catch {
      break;
    }
  }
  return uniq(items);
}

const out: { version: string; formats: Record<string, Record<string, RandSetsInfo>> } = { version: PS_VERSION, formats: {} };
for (const [format, file] of [["gen9randombattle", singles], ["gen9randomdoublesbattle", doubles]] as const) {
  const table: Record<string, RandSetsInfo> = {};
  for (const [id, entry] of Object.entries(file as SetsFile)) {
    const species = Dex.species.get(id);
    if (!species.exists) continue;
    table[species.id] = {
      level: entry.level ?? null,
      abilities: uniq(entry.sets.flatMap((s) => s.abilities)),
      moves: uniq(entry.sets.flatMap((s) => s.movepool)),
      teraTypes: uniq(entry.sets.flatMap((s) => s.teraTypes ?? [])),
      items: itemsFor(format, species.name),
    };
  }
  out.formats[format] = table;
  console.log(format, Object.keys(table).length, "Pokémon");
}
writeFileSync("src/data/battle/randsets.json", JSON.stringify(out));
console.log("wrote src/data/battle/randsets.json, pokemon-showdown", out.version);
