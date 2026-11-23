/**
 * What one visitor costs on the free plans: every request a fresh browser
 * makes on each main page, sorted by who pays for it.
 *
 *   npm run build && npm start -- -p 3100      # local servers only
 *   node scripts/visitor-cost.mjs http://localhost:3100 [--json out.json] [--only /pokedle,/pokemon/pikachu] [--db http://127.0.0.1:54321]
 *
 * Each route is opened twice: by a brand-new visitor (empty browser), and by
 * the same visitor's second page (opened after the home page, as someone
 * clicking through: what the browser already has cached isn't counted). Every request to the site is put in one of:
 *
 *   function  runs a serverless function on every request (an API call or a
 *             page that renders per request: Cache-Control private/no-store)
 *   cdn-fn    runs a function, but the answer is shareable (s-maxage), so the
 *             CDN answers repeats until it expires
 *   image     Vercel's image optimizer (/_next/image: a transformation the
 *             first time, a cache read after)
 *   static    a file or prerendered page the CDN serves (no function)
 *
 * and requests to other hosts (PokéAPI's sprites) are counted as external
 * (Vercel Analytics' own beacons are left out).
 * The browser scrolls each page to the bottom so lazy pictures load too. It
 * is read-only (as launch-check.mjs): a POST is counted as a function but
 * never sent. It never runs against a live site.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import { ROUTES, closeHowTo } from "./read-only-browser.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = (args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("visitor-cost runs against a local server only.");
const JSON_OUT = flag("json", "");
/** --db <url>: a scripts/fake-supabase.mjs the server under test talks to; each visit's database calls are counted too. */
const DB = flag("db", "");
const ONLY = flag("only", "");
const host = new URL(BASE).host;

const paths = ONLY ? ONLY.split(",") : ROUTES.map((r) => r.path).filter((p) => !["/privacy", "/atlas", "/rooms"].includes(p));

function classify(url, headers) {
  const u = new URL(url);
  if (u.host !== host) return "external";
  if (u.pathname.startsWith("/_vercel/")) return "analytics";
  if (u.pathname.startsWith("/_next/image")) return "image";
  if (u.pathname.startsWith("/_next/static/")) return "static";
  const cc = (headers["cache-control"] ?? "").toLowerCase();
  const api = u.pathname.startsWith("/api/");
  // A page or route Next marks as prerendered or ISR is served from the CDN (x-nextjs-cache on `next start`).
  if (!api && headers["x-nextjs-cache"]) return "static";
  if (/s-maxage=[1-9]/.test(cc) || /public, max-age=[1-9]/.test(cc)) return api ? "cdn-fn" : "static";
  if (api) return "function";
  if (cc.includes("no-store") || cc.includes("private") || cc.includes("no-cache")) return "function";
  return "static";
}

async function visit(browser, path, warm) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Read-only, as read-only-browser.mjs, but through Chrome's Fetch domain: Playwright's routing would turn the
  // browser's HTTP cache off, and a second page would then count every file again.
  const stopped = new Map();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return void cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
    const key = `${request.method} ${new URL(request.url).pathname}`;
    stopped.set(key, (stopped.get(key) ?? 0) + 1);
    void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
  });
  if (warm) {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
    await closeHowTo(page);
    stopped.clear();
  }
  // Wait for the warm-up page's last calls, then count from zero.
  if (DB) await page.waitForTimeout(500).then(() => fetch(`${DB}/__reset`, { method: "POST" }));
  // Chrome's own network events: a response the browser took from its cache never reached the CDN, so it isn't counted.
  const seen = [];
  await cdp.send("Network.enable");
  const fromCache = new Set();
  /** Requests to the site that reached it, and the bytes each brought over the wire (Vercel's data transfer). */
  const counted = new Set();
  let bytes = 0;
  cdp.on("Network.requestServedFromCache", ({ requestId }) => fromCache.add(requestId));
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    if (counted.has(requestId)) bytes += encodedDataLength;
  });
  cdp.on("Network.responseReceived", ({ requestId, response }) => {
    if (!/^https?:/.test(response.url) || fromCache.has(requestId) || response.fromDiskCache || response.fromPrefetchCache || response.fromServiceWorker) return;
    const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const kind = classify(response.url, headers);
    if (kind !== "external") counted.add(requestId);
    seen.push({ url: response.url, status: response.status, kind });
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await closeHowTo(page);
  // Lazy pictures: scroll to the bottom in steps, then let the network settle.
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await context.close();
  const db = DB ? await (await fetch(`${DB}/__counts`)).json() : null;
  // A POST the read-only browser stopped would have run a function: counted, not sent.
  for (const [key, n] of stopped) if (!key.includes(" /_vercel/")) for (let i = 0; i < n; i++) seen.push({ url: `${BASE}${key.split(" ")[1]}`, method: key.split(" ")[0], status: 0, kind: "function" });
  const count = (k) => seen.filter((r) => r.kind === k).length;
  const list = (k) => [...new Set(seen.filter((r) => r.kind === k).map((r) => new URL(r.url).pathname.replace(/\/[0-9a-f-]{20,}/g, "/…")))];
  return {
    ...(db && { db: db.total, dbCalls: db.calls }),
    kb: Math.round(bytes / 1024),
    function: count("function"),
    cdnFn: count("cdn-fn"),
    image: count("image"),
    static: count("static"),
    external: count("external"),
    functions: list("function"),
    cdnFunctions: list("cdn-fn"),
    images: list("image").length ? [...new Set(seen.filter((r) => r.kind === "image").map((r) => decodeURIComponent(new URL(r.url).search).slice(0, 120)))] : [],
  };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = {};
try {
  for (const path of paths) {
    results[path] = { first: await visit(browser, path, false), next: await visit(browser, path, true) };
    const { first, next } = results[path];
    console.log(
      `${path.padEnd(24)} first visit: ${first.function} function, ${first.cdnFn} cdn-fn, ${first.image} image | next page: ${next.function} function, ${next.cdnFn} cdn-fn, ${next.image} image` +
        ` | ${first.kb} KB first visit, ${next.kb} KB next page` +
        (first.db !== undefined ? ` | database: ${first.db} first visit, ${next.db} next page` : "") +
        (first.functions.length ? `\n    functions: ${first.functions.join(" ")}` : "") +
        (first.cdnFunctions.length ? `\n    cdn-fn: ${first.cdnFunctions.join(" ")}` : "") +
        (first.images.length ? `\n    images: ${first.images.length} distinct` : "")
    );
  }
} finally {
  await browser.close();
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
