// Per-route client JavaScript of a finished `next build`: the gzip size of every script a page loads first
// (from .next/app-build-manifest.json). `node scripts/i18n/bundle-sizes.mjs [.next] > sizes.json`
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
  out[route.replace(/\/page$/, "") || "/"] = files.filter((f) => f.endsWith(".js")).reduce((n, f) => n + gz(f), 0);
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1));
