#!/usr/bin/env node
// Checks the translations in src/messages against English, the source:
//  - every language's file of a namespace has exactly English's keys (none missing, none extra);
//  - every message is valid ICU, and uses the same {arguments}, plural/select arguments and <tags> as English's;
//  - each namespace's definition (src/messages/<name>.ts) names its own file.
// A language may not have a namespace's file yet (not translated); pages using it then stay English-only
// (src/i18n/routes.ts) and the leftover-English check keeps them out of that language.
//   node scripts/i18n/check-messages.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const DIR = "src/messages";
const LOCALES = ["ja", "es", "fr", "de", "it"];
const problems = [];

/** Every leaf of a message tree: [["a.b", "text"], ...]. */
function leaves(tree, prefix = "", file) {
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push([key, v]);
    else if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leaves(v, key, file));
    else problems.push(`${file}: ${key} must be a string or an object`);
  }
  return out;
}

/**
 * A message's shape: the names of its arguments and its tags, which every translation must share. (A plural in
 * English may be a plain {n} in a language without plural forms, such as Japanese.)
 */
function shape(message) {
  const args = new Set();
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === TYPE.argument) args.add(`{${n.value}}`);
      else if (n.type === TYPE.number || n.type === TYPE.date || n.type === TYPE.time) args.add(`{${n.value}}`);
      else if (n.type === TYPE.plural) {
        args.add(`{${n.value}}`);
        for (const o of Object.values(n.options)) walk(o.value);
      } else if (n.type === TYPE.select) {
        args.add(`{${n.value}}`);
        for (const o of Object.values(n.options)) walk(o.value);
      } else if (n.type === TYPE.tag) {
        args.add(`<${n.value}>`);
        walk(n.children);
      }
    }
  };
  walk(parse(message));
  return [...args].sort().join(" ");
}

function read(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problems.push(`${file}: ${e.message}`);
    return {};
  }
}

const namespaces = readdirSync(join(DIR, "en")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
let translated = 0;
for (const ns of namespaces) {
  const enFile = join(DIR, "en", `${ns}.json`);
  const en = new Map(leaves(read(enFile), "", enFile));
  const shapes = new Map();
  for (const [key, msg] of en) {
    try {
      shapes.set(key, shape(msg));
    } catch (e) {
      problems.push(`${enFile}: ${key}: invalid ICU (${e.message})`);
    }
  }
  const def = join(DIR, `${ns}.ts`);
  if (!existsSync(def)) problems.push(`${def}: missing (every namespace has a definition: defineNamespace("${ns}", en))`);
  else if (!readFileSync(def, "utf8").includes(`defineNamespace("${ns}"`) || !readFileSync(def, "utf8").includes(`./en/${ns}.json`)) problems.push(`${def}: must define "${ns}" from ./en/${ns}.json`);
  for (const locale of LOCALES) {
    const file = join(DIR, locale, `${ns}.json`);
    if (!existsSync(file)) continue;
    translated++;
    const own = new Map(leaves(read(file), "", file));
    for (const key of en.keys()) if (!own.has(key)) problems.push(`${file}: missing ${key}`);
    for (const [key, msg] of own) {
      if (!en.has(key)) {
        problems.push(`${file}: ${key} is not in English`);
        continue;
      }
      let s;
      try {
        s = shape(msg);
      } catch (e) {
        problems.push(`${file}: ${key}: invalid ICU (${e.message})`);
        continue;
      }
      if (shapes.has(key) && s !== shapes.get(key)) problems.push(`${file}: ${key} uses [${s}], English uses [${shapes.get(key)}]`);
      if (msg.trim() === "" && en.get(key).trim() !== "") problems.push(`${file}: ${key} is empty`);
    }
  }
}
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".ts"))) {
  if (!namespaces.includes(f.slice(0, -3))) problems.push(`${join(DIR, f)}: no English file en/${f.slice(0, -3)}.json`);
}
for (const locale of LOCALES) {
  if (!existsSync(join(DIR, locale))) continue;
  for (const f of readdirSync(join(DIR, locale))) if (!namespaces.includes(f.replace(/\.json$/, ""))) problems.push(`${join(DIR, locale, f)}: no English namespace of that name`);
}

if (problems.length) {
  console.error(`Translations don't match English:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`messages ok: ${namespaces.length} namespaces, ${translated} translated files`);
