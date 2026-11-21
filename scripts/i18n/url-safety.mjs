#!/usr/bin/env node
// URL safety: every page in a sitemap answers 200 itself (no redirect, no 404) on a running server.
//   node scripts/i18n/url-safety.mjs http://localhost:3000 [sitemap.xml file]   (default: the server's own /sitemap.xml)
// Pass a sitemap saved from before a change to prove every address it listed still works.
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const file = process.argv[3];
const xml = file ? readFileSync(file, "utf8") : await (await fetch(`${BASE}/sitemap.xml`)).text();
const paths = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&")).pathname + new URL(m[1].replace(/&amp;/g, "&")).search))];
const bad = [];
let done = 0;
const queue = [...paths];
const started = Date.now();
await Promise.all(
  Array.from({ length: 12 }, async () => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
      try {
        const res = await fetch(`${BASE}${p}`, { redirect: "manual", headers: { accept: "text/html" } });
        await res.arrayBuffer();
        if (res.status !== 200) bad.push(`${res.status} ${p}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}`);
      } catch (e) {
        bad.push(`ERR ${p} ${e.message}`);
      }
      if (++done % 1000 === 0) console.log(`  ${done}/${paths.length}`);
    }
  })
);
for (const b of bad) console.error(`  ${b}`);
console.log(`${bad.length ? "✗" : "✓"} ${paths.length - bad.length}/${paths.length} sitemap URLs answer 200 (${Math.round((Date.now() - started) / 1000)}s)`);
process.exit(bad.length ? 1 : 0);
