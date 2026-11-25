/**
 * Builds src/data/catch-rate.json: what the Catch Rate Calculator needs to know about every species, in a small table
 * the page ships with (no API calls at run time).
 *
 * Everything comes from the site's own Pokédex data, which scripts/ingest-pokedex.ts and scripts/ingest-details.ts
 * took from PokéAPI: the capture rate is PokéAPI's pokemon-species `capture_rate`; base HP, base Speed, weight and
 * types are the default form's. Ultra Beasts (for the Beast Ball) are the eleven species the games call Ultra Beasts.
 *
 * PokéAPI's capture rates are not all the main series' current ones: for the Hisuian evolutions it gives Legends:
 * Arceus's rates, and for a few species an older game's. MAIN_SERIES puts back Scarlet & Violet's rate (Bulbapedia's
 * "List of Pokémon by catch rate", checked against Serebii's Scarlet & Violet Pokédex); the catch rates of earlier
 * games are rateIn() in src/lib/catch-rate/formula.ts.
 *
 *   npx tsx scripts/catch-rate-data.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Dex {
  id: number;
  name: string;
  gen: number;
  types: string[];
  stats: { hp: number; spe: number };
  weight: number;
}
const dex = JSON.parse(readFileSync("src/data/pokedex.json", "utf8")) as Dex[];
const details = JSON.parse(readFileSync("src/data/pokedex-details.json", "utf8")) as Record<string, { captureRate: number | null }>;

/** Nihilego to Blacephalon: the species the games treat as Ultra Beasts (Necrozma is not one). */
const ULTRA_BEASTS = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);

/** Scarlet & Violet's catch rate where PokéAPI has another game's: Rayquaza, Basculin (2.0.1), the Cosmog line, Necrozma, and Wyrdeer to Overqwil (Legends: Arceus's in PokéAPI). */
const MAIN_SERIES: Record<number, number> = { 384: 3, 550: 190, 789: 3, 790: 3, 791: 3, 792: 3, 800: 3, 899: 45, 900: 15, 901: 20, 902: 45, 903: 20, 904: 45 };

/** [id, English name, capture rate, base HP, base Speed, weight in hectograms, types, generation, Ultra Beast 0/1] */
const rows = dex.map((p) => {
  const rate = MAIN_SERIES[p.id] ?? details[p.id]?.captureRate;
  if (typeof rate !== "number") throw new Error(`no capture rate for #${p.id}`);
  return [p.id, p.name, rate, p.stats.hp, p.stats.spe, p.weight, p.types.join("/"), p.gen, ULTRA_BEASTS.has(p.id) ? 1 : 0];
});
writeFileSync("src/data/catch-rate.json", "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
console.log(`wrote ${rows.length} species`);
