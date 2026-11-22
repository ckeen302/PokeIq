/**
 * The Poké Ball Maker, end to end in the browser: its card on /tools, then the maker itself: pick a preset, recolour
 * a part, lay a pattern, change a finish, open the ball, a share link that rebuilds the exact design (with its own
 * preview card), a PNG download with a transparent background, and no sideways scroll at 1440, 1024, 390 and 360.
 * Without WebGL 2 (some CI browsers) the 3D-only checks are skipped and the flat fallback is checked instead. Each
 * part records a failure instead of stopping the rest. Screenshots are best effort.
 *
 *   node scripts/e2e-pokeball-maker.mjs [baseUrl]     (or from e2e-smoke.mjs; E2E_ONLY=pokeball-maker runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

async function shot(page, path) {
  await page.screenshot({ path }).catch((e) => console.log(`  (screenshot skipped: ${e.message.split("\n")[0]})`));
}

async function newContext(browser, BASE, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  return context;
}

function watch(page, consoleErrors) {
  page.on("console", (m) => {
    // Remote Pokémon pictures (HOME renders) can fail offline; that's not the maker's fault.
    if (m.type() === "error" && !/Failed to load resource|raw\.githubusercontent/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

/** Waits for the maker, and says whether it's drawing in 3D. */
async function ready(page) {
  await page.getByTestId("pokeball-maker").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="pokeball-maker"]')?.getAttribute("data-gl") !== "pending", null, { timeout: 30_000 });
  return (await page.getByTestId("pokeball-maker").getAttribute("data-gl")) === "ok";
}

const designOf = (page) => page.evaluate(() => window.__pokeballMaker?.design() ?? null);
const linkOf = (page) => page.evaluate(() => new URL(location.href).searchParams.get("d"));

/** Clicks a dock tab (opening its panel) unless that panel is already open. */
async function tab(page, name) {
  const t = page.getByTestId(`pbm-tab-${name}`);
  if ((await t.getAttribute("aria-selected")) !== "true") await t.click();
  await page.getByTestId(`pbm-drawer-${name}`).waitFor({ timeout: 15_000 });
}

/** Waits until the design (as its link) differs from `before`. */
async function changed(page, before, what, fail) {
  try {
    await page.waitForFunction((b) => window.__pokeballMaker?.design() !== b, before, { timeout: 10_000 });
  } catch {
    fail(`${what} didn't change the design`);
  }
  return designOf(page);
}

