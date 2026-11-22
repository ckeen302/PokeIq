#!/usr/bin/env node
// The battle log's English text, from Pokémon Showdown's battle text table as @pkmn/view ships it (MIT): every
// template becomes an ICU message in src/messages/en/battle-log.json ("[POKEMON] used **[MOVE]**!" →
// "{POKEMON} used **{MOVE}**!"), and the table's cross-references ("#psn": the same text as Poison's) go to
// src/lib/battle/log/refs.json. Other languages translate the English file (src/messages/<locale>/battle-log.json);
// src/lib/battle/log/local.ts reads them. Its "pokeiq" section (PokéIQ's own lines) is kept as written. English pages
// keep @pkmn/view's own formatter and never load any of this.
//   node scripts/i18n/battle-log.mjs           (write)
//   node scripts/i18n/battle-log.mjs --check   (fail if the files are out of date)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const src = readFileSync(require.resolve("@pkmn/view").replace(/index\.js$/, "index.mjs"), "utf8").split("\n");
const start = src.findIndex((l) => l.startsWith("var _ = {"));
const end = src.findIndex((l, i) => i > start && l.startsWith("// src/formatter.ts"));
if (start < 0 || end < 0) throw new Error("@pkmn/view's text table moved: update scripts/i18n/battle-log.mjs");
const code = src.slice(start, end).join("\n");
// The table's entries, as the bundle declares them (its `default` export repeats them all).
const names = [...code.matchAll(/^var ([A-Za-z_0-9]+) = /gm)].map((m) => m[1]).filter((n) => n !== "text_default");
const table = new Function(`${code}\nreturn {${names.map((n) => `${JSON.stringify(n)}: ${n}`).join(",")}};`)();

const messages = {};
const refs = {};
for (const [id, entry] of Object.entries(table)) {
  for (const [key, value] of Object.entries(entry)) {
    if (/^#/.test(value)) (refs[id] ??= {})[key] = value;
    else if (value) (messages[id] ??= {})[key] = value.replace(/\[([A-Z]+)\]/g, "{$1}");
  }
}

// PokéIQ's own lines in the log (the battle screen's notes, the server's timer messages), written by hand.
const OWN = "src/messages/en/battle-log.json";
messages.pokeiq = JSON.parse(readFileSync(OWN, "utf8")).pokeiq;
if (!messages.pokeiq) throw new Error(`${OWN} lost its "pokeiq" section`);

const files = {
  "src/messages/en/battle-log.json": `${JSON.stringify(messages, null, 2)}\n`,
  "src/lib/battle/log/refs.json": `${JSON.stringify(refs, null, 2)}\n`,
};
if (process.argv.includes("--check")) {
  const stale = Object.entries(files).filter(([f, text]) => readFileSync(f, "utf8") !== text);
  if (stale.length) {
    console.error(`Out of date (run node scripts/i18n/battle-log.mjs): ${stale.map(([f]) => f).join(", ")}`);
    process.exit(1);
  }
  console.log("battle log text ok");
} else {
  for (const [f, text] of Object.entries(files)) writeFileSync(f, text);
  console.log(`${Object.values(messages).reduce((n, e) => n + Object.keys(e).length, 0)} messages, ${Object.keys(refs).length} cross-referenced entries`);
}
