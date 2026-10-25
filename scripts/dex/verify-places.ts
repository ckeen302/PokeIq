/**
 * Spot-check the Pokédex Places tab.
 *
 *   npx tsx scripts/dex/verify-places.ts [count]
 *
 * 1. Inverts every src/data/encounters/{id}.json (the same pure code the pages
 *    use) and prints matched / unmatched encounter location names.
 * 2. Picks `count` (default 15) random places with wild Pokémon and re-reads the
 *    species files directly (no inversion code) to check the place's rows
 *    round-trip both ways.
 * 3. Prints which screenshot (game) was chosen for 10 random places.
 */
import fs from "node:fs";
import path from "node:path";
import geo from "../../src/data/geo.json";
import { invertEncounters, mostRecentShot, placeKey, placeSlug, type PlaceEncounter } from "../../src/lib/dex/places";
import { isGeoFamily } from "../../src/lib/geo-families";
import type { EncGen } from "../../src/lib/pokemon/encounter-types";

const count = Number(process.argv[2] ?? 15);
const dir = path.join(process.cwd(), "src/data/encounters");
const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f): [number, EncGen[]] => [Number(f.slice(0, -5)), (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { gens: EncGen[] }).gens]);

type Loc = { name: string; region: string; parent?: string; shots: { id: string; game: string; family: string }[] };
const locs = (geo as unknown as { world: { locations: Loc[] } }).world.locations;
const keys = new Set(locs.map(placeKey));
const slugs = new Set(locs.map(placeSlug));

const { byPlace, matched, unmatched } = invertEncounters(files);
let rowsMatched = 0;
let rowsUnmatched = 0;
for (const [, gens] of files) for (const g of gens) for (const r of g.rows) if (r.loc && !r.x) (r.a ? rowsMatched++ : rowsUnmatched++);
console.log(`places: ${locs.length} (unique slugs ${slugs.size}); places with wild Pokémon: ${byPlace.size}; with screenshots: ${locs.filter((l) => l.shots.length).length}`);
console.log(`encounter location names: matched ${matched.size}, unmatched ${unmatched.size}; rows matched ${rowsMatched}, unmatched ${rowsUnmatched}`);
console.log(`unmatched sample: ${[...unmatched].slice(0, 8).join(" | ")}`);
const orphan = [...byPlace.keys()].filter((k) => !keys.has(k));
console.log(`inverted keys missing from the atlas: ${orphan.length}`);

const sig = (id: number, r: { v: string[]; m?: string; lv?: string; r?: string; t?: string[]; n?: string }) => [id, r.v.join(","), r.m, r.lv, r.r, r.t?.join("/"), r.n].join("|");
const pool = [...byPlace.keys()];
let failures = 0;
for (let i = 0; i < Math.min(count, pool.length); i++) {
  const key = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const got = (byPlace.get(key) as PlaceEncounter[]).map((r) => sig(r.id, r)).sort();
  // Direct re-read: every species row whose atlas link is this place.
  const want: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const id = Number(f.replace(".json", ""));
    const gens = (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { gens: EncGen[] }).gens;
    for (const g of gens) for (const r of g.rows) if (r.a === key && !r.x) want.push(sig(id, r));
  }
  want.sort();
  const ok = got.length === want.length && got.every((s, j) => s === want[j]);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${key}: ${got.length} rows, ${new Set(got.map((s) => s.split("|")[0])).size} species`);
}
console.log(`round-trip: ${failures} failure(s)`);

console.log("screenshot choice (most recent game):");
const withShots = locs.filter((l) => l.shots.length);
for (let i = 0; i < 10; i++) {
  const l = withShots[Math.floor(Math.random() * withShots.length)];
  const s = mostRecentShot(l.shots.filter((x) => isGeoFamily(x.family)));
  console.log(`  ${placeKey(l)}: ${s ? `${s.game} (${s.id})` : "none"} of [${l.shots.map((x) => x.family).join(", ")}]`);
}
if (failures || orphan.length || slugs.size !== locs.length) process.exit(1);
