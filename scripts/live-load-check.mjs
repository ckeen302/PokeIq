/**
 * A gentle, read-only crowd check against a live site.
 *
 *   node scripts/live-load-check.mjs https://playpokeiq.com [--browsers 20] [--rps 4] [--minutes 4] [--loads 300]
 *
 * Up to --browsers real browsers at once (half phone 390 × 844, half desktop
 * 1440 × 900) open the main pages and the 3D Lab, and each daily's board
 * takes a first input that is never submitted. Page loads start no faster
 * than --rps a second in total (at most 5), the run stops after --minutes (at
 * most 5) or --loads page loads, and the browser is read-only: every request
 * that isn't a GET, HEAD or CORS preflight is stopped before it is sent
 * (read-only-browser.mjs, as launch-check.mjs).
 *
 * Per page: Largest Contentful Paint, Cumulative Layout Shift, long tasks
 * (count and total ms over 50 ms each), console errors, and failed requests
 * (4xx/5xx or network failures on the site's own host). Prints p50/p95 per
 * page and profile, and every distinct error.
 */
import { chromium } from "playwright";
import { PROFILES, ROUTES, closeHowTo, readOnly } from "./read-only-browser.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = (args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const BROWSERS = Math.min(20, Number(flag("browsers", 20)));
const RPS = Math.min(5, Number(flag("rps", 4)));
const MINUTES = Math.min(5, Number(flag("minutes", 4)));
const MAX_LOADS = Number(flag("loads", 300));
const JSON_OUT = flag("json", "");

const PAGES = [...ROUTES.filter((r) => !["/privacy", "/rooms", "/atlas"].includes(r.path))];
const host = new URL(BASE).host;
const stopAt = Date.now() + MINUTES * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Page loads start at most RPS a second across every browser. */
let nextSlot = Date.now();
let loads = 0;
async function slot() {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + 1000 / RPS;
  await sleep(at - Date.now());
  return Date.now() < stopAt && loads++ < MAX_LOADS;
}

const rows = [];
const stopped = new Map();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function visit(profile, route) {
  const { name, ...options } = profile;
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  await context.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, longTasks: 0, longMs: 0 };
    const watch = (type, fn) => {
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true });
      } catch {
        // Not in this browser.
      }
    };
    watch("largest-contentful-paint", (e) => (window.__m.lcp = e.startTime));
    watch("layout-shift", (e) => {
      if (!e.hadRecentInput) window.__m.cls += e.value;
    });
    watch("longtask", (e) => {
      window.__m.longTasks++;
      window.__m.longMs += e.duration;
    });
  });
  const blocked = new Set();
  await readOnly(context, blocked, stopped);
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/ERR_BLOCKED_BY_CLIENT/.test(text) || (blocked.size && /Failed to fetch|Failed to load resource/.test(text))) return;
    errors.push(text.slice(0, 200));
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 200)}`));
  page.on("response", (res) => {
    if (res.status() >= 400 && new URL(res.url()).host === host && !blocked.has(res.url())) failed.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  page.on("requestfailed", (req) => {
    if (new URL(req.url()).host === host && !blocked.has(req.url()) && !/ERR_ABORTED/.test(req.failure()?.errorText ?? "")) failed.push(`${req.failure()?.errorText} ${new URL(req.url()).pathname}`);
  });
  const row = { path: route.path, profile: name, status: 0, lcp: 0, cls: 0, longTasks: 0, longMs: 0, errors, failed, input: null };
  const t0 = Date.now();
  try {
    const res = await page.goto(BASE + route.path, { waitUntil: "load", timeout: 60_000 });
    row.status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await closeHowTo(page);
    if (route.input) {
      const visible = await page.locator(route.key).first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
      row.input = visible ? await route.input(page).then(() => "ok", (e) => e.message.split("\n")[0].slice(0, 120)) : "board not visible";
      await sleep(500);
    }
    Object.assign(row, await page.evaluate(() => window.__m));
  } catch (e) {
    errors.push(`load: ${e.message.split("\n")[0].slice(0, 160)}`);
  }
  row.ms = Date.now() - t0;
  rows.push(row);
  await context.close();
}

let turn = 0;
async function worker(i) {
  const profile = PROFILES[i % PROFILES.length];
  while (await slot()) {
    const route = PAGES[(turn++ * 7 + i) % PAGES.length];
    await visit(profile, route);
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: BROWSERS }, (_, i) => worker(i)));
await browser.close();

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
console.log(`\nLive load check: ${BASE}, ${rows.length} page loads in ${Math.round((Date.now() - started) / 1000)} s, ${BROWSERS} browsers, ≤ ${RPS} loads/s\n`);
console.log(`${"page".padEnd(22)} ${"profile".padEnd(8)}  n  LCP p50  LCP p95  CLS max  long tasks (ms)  errors  failed  input`);
const groups = new Map();
for (const r of rows) {
  const k = `${r.path}|${r.profile}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
for (const [k, rs] of [...groups].sort()) {
  const [path, profile] = k.split("|");
  const inputs = [...new Set(rs.map((r) => r.input).filter(Boolean))].join("; ");
  console.log(
    `${path.padEnd(22)} ${profile.padEnd(8)} ${String(rs.length).padStart(2)}  ${String(Math.round(pct(rs.map((r) => r.lcp), 50))).padStart(7)}  ${String(Math.round(pct(rs.map((r) => r.lcp), 95))).padStart(7)}  ${Math.max(...rs.map((r) => r.cls)).toFixed(3).padStart(7)}  ${String(Math.round(pct(rs.map((r) => r.longTasks), 50))).padStart(4)} (${String(Math.round(pct(rs.map((r) => r.longMs), 50))).padStart(5)})    ${String(rs.reduce((n, r) => n + r.errors.length, 0)).padStart(4)}  ${String(rs.reduce((n, r) => n + r.failed.length, 0)).padStart(6)}  ${inputs}`
  );
}
const distinct = (key) => [...rows.flatMap((r) => r[key].map((e) => `${r.path} (${r.profile}): ${e}`)).reduce((m, e) => m.set(e, (m.get(e) ?? 0) + 1), new Map())];
for (const key of ["errors", "failed"]) {
  const list = distinct(key);
  if (list.length) console.log(`\n${key}:\n${list.map(([e, n]) => `  ×${n} ${e}`).join("\n")}`);
}
if (stopped.size) console.log(`\nStopped before sending (read-only): ${[...stopped].map(([k, n]) => `${k} ×${n}`).join(", ")}`);
const bad = rows.filter((r) => r.status !== 200);
console.log(`\nNon-200 page loads: ${bad.length}${bad.length ? ` (${bad.map((r) => `${r.status} ${r.path}`).slice(0, 5).join(", ")})` : ""}`);
if (JSON_OUT) (await import("node:fs")).writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
