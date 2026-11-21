// How every app route renders in a finished `next build`: "static", "isr:<seconds>", "ssg" (prerendered from
// generateStaticParams, with :fallback when unknown params render on request) or "dynamic".
// `node scripts/i18n/route-types.mjs [.next]` prints JSON. English routes are everything outside /[locale].
import { readFileSync } from "node:fs";
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

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(routeTypes(process.argv[2]), null, 1));
