/**
 * The 3D Lab audit: opens each live Lab experience the way a phone and two
 * desktops would and measures how it loads and runs.
 *
 *   npm run build && npm start -- -p 3000
 *   node scripts/lab-audit.mjs [baseUrl] [--only=sizes,globe] [--sizes=phone,1440,1710] [--minutes=3] [--out=dir]
 *
 * Phone: 390 × 844 at 3x, touch, 4× CPU slowdown and a Slow-4G-like network
 * (150 ms round trip, 1.6 Mbps down, 750 kbps up). Desktop: 1440 × 900 and
 * 1710 × 987, unthrottled.
 *
 * For each it records: first paint and largest paint (from the browser),
 * the first frame of the scene (the stage's ready flag) and when it first
 * answers a tap (ready + the first interaction's latency), long tasks and
 * the frame rate while it's used for 20 seconds (drags, wheel, arrow keys),
 * and the JS heap every 30 seconds for a few minutes after that.
 *
 * Machines without a GPU draw WebGL in software (SwiftShader), so frame
 * rates are far lower and long tasks far longer than on a real phone or
 * laptop: compare the experiences with each other, not with real devices.
 * Writes <out>/lab-audit.json and a phone screenshot per experience.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const ONLY = opt("only", "")?.split(",").filter(Boolean);
const SIZES = opt("sizes", "phone,1440,1710").split(",");
const MINUTES = Number(opt("minutes", "3"));
const OUT = opt("out", "lab-audit");
fs.mkdirSync(OUT, { recursive: true });

/** Each live experience: its page, the selector that says its scene is drawn, and what a visitor does first. */
const EXPERIENCES = [
  { id: "pokedex", name: "Professor's Lab", path: "/lab/pokedex?pick=25", ready: '[data-testid="lab-stage"][data-ready="1"]', keys: ["ArrowRight", "ArrowRight", "ArrowLeft"] },
  { id: "pokemon-story", name: "The Story of Pokémon", path: "/lab/pokemon-story", ready: '[data-testid="ps-stage"][data-ready="1"]', wheel: true },
  { id: "timeline", name: "Timeline", path: "/pokedex/timeline", ready: '[data-testid="timeline-stage"][data-ready="1"]', wheel: true },
  { id: "sizes", name: "Pokémon Sizes", path: "/pokedex/sizes", ready: '[data-testid="sizes-stage"][data-ready="1"]', wheel: true, drag: true },
  { id: "globe", name: "World Globe", path: "/pokeguessr/globe", ready: '[data-testid="world-globe"][data-state="ready"]', click: '[data-testid="globe-intro"]', drag: true, wheel: true },
  { id: "mass-battle", name: "Mass Battle", path: "/lab/mass-battle", ready: '[data-testid="mb-stage"] canvas', click: '[data-testid="mb-play"]', drag: true },
  { id: "world-history", name: "History of the Pokémon World", path: "/lab/world-history", ready: '[data-testid="wh-stage"][data-ready="1"]', wheel: true },
];

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4, net: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } },
  1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  1710: { viewport: { width: 1710, height: 987 }, deviceScaleFactor: 2 },
};

/** Runs in the page before anything else: paints, long tasks, frames, interactions, and when the ready selector first matches. */
function probe(readySel) {
  const m = (window.__audit = { longTasks: [], fcp: null, lcp: null, readyAt: null, frames: [], events: [], errors: [] });
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => m.longTasks.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === "first-contentful-paint") m.fcp = e.startTime; })).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { m.lcp = e.startTime; m.lcpEl = e.element ? `${e.element.tagName}${e.element.getAttribute("data-testid") ? `[${e.element.getAttribute("data-testid")}]` : ""}${e.url ? ` ${e.url.split("/").slice(-2).join("/")}` : ""}` : e.url; })).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId) m.events.push([e.startTime, e.duration, e.name]); })).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {}
  const tick = (t) => { m.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const check = () => {
    if (m.readyAt === null && document.querySelector(readySel)) m.readyAt = performance.now();
    if (m.readyAt === null) setTimeout(check, 50);
  };
  check();
  sessionStorage.setItem("pokeiq-splash", "1");
  localStorage.setItem("pokeiq-muted", "1");
}

const r0 = (x) => (x == null ? null : Math.round(x));

async function heap(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const get = (n) => metrics.find((x) => x.name === n)?.value;
  return { heapMB: +(get("JSHeapUsedSize") / 1048576).toFixed(1), nodes: get("Nodes"), listeners: get("JSEventListeners") };
}

async function exercise(page, e, vp, seconds) {
  const box = { x: vp.viewport.width / 2, y: vp.viewport.height / 2 };
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    if (e.drag) {
      await page.mouse.move(box.x - 80, box.y);
      await page.mouse.down();
      for (let k = 0; k < 8; k++) await page.mouse.move(box.x - 80 + k * 20, box.y + (k % 2) * 6);
      await page.mouse.up();
    }
    if (e.wheel) {
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel(0, 240);
    }
    if (e.keys) await page.keyboard.press(e.keys[i % e.keys.length]);
    i++;
    await page.waitForTimeout(700);
  }
}

