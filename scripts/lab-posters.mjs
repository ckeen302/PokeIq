/**
 * The phone posters for the 3D stages (public/lab/posters/*.webp): a still of
 * each stage's opening view, shown by StagePoster until the scene's first
 * frame is drawn.
 *
 *   npm run build && npm start -- -p 3000
 *   node scripts/lab-posters.mjs [baseUrl]
 *
 * Each page is opened at 390 × 844 with the runners' and armies' pictures
 * held back, so the still is the venue alone (what the scene draws first);
 * everything over the canvas is hidden for the shot.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";

const BASE = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = new URL("../public/lab/posters/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const STAGES = [
  { name: "games", path: "/lab/games", stage: '[data-testid="stadium"]', host: ".rc-host", ready: '[data-testid="stadium"][data-ready="1"]' },
  { name: "race", path: "/pokedex/race", stage: '[data-testid="race-stage"]', host: ".rc-host", ready: '[data-testid="race-stage"][data-ready="1"]' },
  { name: "mass-battle", path: "/lab/mass-battle", stage: '[data-testid="mb-stage"]', host: ".mb-host", ready: '[data-testid="mb-stage"] canvas' },
  // The Professor's Lab: the room and its pods' holograms (which Pokémon stand in it depends on the link).
  { name: "pokedex", path: "/lab/pokedex", stage: '[data-testid="lab-wheel"]', host: ":first-child", ready: '[data-testid="lab-stage"][data-ready="1"]', hide: '[data-testid="lab-stage"] > :not([data-testid="lab-wheel"])' },
  // These draw the page's own first view, figures and all.
  { name: "pokemon-story", path: "/lab/pokemon-story", stage: '[data-testid="ps-stage"]', host: '[data-testid="ps-scene"]', ready: '[data-testid="ps-stage"][data-ready="1"]', figures: true, settle: 20000 },
  { name: "world-history", path: "/lab/world-history", stage: '[data-testid="wh-stage"]', host: '[data-testid="wh-scene"]', ready: '[data-testid="wh-stage"][data-ready="1"]', figures: true, settle: 6000 },
  { name: "timeline", path: "/pokedex/timeline", stage: '[data-testid="timeline-stage"]', host: ".tl-bg, .tl-host", ready: '[data-testid="timeline-stage"][data-ready="1"]', figures: true, settle: 6000 },
  { name: "sizes", path: "/pokedex/sizes", stage: '[data-testid="sizes-stage"]', host: ".sz-host", ready: '[data-testid="sizes-stage"][data-shown="1"]', figures: true, settle: 4000, timeout: 600_000 },
  { name: "globe", path: "/pokeguessr/globe", stage: '[data-testid="world-globe"]', host: "canvas", ready: '[data-testid="world-globe"][data-state="ready"]', settle: 4000 },
];
/** `node scripts/lab-posters.mjs [baseUrl] --only=sizes,globe` makes just those. */
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
/** Figures (runners, armies): held back so the still shows the venue alone. */
const FIGURES = /\/(race\/(art|depth)|sizes\/(art|depth)|art\/\d+|api\/race\/home|api\/sizes)\//;

const browser = await chromium.launch({ ...(process.env.CHROME_PATH && { executablePath: process.env.CHROME_PATH }), args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const s of STAGES.filter((x) => !ONLY || ONLY.includes(x.name))) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
    // The globe's fly-in plays once per visitor: the still is the world at rest.
    localStorage.setItem("pokeiq-globe-intro", "1");
  });
  if (!s.figures) await context.route("**/*", (r) => (FIGURES.test(new URL(r.request().url()).pathname) ? r.abort() : r.continue()));
  const page = await context.newPage();
  await page.goto(BASE + s.path, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(s.ready).first().waitFor({ timeout: s.timeout ?? 120_000 });
  await page.waitForTimeout(s.settle ?? 2500);
  await page.addStyleTag({ content: `${s.stage} > :not(${s.host}) { visibility: hidden !important; }${s.hide ? ` ${s.hide} { visibility: hidden !important; }` : ""}` });
  await page.waitForTimeout(300);
  const png = await page.locator(s.stage).screenshot();
  const file = `${OUT}${s.name}.webp`;
  await sharp(png).webp({ quality: 60, effort: 6 }).toFile(file);
  console.log(s.name, (await sharp(file).metadata()).width, "x", (await sharp(file).metadata()).height, Math.round(fs.statSync(file).size / 1024), "KB");
  await context.close();
}
await browser.close();
