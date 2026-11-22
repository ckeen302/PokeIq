#!/usr/bin/env node
// PokéAPI's numbers for the Pokédex's abilities and items (their texts in src/data/i18n/<locale>/texts are keyed by
// them; moves carry theirs already), from PokéAPI's open data (its CSV tables on GitHub, free, no API key).
// Writes src/data/dex-text-ids.json: { abilities: { "<our slug>": id }, items: { "<our slug>": id } }.
//
//   NODE_USE_ENV_PROXY=1 node scripts/i18n/pokeapi-dex-ids.mjs
//
// The CSVs are cached in .cache/pokeapi-csv (reruns are offline).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = process.env.POKEAPI_CSV ?? ".cache/pokeapi-csv";
const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";

async function table(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.csv`);
  if (!existsSync(file)) {
    const res = await fetch(`${BASE}/${name}.csv`, { headers: { "user-agent": "pokeiq-i18n-build" } });
    if (!res.ok) throw new Error(`${res.status} ${name}.csv`);
    writeFileSync(file, await res.text());
  }
  // These two tables have no quoted cells.
  const [head, ...rows] = readFileSync(file, "utf8").trim().split("\n").map((l) => l.replace(/\r$/, "").split(","));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const key = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ITEMS = JSON.parse(readFileSync("src/data/items.json", "utf8"));
const DETAILS = JSON.parse(readFileSync("src/data/pokedex-details.json", "utf8"));
// Our ability slugs, as src/lib/dex/build.ts makes them from the English names.
const slugify = (name) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.:]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const abilityNames = new Set();
for (const d of Object.values(DETAILS)) for (const a of d.abilities ?? []) abilityNames.add(a.name);

const out = { abilities: {}, items: {} };
const itemIds = new Map((await table("items")).map((r) => [r.identifier, Number(r.id)]));
for (const i of ITEMS) {
  const id = itemIds.get(i.slug);
  if (id) out.items[i.slug] = id;
}
const abilityIds = new Map((await table("abilities")).filter((r) => Number(r.id) < 10000).map((r) => [key(r.identifier), Number(r.id)]));
for (const name of [...abilityNames].sort()) {
  const id = abilityIds.get(key(name));
  if (id) out.abilities[slugify(name)] = id;
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync("src/data/dex-text-ids.json", `${JSON.stringify({ abilities: sorted(out.abilities), items: sorted(out.items) })}\n`);
console.log(`abilities ${Object.keys(out.abilities).length}/${abilityNames.size}, items ${Object.keys(out.items).length}/${ITEMS.length}`);