export async function runPokeballMaker({ browser, BASE, OUT = "e2e-screenshots", errors, step }) {
  step("Poké Ball Maker");
  const consoleErrors = [];
  const fail = (msg) => errors.push(`pokeball maker: ${msg}`);
  const context = await newContext(browser, BASE);
  const page = await context.newPage();
  watch(page, consoleErrors);
  let gl = false;

  // ---- The card on /tools, and the page.
  try {
    await page.goto(`${BASE}/tools`, { waitUntil: "load" });
    const card = page.getByTestId("tool-card-pokeball-maker");
    await card.waitFor({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/tools\/pokeball-maker/, { timeout: 20_000 });
    gl = await ready(page);
    if (!/Poké Ball Maker/.test(await page.title())) fail(`the title is "${await page.title()}"`);
    if ((await page.locator("h1").first().innerText()).trim() !== "Poké Ball Maker") fail("the H1 is wrong");
    const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    if (!ld.some((s) => s.includes('"WebApplication"') && s.includes("Poké Ball Maker"))) fail("no WebApplication JSON-LD");
    if (!(await page.locator("#pbm-how").count())) fail("no how-it-works section");
    console.log(`  drawing in ${gl ? `3D (tier ${await page.evaluate(() => window.__pokeballMaker?.tier())})` : "2D: no WebGL 2"}`);
    if (!gl && !(await page.getByTestId("pbm-flat").count())) fail("no WebGL 2, and no flat fallback either");
    await shot(page, `${OUT}/pokeball-maker.png`);
  } catch (e) {
    fail(`page: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- Preset, colour, pattern, finish.
  try {
    step("pokeball maker: preset, colour, pattern, finish");
    let d = await designOf(page);
    await tab(page, "start");
    await page.getByTestId("pbm-preset-great").click();
    d = await changed(page, d, "the Great Ball preset", fail);
    await tab(page, "colours");
    await page.getByTestId("pbm-parts").locator('[data-value="bottom"]').click();
    await page.getByTestId("pbm-drawer-colours").getByTestId("pbm-swatch").nth(3).click();
    d = await changed(page, d, "a swatch on the bottom half", fail);
    await page.getByTestId("pbm-hex").fill("#12ab34");
    await page.getByTestId("pbm-hex").press("Enter");
    d = await changed(page, d, "a hex colour", fail);
    await tab(page, "patterns");
    await page.getByTestId("pbm-pattern-stripes").click();
    d = await changed(page, d, "the Stripes pattern", fail);
    await page.getByTestId("pbm-pattern-scale").fill("200");
    d = await changed(page, d, "the pattern's size", fail);
    await tab(page, "finish");
    await page.getByTestId("pbm-finish-metal").click();
    d = await changed(page, d, "the brushed metal finish", fail);
    await shot(page, `${OUT}/pokeball-maker-finish.png`);
    await page.getByTestId("pbm-drawer-close").click();
    // Undo and redo.
    await page.keyboard.press("Control+z");
    const undone = await changed(page, d, "undo", fail);
    await page.keyboard.press("Control+Shift+z");
    if ((await changed(page, undone, "redo", fail)) !== d) fail("redo didn't bring the design back");
  } catch (e) {
    fail(`editing: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- Open, and catch.
  try {
    step("pokeball maker: open and catch");
    await page.getByTestId("pbm-open").click();
    await page.waitForTimeout(1200);
    await shot(page, `${OUT}/pokeball-maker-open.png`);
    await page.waitForTimeout(3800);
    await page.getByTestId("pbm-catch").click();
    await page.waitForTimeout(1500);
    if (gl) {
      // A pinned moment of the opening draws (the debug hook the stage exposes).
      await page.evaluate(() => window.__pokeballMaker.pin("open", 1.3));
      await page.waitForTimeout(600);
      await shot(page, `${OUT}/pokeball-maker-opened.png`);
      await page.evaluate(() => window.__pokeballMaker.unpin());
    }
  } catch (e) {
    fail(`open: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- The share link rebuilds the design, with its own preview card.
  try {
    step("pokeball maker: share link and preview card");
    // The address follows the design a moment after each change.
    await page.waitForFunction(() => new URL(location.href).searchParams.get("d") === window.__pokeballMaker?.design(), null, { timeout: 8_000 }).catch(() => undefined);
    const link = await linkOf(page);
    const want = await designOf(page);
    if (!link || link !== want) fail(`the address doesn't carry the design (${link?.slice(0, 20)} vs ${want?.slice(0, 20)})`);
    await page.getByTestId("pbm-share").click();
    await page.getByTestId("pbm-copy").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copied && !copied.includes(`d=${want}`)) fail(`the copied link isn't the design: ${copied}`);
    const p2 = await context.newPage();
    watch(p2, consoleErrors);
    await p2.goto(`${BASE}/tools/pokeball-maker?d=${want}`, { waitUntil: "load" });
    await ready(p2);
    const got = await designOf(p2);
    if (got !== want) fail("opening the share link gave a different design");
    const og = await p2.evaluate(() => document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
    if (!og || !og.includes("/tools/pokeball-maker/og?d=")) fail(`the share link's preview card is ${og}`);
    else {
      const r = await p2.request.get(new URL(og, BASE).toString().replace(new URL(og, BASE).origin, BASE));
      if (r.status() !== 200 || !(r.headers()["content-type"] ?? "").startsWith("image/png")) fail(`the preview card answered ${r.status()} ${r.headers()["content-type"]}`);
    }
    // A broken link opens a fresh ball and says so.
    await p2.goto(`${BASE}/tools/pokeball-maker?d=AQ_broken`, { waitUntil: "load" });
    await ready(p2);
    if (!(await p2.getByTestId("pbm-toast").count())) fail("a broken link didn't say so");
    await p2.close();
  } catch (e) {
    fail(`share link: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- PNG download (transparent).
  if (gl) {
    try {
      step("pokeball maker: PNG download");
      if (!(await page.getByTestId("pbm-export").count())) await page.getByTestId("pbm-share").click();
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByTestId("pbm-png-1").click()]);
      const file = await dl.path();
      const bytes = fs.readFileSync(file);
      if (dl.suggestedFilename().slice(-4) !== ".png" || bytes.subarray(1, 4).toString() !== "PNG") fail(`the PNG download is ${dl.suggestedFilename()}`);
      // Colour type 6: RGBA (a transparent background).
      if (bytes[25] !== 6) fail(`the PNG has colour type ${bytes[25]}, not RGBA`);
      if (bytes.readUInt32BE(16) !== 800) fail(`the 1× PNG is ${bytes.readUInt32BE(16)} px wide`);
      const [stl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId("pbm-export-stl").click()]);
      const s = fs.readFileSync(await stl.path());
      if (s.length !== 84 + 50 * s.readUInt32LE(80)) fail("the STL's size doesn't match its triangle count");
    } catch (e) {
      fail(`downloads: stopped: ${e.message.split("\n")[0]}`);
    }
  }
  await context.close();

  // ---- No sideways scroll, desktop and phone.
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [360, 740]]) {
    try {
      step(`pokeball maker: ${w} px`);
      const ctx = await newContext(browser, BASE, { width: w, height: h });
      const p = await ctx.newPage();
      watch(p, consoleErrors);
      await p.goto(`${BASE}/tools/pokeball-maker`, { waitUntil: "load" });
      await ready(p);
      await tab(p, "patterns");
      await p.waitForTimeout(500);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) fail(`${w} px scrolls sideways by ${over} px`);
      if (w <= 390) {
        // The stage stays in view while a panel is open on a phone.
        await p.evaluate(() => window.scrollTo(0, 600));
        await p.waitForTimeout(300);
        const top = await p.getByTestId("pbm-stage").evaluate((el) => el.getBoundingClientRect().top);
        if (top < 0 || top > 120) fail(`at ${w} px the stage is at ${top} px while editing`);
      }
      await shot(p, `${OUT}/pokeball-maker-${w}.png`);
      await ctx.close();
    } catch (e) {
      fail(`${w} px: stopped: ${e.message.split("\n")[0]}`);
    }
  }
  for (const e of consoleErrors) fail(`console: ${e.slice(0, 200)}`);
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runPokeballMaker({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ pokeball maker passed");
}
