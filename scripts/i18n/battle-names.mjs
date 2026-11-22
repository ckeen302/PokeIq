#!/usr/bin/env node
// The names a battle shows, in one file per language for the battle screen to fetch (only its own language, and
// only off English): src/data/i18n/<locale>/battle-names.json. Everything comes from the language's PokéAPI tables
// (src/data/i18n/<locale>/*.json, src/data/species-names.json), cut down to what Showdown's battles can name: the
// species by National Dex number, and the moves, abilities and items @pkmn/dex knows, by our data key (the English
// name in lower case, letters and digits only). A name with no official translation is left out (the English stays).
//   node scripts/i18n/battle-names.mjs           (write)
//   node scripts/i18n/battle-names.mjs --check   (fail if a file is out of date)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Dex } = require("@pkmn/dex");
const LOCALES = ["ja", "es", "fr", "de", "it"];
const key = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const SPECIES = read("src/data/species-names.json");

function pick(table, names) {
  const out = {};
  for (const name of [...new Set(names.map(key))].sort()) if (table[name]) out[name] = table[name];
  return out;
}

const stale = [];
for (const locale of LOCALES) {
  const dir = `src/data/i18n/${locale}`;
  const species = {};
  for (const [num, names] of Object.entries(SPECIES)) if (names[locale]) species[num] = names[locale];
  const data = {
    species,
    moves: pick(read(`${dir}/moves.json`), Dex.moves.all().map((m) => m.name)),
    abilities: pick(read(`${dir}/abilities.json`), Dex.abilities.all().map((a) => a.name)),
    items: pick(read(`${dir}/items.json`), Dex.items.all().map((i) => i.name)),
    types: pick(read(`${dir}/types.json`), Dex.types.all().map((t) => t.name)),
    natures: pick(read(`${dir}/natures.json`), Dex.natures.all().map((n) => n.name)),
  };
  const file = `${dir}/battle-names.json`;
  const text = `${JSON.stringify(data)}\n`;
  if (process.argv.includes("--check")) {
    let old = "";
    try {
      old = readFileSync(file, "utf8");
    } catch {
      // missing
    }
    if (old !== text) stale.push(file);
  } else {
    writeFileSync(file, text);
    console.log(`${file}: ${Object.entries(data).map(([k, v]) => `${Object.keys(v).length} ${k}`).join(", ")}`);
  }
}
if (stale.length) {
  console.error(`Out of date (run node scripts/i18n/battle-names.mjs): ${stale.join(", ")}`);
  process.exit(1);
}
