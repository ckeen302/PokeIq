#!/usr/bin/env node
// Compares two builds' prerendered pages (the .html files under .next/server/app, e.g. extracted from build-capture
// tarballs): the markup a browser paints, with scripts, the RSC payload and hashed asset names taken out.
// Proves a change left English pages pixel-identical as served.
//   node scripts/i18n/compare-html.mjs <before-dir> <after-dir> [--show N]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const [a, b] = process.argv.slice(2);
const show = Number(process.argv[process.argv.indexOf("--show") + 1]) || 5;
const files = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (n.endsWith(".html")) out.push(relative(dir, f));
    }
  };
  walk(dir);
  return out.sort();
};
export function normalize(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link\b[^>]*\bas="script"[^>]*>/g, "")
    .replace(/\/_next\/static\/[^"']+/g, "/_next/static/*")
    .replace(/<!--\$!?-->|<!--\/\$-->|<!-- -->/g, "")
    .replace(/<template[^>]*><\/template>/g, "");
}
const left = new Set(files(a));
const right = new Set(files(b));
const onlyA = [...left].filter((f) => !right.has(f));
const onlyB = [...right].filter((f) => !left.has(f));
const differ = [];
for (const f of left) {
  if (!right.has(f)) continue;
  const x = normalize(readFileSync(join(a, f), "utf8"));
  const y = normalize(readFileSync(join(b, f), "utf8"));
  if (x !== y) {
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    differ.push({ f, at: i, was: x.slice(Math.max(0, i - 80), i + 160), now: y.slice(Math.max(0, i - 80), i + 160) });
  }
}
console.log(`${left.size} pages before, ${right.size} after; ${onlyA.length} gone, ${onlyB.length} new, ${differ.length} differ`);
for (const f of onlyA.slice(0, show)) console.log(`  gone: ${f}`);
for (const f of onlyB.slice(0, show)) console.log(`  new:  ${f}`);
for (const d of differ.slice(0, show)) console.log(`  differs: ${d.f} @${d.at}\n    was: ${d.was}\n    now: ${d.now}`);
process.exit(onlyA.length || differ.length ? 1 : 0);
