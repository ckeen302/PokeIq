/**
 * Speed sweep: loads each route of a running production build in Chromium and records what a visitor feels.
 *
 *   node scripts/perf-sweep/measure.mjs [baseUrl] --profile=phone|desktop [--runs=3] [--only=home,pokedex] [--shard=1/2] [--out=file.json]
 *   node scripts/perf-sweep/summary.mjs a.json [b.json ...]     # one p75 table from several files (shards, before/after)
 *
 * Profiles:
 *   desktop  1440 × 900, no throttling
 *   phone    390 × 844 (DPR 3, touch), 4× CPU slowdown, Slow 4G (DevTools' preset: 562.5 ms latency, 1.44 Mbps down, 675 kbps up)
 *
 * Per route and run, from a cold browser context: TTFB, FCP, LCP (and its element), CLS (session window, and what shifted),
 * TBT and long tasks (over 50 ms, and the longest after load), interaction latency (Event Timing: a scroll and the route's
 * main interaction from interactions.mjs), JS / image / font bytes before and after load (router prefetches counted apart),
 * the biggest scripts, console errors and warnings, failed requests, and the Cache-Control of what was fetched.
 * The JSON goes to --out (default scripts/perf-sweep/results/<profile>-<stamp>.json); a p75 summary table is printed.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ROUTES } from "./routes.mjs";
import { interactionFor } from "./interactions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const BASE = argv.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const PROFILE = flag("profile", "phone");
const RUNS = Number(flag("runs", "1"));
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = flag("out", path.join(HERE, "results", `${PROFILE}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
const SKIP_INTERACT = argv.includes("--no-interact");
// --shard=1/2: every second route, starting with the first (to run two browsers side by side).
const [SHARD, SHARDS] = flag("shard", "1/1").split("/").map(Number);

export const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1, net: null, settle: 4000 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    cpu: 4,
    // DevTools' "Slow 4G" (what Lighthouse's mobile run applies with DevTools throttling).
    net: { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8, uploadThroughput: (750 * 1024 * 0.9) / 8 },
    settle: 7000,
  },
};

/** Runs in the page before any of its scripts: observers for paint, layout shifts, long tasks and event timing. */
function observe() {
  const P = (window.__perf = { lcp: [], shifts: [], long: [], events: [], fcp: null });
  const describe = (n) => {
    if (!n || n.nodeType !== 1) return n && n.nodeType === 3 ? `#text "${(n.textContent || "").trim().slice(0, 40)}"` : null;
    const el = n;
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const tid = el.getAttribute("data-testid");
    if (tid) s += `[data-testid=${tid}]`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
    if (cls) s += `.${cls}`;
    if (el.tagName === "IMG") s += ` src=${(el.currentSrc || el.src || "").slice(-80)}`;
    const txt = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50);
    if (txt) s += ` "${txt}"`;
    // Where it sits: the nearest ancestor with an id or test id.
    for (let p = el.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) {
      const pid = p.getAttribute("data-testid") || p.id;
      if (pid) {
        s += ` in ${pid}`;
        break;
      }
    }
    return s;
  };
  const r = (x) => (x ? [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)] : null);
  const po = (type, fn, opts = {}) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts });
    } catch {}
  };
  po("largest-contentful-paint", (e) => P.lcp.push({ t: e.startTime, size: e.size, el: describe(e.element), url: e.url || null }));
  po("layout-shift", (e) => {
    if (e.hadRecentInput) return;
    P.shifts.push({ t: e.startTime, v: e.value, src: (e.sources || []).map((s) => ({ el: describe(s.node), from: r(s.previousRect), to: r(s.currentRect) })) });
  });
  po("longtask", (e) => P.long.push({ t: e.startTime, d: e.duration }));
  po("paint", (e) => {
    if (e.name === "first-contentful-paint") P.fcp = e.startTime;
  });
  po("event", (e) => P.events.push({ name: e.name, t: e.startTime, d: e.duration, id: e.interactionId || 0, target: describe(e.target) }), { durationThreshold: 16 });
  po("first-input", (e) => P.events.push({ name: e.name, t: e.startTime, d: e.duration, id: -1, target: describe(e.target) }));
  P.fps = (ms) =>
    new Promise((res) => {
      const frames = [];
      const t0 = performance.now();
      const tick = (t) => {
        frames.push(t);
        if (t - t0 < ms) requestAnimationFrame(tick);
        else {
          const gaps = frames.slice(1).map((f, i) => f - frames[i]);
          res({ fps: (frames.length - 1) / ((frames.at(-1) - frames[0]) / 1000), worstFrame: Math.max(...gaps), over50: gaps.filter((g) => g > 50).length });
        }
      };
      requestAnimationFrame(tick);
    });
}

