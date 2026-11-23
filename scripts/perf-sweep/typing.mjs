/**
 * Interaction latency of typing into one search box once the page has settled (Event Timing, the INP way).
 *   node scripts/perf-sweep/typing.mjs <url> <selector> [text=char] [--phone] [--wait=8000]
 */
import { chromium } from "playwright";
import { PROFILES } from "./measure.mjs";

const args = process.argv.slice(2);
const [url, selector, text = "char"] = args.filter((a) => !a.startsWith("--"));
const prof = PROFILES[args.includes("--phone") ? "phone" : "desktop"];
const wait = Number(args.find((a) => a.startsWith("--wait="))?.slice(7) ?? 8000);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: prof.viewport, isMobile: prof.isMobile, hasTouch: prof.hasTouch, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  window.__ev = [];
  window.__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => e.interactionId && window.__ev.push({ name: e.name, d: e.duration, id: e.interactionId, t: e.startTime, wait: e.processingStart - e.startTime, run: e.processingEnd - e.processingStart }))).observe({ type: "event", durationThreshold: 16, buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
});
const page = await ctx.newPage();
if (prof.cpu > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(wait);
// A game's first-visit how-to covers the board: "Don't show again", as the e2e does.
const never = page.getByTestId("howto-never");
if (await never.isVisible().catch(() => false)) {
  await never.click();
  await page.waitForTimeout(800);
}
const t0 = await page.evaluate(() => performance.now());
await page.locator(selector).first().click();
await page.keyboard.type(text, { delay: 250 });
await page.waitForTimeout(1500);
const { ev, lt } = await page.evaluate((t) => ({ ev: window.__ev.filter((e) => e.t >= t), lt: window.__lt.filter(([s]) => s >= t) }), t0);
const by = new Map();
for (const e of ev) by.set(e.id, [...(by.get(e.id) ?? []), e]);
for (const [id, es] of by) console.log(id, es.map((e) => `${e.name} ${Math.round(e.d)}ms (wait ${Math.round(e.wait)}, run ${Math.round(e.run)})`).join(", "));
console.log("long tasks while typing:", JSON.stringify(lt));
await browser.close();