async function run(browser, e, size) {
  const vp = VIEWPORTS[size];
  const context = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  await context.addInitScript(probe, e.ready);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err.message).slice(0, 200)}`));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text().slice(0, 200)}`); });
  let bytes = 0;
  page.on("response", async (res) => { const l = Number(res.headers()["content-length"] ?? 0); bytes += l; });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (vp.cpu) await cdp.send("Emulation.setCPUThrottlingRate", { rate: vp.cpu });
  if (vp.net) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...vp.net });
  }
  const res = { id: e.id, name: e.name, size, errors };
  const t0 = Date.now();
  try {
    await page.goto(BASE + e.path, { waitUntil: "commit", timeout: 120_000 });
    await page.waitForSelector(e.ready, { timeout: 240_000, state: "attached" });
  } catch (err) {
    res.failed = String(err.message).split("\n")[0];
  }
  const loadWall = Date.now() - t0;
  await page.waitForTimeout(1500);
  if (size === "phone") await page.screenshot({ path: path.join(OUT, `${e.id}-${size}-ready.png`) }).catch(() => {});
  const a = await page.evaluate(() => {
    const m = window.__audit;
    return { fcp: m.fcp, lcp: m.lcp, lcpEl: m.lcpEl, readyAt: m.readyAt, longBefore: m.longTasks.filter(([s]) => s <= (m.readyAt ?? Infinity)) };
  });
  Object.assign(res, { fcp: r0(a.fcp), lcp: r0(a.lcp), lcpEl: a.lcpEl, ready: r0(a.readyAt), loadWall, longTasksBeforeReady: a.longBefore.length, tbtBeforeReady: r0(a.longBefore.reduce((s, [, d]) => s + Math.max(0, d - 50), 0)) });
  res.heapAtReady = await heap(cdp);
  // First interaction: a click on the stage's first control, or a key, timed by the browser.
  const tUse = await page.evaluate(() => performance.now());
  if (e.click) await page.locator(e.click).first().click({ timeout: 10_000 }).catch(() => {});
  else await page.mouse.click(vp.viewport.width / 2, vp.viewport.height / 2).catch(() => {});
  await exercise(page, e, vp, 20);
  const tEnd = await page.evaluate(() => performance.now());
  const u = await page.evaluate(([a, b]) => {
    const m = window.__audit;
    const fr = m.frames.filter((t) => t >= a && t <= b);
    const gaps = fr.slice(1).map((t, i) => t - fr[i]).sort((x, y) => x - y);
    const lt = m.longTasks.filter(([s]) => s >= a && s <= b);
    const ev = m.events.filter(([s]) => s >= a);
    return {
      fps: fr.length / ((b - a) / 1000),
      p95FrameMs: gaps[Math.floor(gaps.length * 0.95)] ?? null,
      longTasks: lt.length,
      longestTask: lt.reduce((x, [, d]) => Math.max(x, d), 0),
      tbt: lt.reduce((s, [, d]) => s + Math.max(0, d - 50), 0),
      firstInput: ev[0]?.[1] ?? null,
      worstInput: ev.reduce((x, [, d]) => Math.max(x, d), 0) || null,
    };
  }, [tUse, tEnd]);
  Object.assign(res, { fps: +u.fps.toFixed(1), p95FrameMs: r0(u.p95FrameMs), longTasksInUse: u.longTasks, longestTaskMs: r0(u.longestTask), tbtInUse: r0(u.tbt), firstInputMs: r0(u.firstInput), worstInputMs: r0(u.worstInput) });
  res.tti = res.ready != null ? res.ready + (res.firstInputMs ?? 0) : null;
  // Memory over a few minutes, used lightly every 30 seconds.
  const samples = [res.heapAtReady];
  const minutes = size === "1710" ? Math.min(1, MINUTES) : MINUTES;
  for (let s = 0; s < minutes * 2; s++) {
    await exercise(page, e, vp, 3);
    await page.waitForTimeout(27_000);
    samples.push(await heap(cdp));
  }
  res.heap = samples.map((s) => s.heapMB);
  res.nodes = samples.map((s) => s.nodes);
  res.transferKB = Math.round(bytes / 1024);
  if (size === "phone") await page.screenshot({ path: path.join(OUT, `${e.id}-${size}-end.png`) }).catch(() => {});
  await context.close();
  return res;
}

const browser = await chromium.launch({ ...(process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH }), args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
const file = path.join(OUT, "lab-audit.json");
const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
for (const e of EXPERIENCES.filter((x) => !ONLY?.length || ONLY.includes(x.id))) {
  for (const size of SIZES) {
    const r = await run(browser, e, size);
    const i = results.findIndex((x) => x.id === r.id && x.size === r.size);
    if (i >= 0) results[i] = r;
    else results.push(r);
    fs.writeFileSync(file, JSON.stringify(results, null, 1));
    console.log(JSON.stringify(r));
  }
}
await browser.close();
