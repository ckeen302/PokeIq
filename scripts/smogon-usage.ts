/**
 * Downloads Smogon's monthly usage statistics (processed by pkmn/smogon and
 * served at data.pkmn.cc) and writes a trimmed copy per format to
 * src/data/smogon/: the most used Pokémon with their common abilities,
 * items, moves, EV spreads and Tera types. The team builder's popular sets,
 * threat list and speed benchmarks, and the replay analysis's assumed sets,
 * are all built from these files, so the site never calls a third party at
 * run time.
 *
 * Only the usage statistics are used (public domain, as data.pkmn.cc says);
 * Smogon's written sets and analyses are copyrighted and are not copied.
 *
 *   npx tsx scripts/smogon-usage.ts
 */
import fs from "node:fs";
import path from "node:path";
import { USAGE_FORMATS, type UsageFile, type UsageMon } from "../src/lib/battle/usage";

const OUT = path.join(process.cwd(), "src/data/smogon");
/** How many of each format's most used Pokémon to keep. */
const KEEP = 60;

type Weights = Record<string, number>;
interface RawMon {
  usage: { weighted: number };
  abilities: Weights;
  items: Weights;
  moves: Weights;
  spreads: Weights;
  teraTypes?: Weights;
}

const top = (w: Weights | undefined, n: number, min = 0.01): [string, number][] =>
  Object.entries(w ?? {})
    .filter(([name, p]) => p >= min && name !== "Nothing" && name !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, p]) => [name, Math.round(p * 1000) / 1000]);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const format of USAGE_FORMATS) {
    const res = await fetch(`https://data.pkmn.cc/stats/${format}.json`);
    if (!res.ok) {
      console.warn(`${format}: ${res.status}, skipped`);
      continue;
    }
    const raw = (await res.json()) as { battles: number; pokemon: Record<string, RawMon> };
    const pokemon: UsageMon[] = Object.entries(raw.pokemon)
      .sort((a, b) => b[1].usage.weighted - a[1].usage.weighted)
      .slice(0, KEEP)
      .map(([species, m]) => ({
        species,
        usage: Math.round(m.usage.weighted * 10000) / 10000,
        abilities: top(m.abilities, 3),
        items: top(m.items, 4),
        moves: top(m.moves, 10),
        spreads: top(m.spreads, 3, 0),
        teraTypes: top(m.teraTypes, 3),
      }));
    const file: UsageFile = { format, battles: raw.battles, fetched: new Date().toISOString().slice(0, 10), pokemon };
    fs.writeFileSync(path.join(OUT, `${format}.json`), JSON.stringify(file) + "\n");
    console.log(`${format}: ${pokemon.length} Pokémon from ${raw.battles} battles`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
