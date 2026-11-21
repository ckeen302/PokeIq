// How every app route renders in a finished `next build`: "static", "isr:<seconds>", "ssg" (prerendered from
// generateStaticParams, with :fallback when unknown params render on request) or "dynamic".
// `node scripts/i18n/route-types.mjs [.next]` prints JSON. English routes are everything outside /[locale].
//   --check   fail if an English route renders differently from scripts/i18n/route-types.json (CI, after next build)
//   --write   record the current table there (after a deliberate change to how a page renders)
// Languages must never change how an English page renders (static stays static, ISR keeps its interval).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function routeTypes(dir = ".next") {
  const pre = JSON.parse(readFileSync(join(dir, "prerender-manifest.json"), "utf8"));
  const paths = JSON.parse(readFileSync(join(dir, "app-path-routes-manifest.json"), "utf8"));
  const out = {};
  for (const [entry, route] of Object.entries(paths)) {
    if (!entry.endsWith("/page") && !entry.endsWith("/route")) continue;
    const kind = entry.endsWith("/route") ? "route" : "page";
    let type;
    if (pre.dynamicRoutes[route]) {
      const d = pre.dynamicRoutes[route];
      type = `ssg${d.fallback === false ? "" : ":fallback"}`;
    } else if (pre.routes[route]) {
      const r = pre.routes[route].initialRevalidateSeconds;
      type = r === false ? "static" : `isr:${r}`;
    } else type = "dynamic";
    out[route] = `${kind} ${type}`;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const TABLE = new URL("./route-types.json", import.meta.url);
const english = (table) => Object.fromEntries(Object.entries(table).filter(([route]) => !route.startsWith("/[locale]")));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? ".next";
  const now = routeTypes(dir);
  if (args.includes("--write")) writeFileSync(TABLE, `${JSON.stringify(english(now), null, 1)}\n`);
  else if (args.includes("--check")) {
    const was = JSON.parse(readFileSync(TABLE, "utf8"));
    const cur = english(now);
    const changed = Object.keys({ ...was, ...cur }).filter((r) => was[r] !== cur[r]).map((r) => `${r}: ${was[r] ?? "(new)"} → ${cur[r] ?? "(gone)"}`);
    if (changed.length) {
      console.error(`English routes render differently from scripts/i18n/route-types.json:\n  ${changed.join("\n  ")}\nIf that is intended, record it: node scripts/i18n/route-types.mjs --write`);
      process.exit(1);
    }
    console.log(`route types ok: ${Object.keys(cur).length} English routes render as recorded`);
  } else console.log(JSON.stringify(now, null, 1));
}
