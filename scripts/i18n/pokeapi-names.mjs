#!/usr/bin/env node
// The games' official names in each language, from PokéAPI's open data (its CSV tables on GitHub, free, no API key):
// types, moves, abilities, items, natures, stats, colours, habitats, shapes, generations, regions, egg groups, games
// (versions), locations and each species' genus ("Mouse Pokémon"). Writes src/data/i18n/<locale>/<kind>.json:
// { "<english name, lowercase letters and digits only>": "<name in that language>" } — only names the games really
// ship in that language (nothing is invented; a missing one falls back to English where it is shown).
//
//   NODE_USE_ENV_PROXY=1 node scripts/i18n/pokeapi-names.mjs
//
// The CSVs are cached in .cache/pokeapi-csv (reruns are offline). Japanese uses the games' kanji names ("ja") where
// PokéAPI has them, else their kana ("ja-hrkt").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = ".cache/pokeapi-csv";
const OUT = "src/data/i18n";
const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
/** PokéAPI's language ids (languages.csv). */
const LANG = { "ja-hrkt": 1, fr: 5, de: 6, es: 7, it: 8, en: 9, ja: 11 };
const LOCALES = ["ja", "es", "fr", "de", "it"];

/** kind → [csv file, the id column, the text column]. */
const TABLES = {
  types: ["type_names", "type_id", "name"],
  moves: ["move_names", "move_id", "name"],
  abilities: ["ability_names", "ability_id", "name"],
  items: ["item_names", "item_id", "name"],
  natures: ["nature_names", "nature_id", "name"],
  stats: ["stat_names", "stat_id", "name"],
  colors: ["pokemon_color_names", "pokemon_color_id", "name"],
  habitats: ["pokemon_habitat_names", "pokemon_habitat_id", "name"],
  shapes: ["pokemon_shape_prose", "pokemon_shape_id", "name"],
  generations: ["generation_names", "generation_id", "name"],
  regions: ["region_names", "region_id", "name"],
  "egg-groups": ["egg_group_prose", "egg_group_id", "name"],
  versions: ["version_names", "version_id", "name"],
  locations: ["location_names", "location_id", "name"],
  genus: ["pokemon_species_names", "pokemon_species_id", "genus"],
  "damage-classes": ["move_damage_class_prose", "move_damage_class_id", "name"],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function table(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.csv`);
  if (!existsSync(file)) {
    const res = await fetch(`${BASE}/${name}.csv`, { headers: { "user-agent": "pokeiq-i18n-build" } });
    if (!res.ok) throw new Error(`${res.status} ${name}.csv`);
    writeFileSync(file, await res.text());
  }
  return parseCsv(readFileSync(file, "utf8"));
}

export const key = (english) => english.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const out = Object.fromEntries(LOCALES.map((l) => [l, {}]));
for (const [kind, [csv, idCol, textCol]] of Object.entries(TABLES)) {
  const rows = await table(csv);
  const byId = new Map();
  for (const r of rows) {
    const text = (r[textCol] ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!byId.has(r[idCol])) byId.set(r[idCol], {});
    byId.get(r[idCol])[r.local_language_id] = text;
  }
  for (const l of LOCALES) out[l][kind] = {};
  let collisions = 0;
  for (const names of byId.values()) {
    const en = names[LANG.en];
    if (!en) continue;
    const k = key(en);
    for (const l of LOCALES) {
      const own = l === "ja" ? (names[LANG.ja] ?? names[LANG["ja-hrkt"]]) : names[LANG[l]];
      if (!own) continue;
      // Two entries with one English name (an item and its later version): keep the first, the games' original.
      if (out[l][kind][k] !== undefined) {
        if (out[l][kind][k] !== own) collisions++;
        continue;
      }
      out[l][kind][k] = own;
    }
  }
  console.log(`${kind}: ${byId.size} entries, ${LOCALES.map((l) => `${l} ${Object.keys(out[l][kind]).length}`).join(", ")}${collisions ? ` (${collisions} same-name variants kept as the first)` : ""}`);
}
for (const l of LOCALES) {
  mkdirSync(join(OUT, l), { recursive: true });
  for (const [kind, names] of Object.entries(out[l])) {
    const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(OUT, l, `${kind}.json`), `${JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"').replace(/^\{/, "{\n").replace(/\}$/, "\n}")}\n`);
  }
}
