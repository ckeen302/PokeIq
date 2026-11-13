/**
 * Hydration check: the pages that showed React's hydration error (#418) on
 * the live site, opened in two timezones on either side of the date line
 * (and two locales), on a phone and a desktop, four at once, with each
 * script arriving after its own random delay (seeded), so the browser starts
 * hydrating while some of the page's code is still on its way, as it does on
 * a slow network or a busy server. Any hydration error (React #418, #423,
 * #425, or a "Hydration failed" / "didn't match" message) fails the check.
 *
 *   node scripts/e2e-hydration.mjs http://localhost:3000 [--rounds 3] [--seed 418]
 *
 * Read-only: it only loads pages (nothing is sent but GET requests).
 */
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readOnly } from "./read-only-browser.mjs";

export const HYDRATION_ROUTES = ["/leaderboard", "/pokedex", "/pokemon/pikachu", "/lab/games"];
/** UTC+14 and UTC-10: for most of the day they're on different dates (and both differ from the server's UTC date). */
const ZONES = [
  { timezoneId: "Pacific/Kiritimati", locale: "en-US" },
  { timezoneId: "Pacific/Honolulu", locale: "de-DE" },
];
const PROFILES = [
  { viewport: { width: 1440, height: 900 } },
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|didn't match|hydration mismatch/i;

/** A small seeded generator (mulberry32), so a failing run can be played again. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bootstrap scripts come at once; every other script after up to this long. */
const BOOTSTRAP = /\/(webpack|framework|main-app|main|polyfills)-[0-9a-f]+\.js$/;
const MAX_DELAY_MS = 1200;

async function load(browser, BASE, path, zone, profile, random) {
  const context = await browser.newContext({ ...profile, ...zone });
  await readOnly(context, new Set(), new Map());
  await context.route("**/_next/static/chunks/**", async (route) => {
    if (!BOOTSTRAP.test(new URL(route.request().url()).pathname)) await new Promise((r) => setTimeout(r, random() * MAX_DELAY_MS));
    return route.fallback();
  });
  const page = await context.newPage();
  const found = [];
  page.on("pageerror", (e) => HYDRATION.test(e.message) && found.push(e.message.split("\n")[0].slice(0, 160)));
  page.on("console", (m) => m.type() === "error" && HYDRATION.test(m.text()) && found.push(m.text().split("\n")[0].slice(0, 160)));
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2000);
  } finally {
    await context.close();
  }
  return found;
}

export async function runHydration({ browser, BASE, errors, step, rounds = 1, seed = 418 }) {
  step(`hydration: ${HYDRATION_ROUTES.join(", ")} in two timezones, phone and desktop, scripts arriving late (seed ${seed})`);
  const random = seeded(seed);
  const jobs = [];
  for (let r = 0; r < rounds; r++) for (const path of HYDRATION_ROUTES) for (const zone of ZONES) for (const profile of PROFILES) jobs.push({ path, zone, profile });
  let loads = 0;
  // Four at a time: the pages hydrate while others are still loading.
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const found = await load(browser, BASE, job.path, job.zone, job.profile, random);
        loads++;
        for (const e of found) errors.push(`hydration error on ${job.path} (${job.zone.timezoneId}, ${job.profile.viewport.width}px): ${e}`);
      }
    })
  );
  return loads;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const BASE = (args.find((a, k) => !a.startsWith("--") && !args[k - 1]?.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
  const i = args.indexOf("--rounds");
  const rounds = i >= 0 ? Number(args[i + 1]) : 3;
  const j = args.indexOf("--seed");
  const seed = j >= 0 ? Number(args[j + 1]) : 418;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const loads = await runHydration({ browser, BASE, errors, step: (s) => console.log(`\n== ${s}`), rounds, seed });
  await browser.close();
  for (const e of errors) console.error(e);
  console.log(errors.length ? `${errors.length} hydration error(s) in ${loads} page loads` : `no hydration errors in ${loads} page loads`);
  process.exit(errors.length ? 1 : 0);
}
