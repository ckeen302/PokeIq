// Species names per language for client code that needs only its own page's language (the battle pages):
// src/data/i18n/<locale>/species.json, keyed like the other tables (the English name in lower case, letters and
// digits only; Nidoran♀ / ♂ as Showdown spells them: nidoranf, nidoranm). Built from src/data/pokedex.json and
// src/data/species-names.json (PokéAPI); rerun after either changes: node scripts/i18n/species-by-locale.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dex = JSON.parse(readFileSync("src/data/pokedex.json", "utf8"));
const names = JSON.parse(readFileSync("src/data/species-names.json", "utf8"));
const list = Array.isArray(dex) ? dex : dex.pokemon ?? Object.values(dex);
const key = (s) =>
  s
    .replace("♀", "f")
    .replace("♂", "m")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

for (const locale of ["ja", "es", "fr", "de", "it"]) {
  const out = {};
  for (const p of [...list].sort((a, b) => a.id - b.id)) {
    const own = names[p.id]?.[locale];
    if (own) out[key(p.name)] = own;
  }
  writeFileSync(`src/data/i18n/${locale}/species.json`, `{\n${Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n")}\n}\n`);
  console.log(locale, Object.keys(out).length);
}
