/**
 * Launch-day check: read-only, safe to run against production.
 *
 *   node scripts/launch-check.mjs <baseUrl> [--canonical <origin>] [--lcp <ms>] [--only phone|desktop]
 *
 * Visits every main route on a phone (390 × 844) and a desktop (1440 × 900)
 * profile and checks: status 200, no console or page errors, no horizontal
 * scroll on the phone, the page's key element is visible (each daily's board
 * renders and takes a first input, which is never submitted), and the
 * Largest Contentful Paint is under the threshold. Then: every page's
 * canonical URL and share image are on the canonical host, the share images
 * are images of the size their tags say (1200 × 630), and robots.txt,
 * sitemap.xml and the web manifest load.
 *
 * Read-only by construction: the browser's only requests that leave are GETs
 * (and HEAD / CORS preflights). Every other request (a score, a sign-up, an
 * analytics beacon, a presence ping) is stopped before it is sent, and pages
 * are never asked to submit anything. Prints a pass/fail table; exits 1 when
 * any check fails.
 *
 * --canonical: the origin canonical tags and share images must use. Defaults
 * to the base URL's own origin; a local production build points them at
 * NEXT_PUBLIC_SITE_URL (else https://playpokeiq.com), so pass that there.
 * Share images on the canonical host are fetched from the base URL instead.
 *
 * Set CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { chromium } from "playwright";
import { PROFILES as ALL_PROFILES, ROUTES, closeHowTo, readOnly } from "./read-only-browser.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = (args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const CANONICAL = (flag("canonical", new URL(BASE).origin) ?? "").replace(/\/+$/, "");
const LCP_MS = Number(flag("lcp", 4000));
const ONLY = flag("only", null);

const PROFILES = ALL_PROFILES.filter((p) => !ONLY || p.name === ONLY);

const results = [];
/** One row of the table: check, where (route / profile), pass, detail. */
function record(check, where, ok, detail = "") {
  results.push({ check, where, ok, detail });
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
/** Share images and canonical URLs seen on the pages, checked once each after the visits. */
const shareImages = new Map();
const canonicals = [];
/** Every write the pages tried, stopped before it was sent (reported, so a run shows nothing left). */
const stopped = new Map();

for (const profile of PROFILES) {
  const { name, ...options } = profile;
  for (const route of ROUTES) {
    const where = `${route.path} (${name})`;
    // A fresh context per page: a first visit, as a new player sees it.
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    await context.addInitScript(() => {
      window.__lcp = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        // No LCP in this browser: reported as 0.
      }
    });
    const blocked = new Set();
    await readOnly(context, blocked, stopped);
    const page = await context.newPage();
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Our own blocking of writes shows up as failed loads (or failed fetches the page reports); those aren't the site's errors.
      if (/ERR_BLOCKED_BY_CLIENT/.test(text) || (blocked.size && /Failed to fetch|Failed to load resource/.test(text))) return;
      errors.push(text.slice(0, 160));
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 160)}`));
    const failed = [];
    page.on("response", (res) => {
      const url = res.url();
      if (res.status() >= 400 && url.startsWith(BASE) && !blocked.has(url)) failed.push(`${res.status()} ${url.slice(BASE.length)}`);
    });

    let res = null;
    try {
      res = await page.goto(BASE + route.path, { waitUntil: "load", timeout: 60_000 });
    } catch (e) {
      record("loads", where, false, e.message.split("\n")[0]);
    }
    const status = res?.status() ?? 0;
    record("status 200", where, status === 200, String(status));
    if (status === 200) {
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const lcp = Math.round(await page.evaluate(() => window.__lcp));
      record(`LCP < ${LCP_MS} ms`, where, lcp > 0 && lcp < LCP_MS, `${lcp} ms`);

      await closeHowTo(page);
      const key = page.locator(route.key).first();
      const visible = await key.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
      record("key element visible", where, visible, route.key);
      if (visible && route.input) {
        const ok = await route.input(page).then(() => null, (e) => e.message.split("\n")[0]);
        record("board takes a first input", where, !ok, ok ?? "");
      }

      if (name === "phone") {
        const [scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        record("no horizontal scroll", where, scrollWidth <= width + 1, `${scrollWidth}px wide in ${width}px`);
      }

      const meta = await page.evaluate(() => {
        const content = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
        return {
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
          image: content('meta[property="og:image"]'),
          width: Number(content('meta[property="og:image:width"]')) || null,
          height: Number(content('meta[property="og:image:height"]')) || null,
          twitter: content('meta[name="twitter:image"]'),
        };
      });
      if (name === PROFILES[0].name) {
        canonicals.push({ path: route.path, href: meta.canonical });
        for (const url of [meta.image, meta.twitter]) if (url && !shareImages.has(url)) shareImages.set(url, { from: route.path, width: meta.width, height: meta.height });
        if (!meta.image) record("share image tag", route.path, false, "no og:image");
      }
    }
    record("no console errors", where, errors.length === 0, errors.slice(0, 2).join(" | "));
    record("no failed requests", where, failed.length === 0, failed.slice(0, 3).join(", "));
    await context.close();
  }
}
await browser.close();

for (const { path, href } of canonicals) {
  const ok = !!href && href.startsWith(CANONICAL) && new URL(href).pathname.replace(/\/$/, "") === path.replace(/\/$/, "");
  record("canonical on base host", path, ok, href ?? "missing");
}

/** Reads an image's pixel size from its first bytes (PNG, JPEG or WebP). */
function imageSize(buf) {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
    }
    if (kind === "VP8X") return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

/** A URL on the canonical host is fetched from the base URL (the deployment under test). */
const local = (url) => (url.startsWith(CANONICAL) ? BASE + url.slice(CANONICAL.length) : url);

for (const [url, { from, width, height }] of shareImages) {
  const where = `${new URL(url).pathname}${new URL(url).search} (from ${from})`;
  record("share image on base host", where, url.startsWith(CANONICAL), url.startsWith(CANONICAL) ? "" : url);
  try {
    const res = await fetch(local(url), { signal: AbortSignal.timeout(30_000) });
    const type = res.headers.get("content-type") ?? "";
    const size = res.ok ? imageSize(Buffer.from(await res.arrayBuffer())) : null;
    const want = [width ?? 1200, height ?? 630];
    const ok = res.ok && type.startsWith("image/") && !!size && size[0] === want[0] && size[1] === want[1];
    record("share image size", where, ok, `${res.status} ${type} ${size ? size.join("×") : "?"} (want ${want.join("×")})`);
  } catch (e) {
    record("share image size", where, false, e.message);
  }
}

/** robots.txt, the sitemap and the web manifest. */
async function get(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}
try {
  const robots = await get("/robots.txt");
  const sitemapLine = robots.body.match(/^Sitemap:\s*(\S+)/im)?.[1] ?? "";
  record("robots.txt", "/robots.txt", robots.status === 200 && /User-Agent:\s*\*/i.test(robots.body) && sitemapLine.startsWith(CANONICAL), `${robots.status}, sitemap ${sitemapLine || "missing"}`);
  const sitemap = await get("/sitemap.xml");
  const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const offHost = urls.filter((u) => !u.startsWith(CANONICAL));
  record("sitemap.xml", "/sitemap.xml", sitemap.status === 200 && urls.length > 0 && offHost.length === 0, `${sitemap.status}, ${urls.length} URLs${offHost.length ? `, ${offHost.length} off host (${offHost[0]})` : ""}`);
  const manifest = await get("/manifest.webmanifest");
  let parsed = null;
  try {
    parsed = JSON.parse(manifest.body);
  } catch {
    // Reported below.
  }
  const icons = parsed?.icons ?? [];
  record("web manifest", "/manifest.webmanifest", manifest.status === 200 && !!parsed?.name && icons.length > 0, `${manifest.status}, ${parsed ? `${parsed.name}, ${icons.length} icons` : "not JSON"}`);
  for (const icon of icons) {
    const res = await fetch(new URL(icon.src, BASE + "/"), { signal: AbortSignal.timeout(30_000) });
    const size = res.ok ? imageSize(Buffer.from(await res.arrayBuffer())) : null;
    const want = String(icon.sizes ?? "").split(" ")[0];
    record("manifest icon", icon.src, res.ok && (!/^\d+x\d+$/.test(want) || (size && `${size[0]}x${size[1]}` === want)), `${res.status} ${size ? size.join("×") : "?"}${want ? ` (want ${want})` : ""}`);
  }
} catch (e) {
  record("site files", BASE, false, e.message);
}

// The table: one line per check, failures first in the summary.
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`\nLaunch check: ${BASE} (canonical ${CANONICAL}, LCP < ${LCP_MS} ms)\n`);
console.log(`${pad("", 4)} ${pad("check", 26)} ${pad("where", 38)} detail`);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${pad(r.check, 26)} ${pad(r.where, 38)} ${r.ok && r.check.startsWith("no ") ? "" : r.detail}`);
if (stopped.size) console.log(`\nStopped before sending (read-only): ${[...stopped].map(([k, n]) => `${k} ×${n}`).join(", ")}`);
const failures = results.filter((r) => !r.ok);
console.log(`\n${results.length - failures.length}/${results.length} checks passed${failures.length ? `, ${failures.length} failed` : ""}.`);
process.exit(failures.length ? 1 : 0);
