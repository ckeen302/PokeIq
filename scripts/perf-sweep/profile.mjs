/**
 * Where a page's long tasks go: records a CPU profile of a page load (and the seconds after it) and prints the
 * functions with the most self time, and the heaviest stacks, by source file.
 *
 *   node scripts/perf-sweep/profile.mjs <path> [baseUrl] [--profile=desktop|phone] [--seconds=8]
 */
import { chromium } from "playwright";
import { PROFILES } from "./measure.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const [route, base = "http://localhost:3000"] = argv.filter((a) => !a.startsWith("--"));
const prof = PROFILES[flag("profile", "desktop")];
const seconds = Number(flag("seconds", "8"));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: prof.viewport, deviceScaleFactor: prof.deviceScaleFactor, isMobile: prof.isMobile, hasTouch: prof.hasTouch, ...(prof.userAgent && { userAgent: prof.userAgent }) });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
if (prof.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
await cdp.send("Profiler.start");
await page.goto(base + route, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(seconds * 1000);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (dt[i + 1] ?? 0)));
const label = (n) => {
  const f = n.callFrame;
  const file = (f.url || "").split("/").pop().split("?")[0] || "(native)";
  return `${f.functionName || "(anon)"} ${file}:${f.lineNumber + 1}`;
};
const fn = new Map();
const files = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  const l = label(n);
  fn.set(l, (fn.get(l) ?? 0) + us);
  const file = (n.callFrame.url || "(native)").split("/").pop().split("?")[0] || n.callFrame.functionName;
  files.set(file, (files.get(file) ?? 0) + us);
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${l}`).join("\n");
console.log(`== self time by file (${route})\n${top(files, 15)}\n\n== self time by function\n${top(fn, 30)}`);
// Inclusive time per function (each sample counted once per distinct frame on its stack).
const incl = new Map();
profile.samples.forEach((id, i) => {
  const seen = new Set();
  for (let n = id; n != null; n = parent.get(n)) {
    const l = label(byId.get(n));
    if (seen.has(l)) continue;
    seen.add(l);
    incl.set(l, (incl.get(l) ?? 0) + (dt[i + 1] ?? 0));
  }
});
console.log(`\n== inclusive time\n${top(new Map([...incl].filter(([l]) => !/^\((root|program|idle|garbage collector)\)/.test(l))), 40)}`);
