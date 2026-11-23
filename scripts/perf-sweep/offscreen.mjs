/**
 * Frame rate and long tasks with a page's canvas scrolled out of view (does it stop drawing what nobody sees?).
 *   node scripts/perf-sweep/offscreen.mjs <url> [--phone] [--wait=10000]
 */
import { chromium } from "playwright";
import { PROFILES } from "./measure.mjs";

const args = process.argv.slice(2);
const [url] = args.filter((a) => !a.startsWith("--"));
const prof = PROFILES[args.includes("--phone") ? "phone" : "desktop"];
const wait = Number(args.find((a) => a.startsWith("--wait="))?.slice(7) ?? 10000);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: prof.viewport, isMobile: prof.isMobile, hasTouch: prof.hasTouch, deviceScaleFactor: 1 });
const page = await ctx.newPage();
if (prof.cpu > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(wait);
const sample = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const lt = [];
        const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(e.duration)));
        po.observe({ type: "longtask" });
        let n = 0;
        const t0 = performance.now();
        const tick = (t) => (t - t0 < 4000 ? (n++, requestAnimationFrame(tick)) : (po.disconnect(), res({ fps: +(n / 4).toFixed(1), longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)) })));
        requestAnimationFrame(tick);
      })
  );
console.log("in view    ", JSON.stringify(await sample()));
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(1500);
console.log("scrolled by", JSON.stringify(await sample()));
await browser.close();
