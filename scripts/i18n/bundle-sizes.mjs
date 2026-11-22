// Per-route client JavaScript of a finished `next build`: the gzip size of every script a page loads first
// (from .next/app-build-manifest.json): the page's own scripts and its layouts', each file counted once. `node scripts/i18n/bundle-sizes.mjs [.next] > sizes.json`
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dir = process.argv[2] ?? ".next";
const manifest = JSON.parse(readFileSync(join(dir, "app-build-manifest.json"), "utf8")).pages;
const cache = new Map();
const gz = (file) => {
  if (!cache.has(file)) cache.set(file, gzipSync(readFileSync(join(dir, file)), { level: 9 }).length);
  return cache.get(file);
};
const out = {};
for (const [route, files] of Object.entries(manifest)) {
  if (!route.endsWith("/page")) continue;
  // "/pokemon/[slug]/page" loads "/layout", "/pokemon/layout", "/pokemon/[slug]/layout" (those that exist) too.
  const parts = route.split("/").slice(1, -1);
  const layouts = parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}/layout`);
  const all = new Set([...files, ...["/layout", ...layouts].flatMap((l) => manifest[l] ?? [])]);
  out[route.replace(/\/page$/, "") || "/"] = [...all].filter((f) => f.endsWith(".js")).reduce((n, f) => n + gz(f), 0);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1));
