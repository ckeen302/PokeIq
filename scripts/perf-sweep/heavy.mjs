/**
 * Heavy pages: frame rate while the 3D / canvas is in use, and memory over a few minutes of use.
 *
 *   node scripts/perf-sweep/heavy.mjs [baseUrl] [--profile=phone|desktop] [--minutes=3] [--only=lab-dex,sizes] [--out=file.json]
 *
 * For each page: load it, wait for it to settle, then repeat a cycle (the page's own interaction: drags, taps,
 * scrolls; then a client-side trip to another page and back, which unmounts and remounts it) until the time is up.
 * After each cycle it forces a garbage collection and records the JS heap, DOM nodes, event listeners and the
 * frame rate measured during the interaction. "Flat memory" means the heap after the last cycles is about where
 * it was after the first.
 *
 * Headless Chromium here draws WebGL in software (SwiftShader), so frame rates are a floor, not what a GPU gives;
 * they are useful for comparing before and after on the same machine.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROFILES } from "./measure.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const BASE = argv.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const PROFILE = flag("profile", "phone");
const MINUTES = Number(flag("minutes", "3"));
const ONLY = flag("only", "").split(",").filter(Boolean);
const OUT = flag("out", path.join(HERE, "results", `heavy-${PROFILE}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));

async function drag(page, x0, y0, dx, dy, steps = 20) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
const center = (page) => {
  const v = page.viewportSize();
  return [v.width / 2, v.height / 2];
};
async function clickIf(page, locator) {
  const el = locator.filter({ visible: true }).first();
  if (await el.count()) {
    await el.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

/** [label, path, the page's own interaction (runs while frames are counted), where the round trip goes] */
export const HEAVY = [
  [
    "lab-dex",
    "/lab/pokedex",
    async (page) => {
      const [x, y] = center(page);
      for (let i = 0; i < 3; i++) {
        await drag(page, x + 120, y, -240, 0);
        await page.waitForTimeout(400);
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(300);
      }
    },
    "/lab",
  ],
  [
    "sizes",
    "/pokedex/sizes",
    async (page) => {
      const [x, y] = center(page);
      for (let i = 0; i < 3; i++) {
        await drag(page, x, y, -200, 0);
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(400);
      }
    },
    "/lab",
  ],
  [
    "story",
    "/lab/pokemon-story/cable",
    async (page) => {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(1500);
      const [x, y] = center(page);
      await drag(page, x, y, -150, 0);
    },
    "/lab",
  ],
  [
    "history",
    "/lab/world-history/alola",
    async (page) => {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(1500);
      const [x, y] = center(page);
      await drag(page, x, y, -150, 0);
    },
    "/lab",
  ],
  [
    "mass-battle",
    "/lab/mass-battle/fire-vs-water",
    async (page) => {
      await clickIf(page, page.getByRole("button", { name: /^(start|fight|battle|run|play)/i }));
      await page.waitForTimeout(2500);
      const [x, y] = center(page);
      await drag(page, x, y, -150, 40);
    },
    "/lab",
  ],
  [
    "battle-play",
    "/battle/play",
    async (page) => {
      await clickIf(page, page.getByRole("button", { name: /random battle|start|battle/i }));
      await page.waitForTimeout(3000);
      await clickIf(page, page.locator("[data-testid^=move-], button[name=chooseMove]"));
      await page.waitForTimeout(2000);
    },
    "/battle",
  ],
  [
    "tier-list",
    "/tools/tier-list/starters",
    async (page) => {
      const pool = page.locator("[data-testid=tier-pool] img, [data-testid=tier-pool] button").filter({ visible: true });
      const row = page.locator("[data-testid^=tier-row]").filter({ visible: true }).first();
      for (let i = 0; i < 3; i++) {
        const a = await pool.first().boundingBox().catch(() => null);
        const b = await row.boundingBox().catch(() => null);
        if (a && b) await drag(page, a.x + a.width / 2, a.y + a.height / 2, b.x + 200 - a.x, b.y + b.height / 2 - a.y, 15);
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(300);
        await page.mouse.wheel(0, -300);
      }
    },
    "/tools",
  ],
  [
    "shiny-maker",
    "/tools/shiny-maker",
    async (page) => {
      const sw = page.locator("input[type=range]").filter({ visible: true });
      const n = await sw.count();
      for (let i = 0; i < Math.min(n, 3); i++) {
        const b = await sw.nth(i).boundingBox();
        if (b) await drag(page, b.x + 4, b.y + b.height / 2, b.width * 0.6, 0, 15);
      }
      await clickIf(page, page.getByRole("button", { name: /random|shuffle|surprise/i }));
      await page.waitForTimeout(800);
    },
    "/tools",
  ],
  [
    "pokeball-maker",
    "/tools/pokeball-maker",
    async (page) => {
      const c = page.locator("canvas").filter({ visible: true }).first();
      const b = await c.boundingBox().catch(() => null);
      if (b) {
        for (let i = 0; i < 3; i++) await drag(page, b.x + b.width / 2, b.y + b.height / 2, 120, 30);
      }
      await clickIf(page, page.getByRole("button", { name: /open|random|surprise/i }));
      await page.waitForTimeout(800);
    },
    "/tools",
  ],
];

