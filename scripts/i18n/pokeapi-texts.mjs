#!/usr/bin/env node
// The games' own texts in each language, from PokéAPI's open data (its CSV tables on GitHub, free, no API key):
// Pokédex entries (species flavour text), and the in-game descriptions of moves, abilities and items.
// Writes src/data/i18n/<locale>/texts/<kind>.json: { "<id>": [{ "text": "…", "versions": ["red", "blue"] }, …] },
// identical texts merged with every game that uses them, newest game first. Server-only data: pages send a reader the
// entries of the Pokémon they show, in that page's language. Nothing is written for a language the games don't have.
//
//   NODE_USE_ENV_PROXY=1 node scripts/i18n/pokeapi-texts.mjs
//
// The CSVs are cached in .cache/pokeapi-csv (reruns are offline).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = ".cache/pokeapi-csv";
const OUT = "src/data/i18n";
const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
/** PokéAPI's language ids (languages.csv). Japanese: the kanji text ("ja") where there is one, else kana ("ja-hrkt"). */
const LANG = { "ja-hrkt": 1, fr: 5, de: 6, es: 7, it: 8, en: 9, ja: 11 };
const LOCALES = ["ja", "es", "fr", "de", "it"];

/** kind → [csv, id column, text column, version column (version or version group)]. */
const TABLES = {
  species: ["pokemon_species_flavor_text", "species_id", "flavor_text", "version_id"],
  moves: ["move_flavor_text", "move_id", "flavor_text", "version_group_id"],
  abilities: ["ability_flavor_text", "ability_id", "flavor_text", "version_group_id"],
  items: ["item_flavor_text", "item_id", "flavor_text", "version_group_id"],
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

/** A game text as one line: the games' manual line breaks and soft hyphens out, Japanese without the spaces it wraps with. */
function clean(text, lang) {
  let t = text.replace(/­\s*/g, "").replace(/\f/g, "\n");
  if (lang === LANG.ja || lang === LANG["ja-hrkt"]) t = t.replace(/[\s　]+/g, (m, i, s) => (/[A-Za-z0-9]/.test(s[i - 1] ?? "") && /[A-Za-z0-9]/.test(s[i + m.length] ?? "") ? " " : ""));
  else t = t.replace(/-\n(?=\p{Ll})/gu, "").replace(/\s+/g, " ");
  return t.trim();
}

// Version and version-group identifiers (red, gold, scarlet-violet…) and their order (newest last).
const versions = new Map((await table("versions")).map((v) => [v.id, { name: v.identifier, group: v.version_group_id }]));
const groups = new Map((await table("version_groups")).map((g) => [g.id, { name: g.identifier, order: Number(g.order) }]));
const orderOf = (kind, id) => (kind === "species" ? (groups.get(versions.get(id)?.group)?.order ?? 0) : (groups.get(id)?.order ?? 0));
const nameOf = (kind, id) => (kind === "species" ? versions.get(id)?.name : groups.get(id)?.name) ?? id;

for (const [kind, [csv, idCol, textCol, verCol]] of Object.entries(TABLES)) {
  const rows = await table(csv);
  const out = Object.fromEntries(LOCALES.map((l) => [l, {}]));
  for (const l of LOCALES) {
    const langs = l === "ja" ? [LANG.ja, LANG["ja-hrkt"]] : [LANG[l]];
    // Per thing: text → the games it appears in. Japanese: kanji texts where a game has them, else kana.
    const by = new Map();
    for (const lang of langs) {
      for (const r of rows) {
        if (Number(r.language_id) !== lang) continue;
        const text = clean(r[textCol] ?? "", lang);
        if (!text) continue;
        const id = r[idCol];
        if (!by.has(id)) by.set(id, new Map());
        const texts = by.get(id);
        // A game already has its kanji text: its kana one is the same entry.
        if (lang === LANG["ja-hrkt"] && [...texts.values()].some((v) => v.has(r[verCol]))) continue;
        if (!texts.has(text)) texts.set(text, new Set());
        texts.get(text).add(r[verCol]);
      }
    }
    for (const [id, texts] of by) {
      out[l][id] = [...texts]
        .map(([text, vs]) => ({ text, versions: [...vs].sort((a, b) => orderOf(kind, b) - orderOf(kind, a)).map((v) => nameOf(kind, v)), newest: Math.max(...[...vs].map((v) => orderOf(kind, v))) }))
        .sort((a, b) => b.newest - a.newest)
        .map(({ text, versions }) => ({ text, versions }));
    }
  }
  for (const l of LOCALES) {
    mkdirSync(join(OUT, l, "texts"), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(out[l]).sort(([a], [b]) => Number(a) - Number(b)));
    writeFileSync(join(OUT, l, "texts", `${kind}.json`), `${JSON.stringify(sorted).replace(/\],"/g, '],\n"')}\n`);
  }
  console.log(`${kind}: ${LOCALES.map((l) => `${l} ${Object.keys(out[l]).length}`).join(", ")}`);
}
