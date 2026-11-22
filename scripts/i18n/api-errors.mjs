#!/usr/bin/env node
// Collects every error message the API sends players (`error: "…"` in src/app/api and src/lib/server) into the
// "api-errors" namespace (src/messages/en/api-errors.json), keyed by a slug of the English text. A page in another
// language translates an /api/ response's `error` on the way in (src/components/i18n/ApiErrors.tsx); English pages
// never look. Template literals become ICU arguments ({a1}, {a2}…) and are matched back by pattern.
//   node scripts/i18n/api-errors.mjs           rewrite the English file (translations keep their keys)
//   node scripts/i18n/api-errors.mjs --report  list messages with no translation per language (never fails)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/api", "src/lib/server"];
const OUT = "src/messages/en/api-errors.json";
const PATTERNS = "src/i18n/api-error-patterns.json";
const LOCALES = ["ja", "es", "fr", "de", "it"];

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));

/** The slug a message is keyed by (src/components/i18n/ApiErrors.tsx makes the same from the English text). */
export const slug = (s) => s.toLowerCase().replace(/\{a\d+\}/g, "x").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);

const found = new Map();
for (const file of ROOTS.flatMap(files)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\berror:\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) {
    let text = m[1];
    if (text.startsWith("`")) {
      const parts = text.slice(1, -1);
      // Only plain substitutions: a ternary or a nested template can't be matched back.
      if (/\$\{[^}]*[?`]/.test(parts)) continue;
      let n = 0;
      text = parts.replace(/\$\{[^}]+\}/g, () => `{a${++n}}`);
      if (/^\{a\d+\}/.test(text) && text.length < 12) continue;
    } else text = JSON.parse(text.startsWith("'") ? `"${text.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'")}"` : text);
    if (!text.trim() || /[{}]/.test(text.replace(/\{a\d+\}/g, ""))) continue;
    // ICU: a lone apostrophe before { or } would escape it.
    const icu = text.replace(/'(?=\{)/g, "''");
    const key = slug(text);
    if (found.has(key) && found.get(key) !== icu) console.warn(`same slug, two messages: ${key}\n  ${found.get(key)}\n  ${icu}`);
    found.set(key, icu);
  }
}

if (process.argv.includes("--report")) {
  for (const l of LOCALES) {
    const file = `src/messages/${l}/api-errors.json`;
    const own = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const missing = [...found.keys()].filter((k) => !(k in own));
    console.log(`${l}: ${found.size - missing.length}/${found.size} translated${missing.length ? `; missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}` : ""}`);
  }
} else {
  const sorted = Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  // The messages with arguments, as patterns that match the English text the API sent: [key, regex source].
  const esc = (t) => t.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const patterns = Object.entries(sorted)
    .filter(([, m]) => /\{a\d+\}/.test(m))
    .map(([k, m]) => [k, `^${m.replace(/''/g, "'").split(/\{a\d+\}/).map(esc).join("(.+?)")}$`]);
  writeFileSync(PATTERNS, `${JSON.stringify(patterns, null, 1)}\n`);
  console.log(`${found.size} API error messages → ${OUT}`);
}