/** Largest session window of layout shifts (1 s gap, 5 s cap): the CLS definition. */
function clsOf(shifts) {
  let best = 0,
    bestWin = [],
    cur = 0,
    win = [];
  for (const s of shifts) {
    if (win.length && (s.t - win.at(-1).t > 1000 || s.t - win[0].t > 5000)) {
      cur = 0;
      win = [];
    }
    win.push(s);
    cur += s.v;
    if (cur > best) {
      best = cur;
      bestWin = [...win];
    }
  }
  return { cls: best, window: bestWin };
}

const p75 = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil(0.75 * v.length) - 1)];
};

async function measureRoute(browser, route, label, prof) {
  const ctx = await browser.newContext({
    viewport: prof.viewport,
    deviceScaleFactor: prof.deviceScaleFactor,
    isMobile: prof.isMobile,
    hasTouch: prof.hasTouch,
    ...(prof.userAgent && { userAgent: prof.userAgent }),
  });
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Performance.enable");
  if (prof.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
  if (prof.net) await cdp.send("Network.emulateNetworkConditions", prof.net);

  const reqs = new Map();
  let loadAt = null;
  cdp.on("Network.requestWillBeSent", (e) => {
    const h = e.request.headers;
    reqs.set(e.requestId, {
      url: e.request.url,
      type: e.type,
      ts: e.timestamp,
      prefetch: !!(h["Next-Router-Prefetch"] || h["next-router-prefetch"]),
      rsc: !!(h.RSC || h.rsc) || /[?&]_rsc=/.test(e.request.url),
      bytes: 0,
    });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    r.mime = e.response.mimeType;
    r.cache = e.response.headers["cache-control"] || e.response.headers["Cache-Control"] || null;
    r.type = e.type || r.type;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.bytes = e.encodedDataLength;
      r.done = e.timestamp;
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.failed = e.errorText;
      r.canceled = e.canceled;
    }
  });
  cdp.on("Page.loadEventFired", (e) => {
    loadAt ??= e.timestamp;
  });

  const consoleMsgs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${String(e.message).slice(0, 300)}`));

  const url = BASE + route;
  let navError = null;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  } catch (e) {
    navError = String(e.message).slice(0, 200);
  }
  await page.waitForTimeout(prof.settle);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, html: n.encodedBodySize, status: n.responseStatus } : null;
  });
  const before = await page.evaluate(() => {
    const P = window.__perf;
    return { lcp: P.lcp, fcp: P.fcp, shifts: P.shifts.slice(), long: P.long.slice() };
  });
  const fonts = await page.evaluate(() => ({
    preloaded: [...document.querySelectorAll('link[rel=preload][as=font]')].map((l) => l.href.split("/").pop()),
    faces: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight} ${f.display}`),
  }));
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  // Interactions: a few screens of scrolling, then the route's main interaction, if it has one.
  let interactNote = null;
  if (!SKIP_INTERACT && !navError) {
    try {
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, prof.viewport.height * 0.8);
        await page.waitForTimeout(350);
      }
      await page.mouse.wheel(0, -100000);
      await page.waitForTimeout(500);
      const fn = interactionFor(label);
      if (fn) interactNote = (await fn(page, prof)) ?? "ok";
      await page.waitForTimeout(1500);
    } catch (e) {
      interactNote = `interaction failed: ${String(e.message).split("\n")[0].slice(0, 160)}`;
    }
  }
  const after = await page.evaluate(() => {
    const P = window.__perf;
    return { shifts: P.shifts.slice(), long: P.long.slice(), events: P.events.slice() };
  });
  await ctx.close();

  // Network accounting.
  const all = [...reqs.values()];
  const loadTs = loadAt ?? Infinity;
  const kb = (xs) => Math.round(xs.reduce((s, r) => s + (r.bytes || 0), 0) / 102.4) / 10;
  const isJs = (r) => r.type === "Script";
  const prefetches = all.filter((r) => r.prefetch || (r.rsc && r.ts > loadTs));
  const js = all.filter(isJs);
  const lcpFinal = before.lcp.at(-1) ?? null;
  const fcp = before.fcp;
  // Total blocking time: each long task's part after FCP, beyond 50 ms (Lighthouse clips tasks to FCP the same way).
  const tbt = before.long.filter((l) => fcp != null && l.t + l.d > fcp).reduce((s, l) => s + Math.max(0, l.t + l.d - Math.max(l.t, fcp) - 50), 0);
  const loadRel = nav?.load ?? null;
  const longAfterLoad = after.long.filter((l) => loadRel != null && l.t > loadRel);
  const { cls, window: clsWin } = clsOf(before.shifts);
  const { cls: clsAll, window: clsAllWin } = clsOf(after.shifts);
  // Interaction latency: the longest event per interaction id (the INP way).
  const byId = new Map();
  for (const e of after.events) if (e.id) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.d));
  const worstEv = after.events.filter((e) => e.id).sort((a, b) => b.d - a.d)[0] ?? null;
  return {
    route,
    label,
    navError,
    ttfb: nav?.ttfb ?? null,
    fcp,
    lcp: lcpFinal?.t ?? null,
    lcpEl: lcpFinal?.el ?? null,
    lcpUrl: lcpFinal?.url ?? null,
    cls,
    clsSources: clsWin.flatMap((s) => s.src.map((x) => `${s.v.toFixed(4)} ${x.el} ${JSON.stringify(x.from)}→${JSON.stringify(x.to)}`)).slice(0, 8),
    clsWithScroll: clsAll,
    clsScrollSources: clsAllWin
      .filter((s) => !before.shifts.some((b) => b.t === s.t))
      .flatMap((s) => s.src.map((x) => `${s.v.toFixed(4)} ${x.el} ${JSON.stringify(x.from)}→${JSON.stringify(x.to)}`))
      .slice(0, 8),
    tbt: Math.round(tbt),
    longTasks: before.long.length,
    longestTask: Math.round(Math.max(0, ...before.long.map((l) => l.d))),
    longestAfterLoad: Math.round(Math.max(0, ...longAfterLoad.map((l) => l.d))),
    longAfterLoad: longAfterLoad.map((l) => [Math.round(l.t), Math.round(l.d)]),
    inp: byId.size ? Math.round(Math.max(...byId.values())) : null,
    inpEvent: worstEv ? `${worstEv.name} ${Math.round(worstEv.d)}ms ${worstEv.target}` : null,
    interactNote,
    load: loadRel,
    htmlKB: nav ? Math.round(nav.html / 102.4) / 10 : null,
    jsBeforeLoadKB: kb(js.filter((r) => r.ts <= loadTs)),
    jsAfterLoadKB: kb(js.filter((r) => r.ts > loadTs)),
    prefetchKB: kb(prefetches),
    prefetchCount: prefetches.length,
    prefetchRoutes: [...new Set(prefetches.map((r) => new URL(r.url).pathname))].slice(0, 30),
    imageKB: kb(all.filter((r) => r.type === "Image")),
    fontKB: kb(all.filter((r) => r.type === "Font")),
    totalKB: kb(all),
    topJs: js
      .filter((r) => r.ts <= loadTs)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((r) => `${Math.round(r.bytes / 1024)}KB ${new URL(r.url).pathname.split("/").pop()}`),
    bigImages: all
      .filter((r) => r.type === "Image")
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map((r) => `${Math.round(r.bytes / 1024)}KB ${r.url.replace(BASE, "").slice(0, 120)}`),
    fonts: { files: all.filter((r) => r.type === "Font").map((r) => `${Math.round(r.bytes / 1024)}KB ${r.url.split("/").pop()}`), ...fonts },
    failed: all.filter((r) => r.failed && !r.canceled).map((r) => `${r.failed} ${r.url.replace(BASE, "").slice(0, 140)}`),
    badStatus: all.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url.replace(BASE, "").slice(0, 140)}`),
    noCache: all
      .filter((r) => r.url.startsWith(BASE) && r.status === 200 && ["Image", "Font", "Script", "Stylesheet", "Fetch", "XHR"].includes(r.type) && !r.rsc)
      .filter((r) => !r.cache || /no-store|no-cache|max-age=0\b/.test(r.cache))
      .map((r) => `${r.type} ${r.cache ?? "-"} ${r.url.replace(BASE, "").slice(0, 120)}`)
      .slice(0, 12),
    console: consoleMsgs.slice(0, 15),
    heapMB: Math.round((metrics.JSHeapUsedSize ?? 0) / 1048576),
    domNodes: metrics.Nodes ?? null,
  };
}

async function main() {
  const prof = PROFILES[PROFILE];
  if (!prof) throw new Error(`unknown profile ${PROFILE}`);
  const routes = (ONLY.length ? ROUTES.filter(([r, l]) => ONLY.includes(l) || ONLY.includes(r)) : ROUTES).filter((_, i) => i % SHARDS === SHARD - 1);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
  const results = [];
  for (const [route, label] of routes) {
    for (let run = 0; run < RUNS; run++) {
      const r = await measureRoute(browser, route, label, prof).catch((e) => ({ route, label, navError: String(e.message).slice(0, 200) }));
      r.run = run;
      results.push(r);
      console.log(
        `${PROFILE} ${label.padEnd(20)} run${run} ttfb ${fmt(r.ttfb)} fcp ${fmt(r.fcp)} lcp ${fmt(r.lcp)} cls ${r.cls?.toFixed(3)} tbt ${r.tbt} lt>load ${r.longestAfterLoad} inp ${r.inp} js ${r.jsBeforeLoadKB}+${r.jsAfterLoadKB}KB pf ${r.prefetchKB}KB img ${r.imageKB}KB${r.navError ? " ERR " + r.navError : ""}`
      );
    }
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ profile: PROFILE, base: BASE, runs: RUNS, at: new Date().toISOString(), results }, null, 1));
  console.log(`\nwrote ${OUT}\n`);
  console.log(summary(results));
}

const fmt = (x) => (x == null ? "-" : Math.round(x));

export function summary(results) {
  const by = new Map();
  for (const r of results) by.set(r.label, [...(by.get(r.label) ?? []), r]);
  const rows = [["route", "TTFB", "FCP", "LCP", "CLS", "TBT", "LT>load", "INP", "JS KB", "prefetch KB", "img KB"]];
  for (const [label, rs] of by) {
    rows.push([
      label,
      fmt(p75(rs.map((r) => r.ttfb))),
      fmt(p75(rs.map((r) => r.fcp))),
      fmt(p75(rs.map((r) => r.lcp))),
      (p75(rs.map((r) => r.cls)) ?? 0).toFixed(3),
      fmt(p75(rs.map((r) => r.tbt))),
      fmt(p75(rs.map((r) => r.longestAfterLoad))),
      fmt(p75(rs.map((r) => r.inp))),
      fmt(p75(rs.map((r) => r.jsBeforeLoadKB))),
      fmt(p75(rs.map((r) => r.prefetchKB))),
      fmt(p75(rs.map((r) => r.imageKB))),
    ]);
  }
  return rows.map((r) => `| ${r.join(" | ")} |`).join("\n").replace(/^(\|[^\n]*\n)/, (m) => m + `|${" --- |".repeat(rows[0].length)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
