/**
 * The Favorite Pokémon Picker, end to end in the browser: its card on /tools, the page (title, H1, how-to and
 * structured data in the server's HTML), a run from the pool to the end (narrowing screens, undo, a reload part-way
 * that carries on where it was, the head-to-head bracket by mouse and by keyboard), the result (favorite, top 10,
 * shiny, reordering, the Shiny Pokémon Maker link), the type chart (filled by search and by a run on one type, shiny
 * on a slot), PNG downloads (square and tall), a share link that opens the result with its own title and preview
 * card, and the phone layout (no sideways scroll). Each part records a failure instead of stopping the rest.
 * Screenshots are best effort.
 *
 *   node scripts/e2e-favorite-picker.mjs [baseUrl]     (or from e2e-smoke.mjs; E2E_ONLY=favorite-picker runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const PATH = "/tools/favorite-pokemon-picker";

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
    // Remote Pokémon pictures (HOME renders, sprites) can fail offline; that's not the picker's fault.
    if (m.type() === "error" && !/Failed to load resource|raw\.githubusercontent/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

const ready = (page) => page.getByTestId("favorite-picker-app").waitFor({ timeout: 60_000 });
const phase = (page) => page.getByTestId("fp-run").getAttribute("data-phase").catch(() => null);

/** Keeps the first `keep` tiles of the screen and goes on. */
async function keepAndNext(page, keep) {
  const tiles = page.getByTestId("fp-tile");
  const n = await tiles.count();
  for (let i = 0; i < Math.min(keep, n); i++) await tiles.nth(i).click();
  await page.getByTestId("fp-next").click();
}

/** Plays the run on screen to its end: keeps `keep` per screen, then picks the left card (or the right with `keys`). */
async function playToEnd(page, { keep = 2, keys = false, onScreen } = {}) {
  for (let guard = 0; guard < 400; guard++) {
    const ph = await phase(page);
    if (!ph) return;
    if (ph === "cull") {
      const before = await page.getByTestId("fp-cull").getAttribute("data-screen").catch(() => null);
      const round = await page.getByTestId("fp-cull").getAttribute("data-round").catch(() => null);
      if (onScreen) await onScreen();
      if ((await phase(page)) !== "cull") continue;
      await keepAndNext(page, keep);
      await page.waitForFunction(
        ([b, r]) => {
          const el = document.querySelector('[data-testid="fp-cull"]');
          return !el || el.getAttribute("data-screen") !== b || el.getAttribute("data-round") !== r;
        },
        [before, round],
        { timeout: 10_000 }
      );
    } else if (ph === "duel") {
      const a = await page.getByTestId("fp-duel-a").getAttribute("aria-label");
      if (keys) await page.keyboard.press(guard % 2 ? "ArrowRight" : "ArrowLeft");
      else await page.getByTestId("fp-duel-a").click();
      await page.waitForFunction((x) => document.querySelector('[data-testid="fp-duel-a"]')?.getAttribute("aria-label") !== x, a, { timeout: 10_000 }).catch(() => undefined);
    } else return;
  }
  throw new Error("the run never ended");
}