async function sample(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents };
}

/** Client-side trip: a real link click to `away` when the page has one (Next's router, so the page unmounts), else history. */
async function roundTrip(page, away, home) {
  const link = page.locator(`a[href="${away}"]`).filter({ visible: true }).first();
  if (await link.count()) await link.click().catch(() => {});
  else await page.evaluate((u) => window.next?.router?.push(u), away);
  await page.waitForURL((u) => u.pathname === away, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goBack().catch(() => {});
  await page.waitForURL((u) => u.pathname === home, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function run(browser, [label, route, act, away], prof) {
  const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: Math.min(prof.deviceScaleFactor, 2), isMobile: prof.isMobile, hasTouch: false, ...(prof.userAgent && { userAgent: prof.userAgent }) });
    // No first-visit splash: the cycle drives the page itself.
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("pokeiq-splash", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (prof.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
  const consoleMsgs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  await page.goto(BASE + route, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(8000);
  const cycles = [];
  const t0 = Date.now();
  const first = await sample(cdp);
  while (Date.now() - t0 < MINUTES * 60000) {
    const fpsP = page.evaluate(() => {
      const frames = [];
      const start = performance.now();
      return new Promise((res) => {
        const tick = (t) => {
          frames.push(t);
          if (t - start < 4000) requestAnimationFrame(tick);
          else {
            const gaps = frames.slice(1).map((f, i) => f - frames[i]).sort((a, b) => a - b);
            res({ fps: +((frames.length - 1) / ((frames.at(-1) - frames[0]) / 1000)).toFixed(1), p95Frame: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), worst: Math.round(gaps.at(-1) ?? 0) });
          }
        };
        requestAnimationFrame(tick);
      });
    });
    await act(page).catch((e) => consoleMsgs.push(`interaction: ${String(e.message).split("\n")[0]}`));
    const fps = await fpsP.catch(() => null);
    await roundTrip(page, away, route);
    const s = await sample(cdp);
    cycles.push({ t: Math.round((Date.now() - t0) / 1000), ...s, ...fps });
    console.log(`${label} t=${cycles.at(-1).t}s heap ${s.heapMB}MB nodes ${s.nodes} listeners ${s.listeners} fps ${fps?.fps} p95 ${fps?.p95Frame}ms`);
  }
  await ctx.close();
  const heaps = cycles.map((c) => c.heapMB);
  const early = heaps.slice(0, 2);
  const late = heaps.slice(-2);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    label,
    route,
    first,
    cycles,
    heapGrowthMB: +(avg(late) - avg(early)).toFixed(1),
    fpsMedian: [...cycles.map((c) => c.fps ?? 0)].sort((a, b) => a - b)[Math.floor(cycles.length / 2)] ?? null,
    console: [...new Set(consoleMsgs)].slice(0, 12),
  };
}

async function main() {
  const prof = PROFILES[PROFILE];
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const out = [];
  for (const h of HEAVY.filter(([l]) => !ONLY.length || ONLY.includes(l))) {
    const r = await run(browser, h, prof).catch((e) => ({ label: h[0], error: String(e.message).slice(0, 300) }));
    out.push(r);
    console.log(`== ${r.label}: heap growth ${r.heapGrowthMB} MB, median fps ${r.fpsMedian}${r.error ? " ERROR " + r.error : ""}`);
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ profile: PROFILE, minutes: MINUTES, at: new Date().toISOString(), results: out }, null, 1));
  console.log(`wrote ${OUT}`);
  console.log("| page | heap first → last (MB) | growth (MB) | median fps | worst p95 frame |\n| --- | --- | --- | --- | --- |");
  for (const r of out)
    if (r.cycles)
      console.log(`| ${r.label} | ${r.cycles[0]?.heapMB} → ${r.cycles.at(-1)?.heapMB} | ${r.heapGrowthMB} | ${r.fpsMedian} | ${Math.max(...r.cycles.map((c) => c.p95Frame ?? 0))} ms |`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
