/**
 * Every layout shift on one page load, with what moved (for tracking down a CLS source).
 *   node scripts/perf-sweep/shifts.mjs <url> [width=390] [height=844]
 * Phone-sized widths get touch, a mobile viewport and a 4× CPU slowdown.
 */
import { chromium } from "playwright";

const [url, w = "390", h = "844"] = process.argv.slice(2);
const mobile = Number(w) < 800;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) =>
      window.__shifts.push({
        t: Math.round(e.startTime),
        value: +e.value.toFixed(4),
        hadRecentInput: e.hadRecentInput,
        sources: e.sources.map((s) => `${s.node?.nodeName}.${String(s.node?.className || "").slice(0, 50)} y,h ${JSON.stringify([Math.round(s.previousRect.y), Math.round(s.previousRect.height)])} → ${JSON.stringify([Math.round(s.currentRect.y), Math.round(s.currentRect.height)])}`),
      })
    )
  ).observe({ type: "layout-shift", buffered: true });
});
const page = await ctx.newPage();
if (mobile) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => window.__shifts), null, 1));
await browser.close();