async function pngSize(download) {
  const bytes = fs.readFileSync(await download.path());
  if (bytes.subarray(1, 4).toString() !== "PNG") throw new Error(`${download.suggestedFilename()} isn't a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

export async function runFavoritePicker({ browser, BASE, OUT = "e2e-screenshots", errors, step }) {
  step("Favorite Pokémon Picker");
  const consoleErrors = [];
  const fail = (msg) => errors.push(`favorite picker: ${msg}`);
  const context = await newContext(browser, BASE);
  const page = await context.newPage();
  watch(page, consoleErrors);

  // ---- The card on /tools, the page and its server HTML.
  try {
    await page.goto(`${BASE}/tools`, { waitUntil: "load" });
    const card = page.getByTestId("tool-card-favorite-picker");
    await card.waitFor({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(new RegExp(PATH), { timeout: 20_000 });
    await ready(page);
    if (!/Favorite Pokémon Picker/.test(await page.title())) fail(`the title is "${await page.title()}"`);
    if ((await page.locator("h1").first().innerText()).trim() !== "Favorite Pokémon Picker") fail("the H1 is wrong");
    const html = await (await page.request.get(`${BASE}${PATH}`)).text();
    for (const want of ["<h1", "Favorite Pokémon Picker", "favorite Pokémon of every type", 'id="fp-how"', '"WebApplication"']) if (!html.includes(want)) fail(`the server HTML lacks ${want}`);
    if (!/<link rel="canonical" href="[^"]*\/tools\/favorite-pokemon-picker"/.test(html)) fail("no canonical link");
    await shot(page, `${OUT}/favorite-picker.png`);
  } catch (e) {
    fail(`page: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- A run: Gen 1, narrowing, undo, a reload part-way, the bracket, the end.
  try {
    step("favorite picker: a run");
    await page.getByTestId("fp-gen-1").click();
    const count = Number(await page.getByTestId("fp-count").getAttribute("data-count"));
    if (!(count > 100)) fail(`Gen 1 has ${count} in the pool`);
    await page.getByTestId("fp-start").click();
    await page.getByTestId("fp-cull").waitFor({ timeout: 10_000 });
    await shot(page, `${OUT}/favorite-picker-round.png`);
    // Undo: back to the first screen, with its keeps.
    const first = await page.getByTestId("fp-tile").first().getAttribute("aria-label");
    await keepAndNext(page, 3);
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-cull"]')?.getAttribute("data-screen") === "1", null, { timeout: 5_000 });
    await page.getByTestId("fp-undo").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-cull"]')?.getAttribute("data-screen") === "0", null, { timeout: 5_000 });
    if ((await page.getByTestId("fp-tile").first().getAttribute("aria-label")) !== first) fail("undo didn't bring the same screen back");
    if ((await page.locator('[data-testid="fp-tile"][aria-pressed="true"]').count()) !== 3) fail("undo didn't bring the screen's keeps back");
    await page.getByTestId("fp-next").click();
    await keepAndNext(page, 4);
    // A reload carries on where it was.
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-cull"]')?.getAttribute("data-screen") === "2", null, { timeout: 5_000 });
    await page.reload({ waitUntil: "load" });
    await ready(page);
    await page.getByTestId("fp-cull").waitFor({ timeout: 10_000 });
    if ((await page.getByTestId("fp-cull").getAttribute("data-screen")) !== "2") fail("a reload lost the run's place");
    // Keyboard on a screen: arrows move, Space keeps, N goes on.
    await page.getByTestId("fp-tile").first().focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    if ((await page.locator('[data-testid="fp-tile"][aria-pressed="true"]').count()) !== 2) fail("Space didn't keep the focused tiles");
    await page.keyboard.press("n");
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-cull"]')?.getAttribute("data-screen") !== "2", null, { timeout: 5_000 });
    let shotDuel = false;
    await playToEnd(page, {
      keep: 4,
      onScreen: async () => {
        if (!shotDuel && (await phase(page)) === "duel") {
          shotDuel = true;
          await shot(page, `${OUT}/favorite-picker-duel.png`);
        }
      },
    });
    // The rest of the bracket, partly by keyboard.
    if ((await phase(page)) === "duel") await shot(page, `${OUT}/favorite-picker-duel.png`);
    await playToEnd(page, { keys: true });
    await page.getByTestId("fp-result").waitFor({ timeout: 10_000 });
    const fav = (await page.getByTestId("fp-favorite").innerText()).trim();
    const rows = await page.getByTestId("fp-top-row").count();
    if (!fav) fail("no favorite on the end screen");
    if (rows !== 10) fail(`the top list has ${rows} rows`);
    console.log(`  favorite: ${fav}`);
    await shot(page, `${OUT}/favorite-picker-result.png`);
    // Undo from the end screen goes back to the final, and picking again ends again.
    await page.getByTestId("fp-result-undo").click();
    await page.getByTestId("fp-duel").waitFor({ timeout: 5_000 });
    await playToEnd(page);
    await page.getByTestId("fp-result").waitFor({ timeout: 10_000 });
  } catch (e) {
    fail(`run: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- The result: shiny, reorder, the Shiny Pokémon Maker link.
  let favName = "";
  try {
    step("favorite picker: result");
    favName = (await page.getByTestId("fp-favorite").innerText()).trim();
    await page.getByTestId("fp-fav-shiny").click();
    if ((await page.getByTestId("fp-fav-shiny").getAttribute("aria-pressed")) !== "true") fail("the favorite's shiny switch didn't turn on");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="fp-result"] img')].some((i) => /shiny/.test(i.getAttribute("src") ?? "")), null, { timeout: 5_000 }).catch(() => fail("the favorite didn't switch to its shiny picture"));
    const nameAt = async (i) => (await page.getByTestId("fp-top-row").nth(i).innerText()).replace(/^\s*\d+\s*/, "").trim();
    const second = await nameAt(1);
    await page.getByTestId("fp-top-down").nth(1).click();
    if ((await nameAt(2)) !== second) fail("moving down didn't reorder the list");
    await page.getByTestId("fp-top-shiny").nth(3).click();
    const href = await page.getByTestId("fp-fav-shiny-maker").getAttribute("href", { timeout: 10_000 });
    if (!href || !/^\/tools\/shiny-maker\?d=[A-Za-z0-9_-]+$/.test(href)) fail(`the Shiny Maker link is ${href}`);
    else {
      const p2 = await context.newPage();
      watch(p2, consoleErrors);
      await p2.goto(`${BASE}${href}`, { waitUntil: "load" });
      await p2.getByTestId("shiny-maker").waitFor({ timeout: 60_000 }).catch(() => undefined);
      await p2.waitForTimeout(1500);
      if (await p2.getByText("That design link didn't open").count()) fail("the Shiny Maker didn't open the favorite");
      await p2.close();
    }
  } catch (e) {
    fail(`result: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- The result's PNG, square and tall.
  try {
    step("favorite picker: result PNG");
    await page.getByTestId("fp-export").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-export-preview"]')?.getAttribute("data-ready") === "1", null, { timeout: 30_000 });
    let [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("fp-export-png").click()]);
    let size = await pngSize(dl);
    if (size.join("x") !== "1080x1080") fail(`the square PNG is ${size.join("x")}`);
    fs.copyFileSync(await dl.path(), `${OUT}/favorite-picker-export-square.png`);
    await page.getByTestId("fp-export-size-tall").click();
    await page.waitForTimeout(300);
    [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("fp-export-png").click()]);
    size = await pngSize(dl);
    if (size.join("x") !== "1080x1920") fail(`the tall PNG is ${size.join("x")}`);
    fs.copyFileSync(await dl.path(), `${OUT}/favorite-picker-export-tall.png`);
    await page.keyboard.press("Escape");
  } catch (e) {
    fail(`result PNG: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- The type chart: the favorite added, a slot by search, a slot by a run, shiny on a slot.
  try {
    step("favorite picker: type chart");
    await page.getByTestId("fp-to-chart").click();
    await page.getByTestId("fp-tab-chart").click();
    await page.getByTestId("fp-chart").waitFor({ timeout: 5_000 });
    const filled0 = await page.locator('[data-testid^="fp-slot-"][data-filled]:not([data-filled=""])').count();
    if (filled0 < 1) fail("Add to the type chart didn't fill a slot");
    // By search.
    await page.getByTestId("fp-slot-open-water").click();
    await page.getByTestId("fp-slot-search").fill("Gyarados");
    await page.getByTestId("fp-slot-result").first().click();
    if ((await page.getByTestId("fp-slot-water").getAttribute("data-filled")) !== "gyarados") fail(`search filled the Water slot with ${await page.getByTestId("fp-slot-water").getAttribute("data-filled")}`);
    await page.getByTestId("fp-slot-open-electric").click();
    await page.getByTestId("fp-slot-search").fill("25");
    await page.getByTestId("fp-slot-result").first().click();
    if ((await page.getByTestId("fp-slot-electric").getAttribute("data-filled")) !== "pikachu") fail("searching by number didn't find Pikachu");
    // Shiny on a slot.
    await page.getByTestId("fp-slot-shiny-water").click();
    await page.waitForFunction(() => /shiny/.test(document.querySelector('[data-testid="fp-slot-water"] img')?.getAttribute("src") ?? ""), null, { timeout: 5_000 }).catch(() => fail("the Water slot didn't go shiny"));
    if (!/^\/tools\/shiny-maker\?d=/.test((await page.getByTestId("fp-slot-maker-water").getAttribute("href")) ?? "")) fail("the Water slot has no Shiny Maker link");
    // By a run on one type.
    await page.getByTestId("fp-slot-open-dragon").click();
    await page.getByTestId("fp-slot-run").click();
    await page.getByTestId("fp-run").waitFor({ timeout: 5_000 });
    await shot(page, `${OUT}/favorite-picker-type-run.png`);
    await playToEnd(page, { keep: 1 });
    await page.getByTestId("fp-chart").waitFor({ timeout: 10_000 });
    if (!(await page.getByTestId("fp-slot-dragon").getAttribute("data-filled"))) fail("the Dragon run didn't fill its slot");
    await shot(page, `${OUT}/favorite-picker-chart.png`);
    // The chart's PNG.
    await page.getByTestId("fp-chart-export").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fp-export-preview"]')?.getAttribute("data-ready") === "1", null, { timeout: 30_000 });
    let [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("fp-export-png").click()]);
    if ((await pngSize(dl)).join("x") !== "1080x1080") fail("the chart's square PNG has the wrong size");
    fs.copyFileSync(await dl.path(), `${OUT}/favorite-picker-chart-square.png`);
    await page.getByTestId("fp-export-size-tall").click();
    await page.waitForTimeout(300);
    [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("fp-export-png").click()]);
    if ((await pngSize(dl)).join("x") !== "1080x1920") fail("the chart's tall PNG has the wrong size");
    fs.copyFileSync(await dl.path(), `${OUT}/favorite-picker-chart-tall.png`);
    await page.keyboard.press("Escape");
  } catch (e) {
    fail(`type chart: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- A share link opens the result, with its own title and preview card.
  try {
    step("favorite picker: share link");
    await page.getByTestId("fp-tab-picker").click();
    await page.getByTestId("fp-share").click();
    const url = await page.getByTestId("fp-share-url").inputValue();
    if (!new RegExp(`${PATH}\\?d=[A-Za-z0-9_-]+$`).test(url)) fail(`the share link is ${url}`);
    await page.keyboard.press("Escape");
    const p2 = await (await newContext(browser, BASE)).newPage();
    watch(p2, consoleErrors);
    await p2.goto(url, { waitUntil: "load" });
    await ready(p2);
    await p2.getByTestId("fp-shared-banner").waitFor({ timeout: 10_000 });
    const shared = (await p2.getByTestId("fp-favorite").innerText()).trim();
    if (shared !== favName) fail(`the shared link shows ${shared}, not ${favName}`);
    if (!(await p2.title()).includes(favName)) fail(`the shared page's title is "${await p2.title()}"`);
    const og = await p2.locator('meta[property="og:image"]').getAttribute("content");
    if (!og || !og.includes(`${PATH}/og?d=`)) fail(`the shared page's card is ${og}`);
    else {
      const res = await p2.request.get(og.replace(/^https?:\/\/[^/]+/, BASE));
      if (res.status() !== 200 || !/image\/png/.test(res.headers()["content-type"] ?? "")) fail(`the preview card answered ${res.status()} ${res.headers()["content-type"]}`);
      else fs.writeFileSync(`${OUT}/favorite-picker-og.png`, await res.body());
    }
    if ((await p2.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") !== true) fail("a shared link is indexable");
    await p2.getByTestId("fp-tab-chart").click();
    if (!(await p2.getByTestId("fp-slot-water").getAttribute("data-filled"))) fail("the shared link lost the type chart");
    await shot(p2, `${OUT}/favorite-picker-shared.png`);
    await p2.getByTestId("fp-make-yours").click();
    if (new URL(p2.url()).searchParams.get("d")) fail("Make your own kept the link's address");
    await p2.context().close();
    // The picker's own card.
    const own = await page.request.get(`${BASE}${PATH}/og`);
    if (own.status() !== 200) fail(`the picker's own card answered ${own.status()}`);
    else fs.writeFileSync(`${OUT}/favorite-picker-og-tool.png`, await own.body());
  } catch (e) {
    fail(`share: stopped: ${e.message.split("\n")[0]}`);
  }
  await context.close();

  // ---- No sideways scroll, desktop and phone: the pool, a screen, the bracket and the chart.
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [360, 740]]) {
    try {
      step(`favorite picker: ${w} px`);
      const ctx = await newContext(browser, BASE, { width: w, height: h });
      const p = await ctx.newPage();
      watch(p, consoleErrors);
      await p.goto(`${BASE}${PATH}`, { waitUntil: "load" });
      await ready(p);
      const over = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if ((await over()) > 0) fail(`${w} px: the pool scrolls sideways`);
      // Nothing may stick out past the screen's edge (the page clips sideways overflow, so measure boxes).
      const outside = () => p.evaluate(() => [...document.querySelectorAll('[data-testid="favorite-picker-app"] *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[role="dialog"]')).length);
      await p.getByTestId("fp-cat-starter").click();
      await p.getByTestId("fp-start").click();
      await p.getByTestId("fp-run").waitFor({ timeout: 10_000 });
      if ((await over()) > 0 || (await outside()) > 0) fail(`${w} px: a screen doesn't fit`);
      await shot(p, `${OUT}/favorite-picker-run-${w}.png`);
      // A small pool to its end: Gen 9's starters.
      await p.getByTestId("fp-quit").click();
      await p.getByTestId("fp-quit-yes").click();
      await p.getByTestId("fp-gen-9").click();
      await p.getByTestId("fp-start").click();
      await playToEnd(p);
      await p.getByTestId("fp-result").waitFor({ timeout: 10_000 });
      if ((await over()) > 0 || (await outside()) > 0) fail(`${w} px: the result doesn't fit`);
      await p.getByTestId("fp-tab-chart").click();
      if ((await over()) > 0 || (await outside()) > 0) fail(`${w} px: the chart doesn't fit`);
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
  await runFavoritePicker({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ favorite picker passed");
}
