/**
 * Pokémon Hunt, end to end against a running build. The way in is PokéGuessr's landing: its Pokémon Hunt
 * tile opens the hunt's setup in place (as Classic's tile opens its own), and Play starts a hunt there.
 *
 *  - Desktop: the tile opens the setup (aria-expanded); a Normal hunt on the world map with a hint taken
 *    (its cost on the button, its answer in its place, the cost off the round), one pin a round, the
 *    reveal (every spot, the pin's distance, the Pokédex link), the end screen (#367's: the score, the
 *    breakdown map with each round's pin and spots); then Easy on Galar's map, and Hard (no hints,
 *    world only).
 *  - Phone: /pokeguessr#hunt opens the setup; the Daily Hunt, its share card and its board (local
 *    accounts keep it in memory); the same Daily for a second player.
 *  - /pokeguessr/hunt still shows the setup (old and shared links).
 *
 * Checks that no answer reaches the browser before a round is graded. A screenshot of each screen goes
 * to the output folder.
 *
 *   node scripts/e2e-hunt.mjs [baseUrl] [outDir]     (or from e2e-smoke.mjs; E2E_ONLY=hunt runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { guessMapReady, spotIn } from "./e2e-geo-map.mjs";

/** Spots to drop the pin on, as fractions of the map, one per round. */
const SPOTS = [
  [0.62, 0.42],
  [0.3, 0.38],
  [0.5, 0.7],
  [0.7, 0.6],
  [0.45, 0.3],
];

async function open(browser, viewport, phone) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { context, page };
}

/** Every Hunt API response the page gets, to check what reached the browser before each reveal. */
function watchApi(page, fail) {
  page.on("response", async (res) => {
    const url = res.url();
    if (!/\/api\/geo\/hunt(\/guess|\/hint)?$/.test(url) || res.request().method() !== "POST") return;
    const body = await res.json().catch(() => null);
    if (!body || body.error) return;
    if (url.endsWith("/hint")) {
      if ("spots" in body || "reveal" in body || "places" in body) fail("a hint carries answers");
      return;
    }
    const round = url.endsWith("/guess") ? body.next : body.round;
    if (!round) return;
    const keys = Object.keys(round).sort().join(",");
    if (keys !== "art,dex,hints,id,index,name") fail(`a round carries more than the Pokémon: ${keys}`);
    if (!url.endsWith("/guess") && ("spots" in body || "places" in body || "reveal" in body)) fail("the start response carries answers");
  });
}

/** PokéGuessr's how-to opens by itself on a first visit: "Don't show again", as e2e-guessr does. */
async function closeHowTo(page) {
  const sheet = page.locator('[data-testid="howto-sheet"]').first();
  if (await sheet.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) {
    await page.getByTestId("howto-never").click();
    await sheet.waitFor({ state: "hidden" });
  }
}

async function tapMap(page, fx, fy) {
  const { map, area } = await guessMapReady(page);
  await map.click({ position: spotIn(area, fx, fy) });
}

const num = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

/** Plays one round: maybe a hint, the pin (on a phone, through the map card), Guess, then checks the reveal. */
async function playRound(page, { phone, fail, label, shot, hint, spot, noHints }) {
  await page.getByTestId("hunt-card").waitFor();
  const name = (await page.getByTestId("hunt-name").innerText()).trim();
  if (!name) fail(`${label}: the card shows no name`);
  if (!/\?|？/.test(await page.getByTestId("hunt-question").innerText())) fail(`${label}: the card doesn't ask where`);
  const hints = await page.locator("[data-testid=hunt-hints] button").count();
  if (noHints && hints) fail(`${label}: Hard offers hints`);
  if (!noHints && hints !== 3) fail(`${label}: the round offers ${hints} hints, not three`);
  let cost = 0;
  if (hint) {
    const button = page.getByTestId(`hunt-hint-${hint}`);
    cost = num(await button.innerText());
    if (!cost) fail(`${label}: the ${hint} hint's button shows no cost`);
    await button.click();
    await page.locator(`[data-testid=hunt-hint-${hint}][data-taken]`).waitFor();
    if (!(await page.getByTestId(`hunt-hint-${hint}-value`).innerText()).trim()) fail(`${label}: the ${hint} hint shows nothing`);
  }
  if (shot) await page.screenshot({ path: shot.replace(".png", "-round.png") });
  if (phone) await page.getByTestId("geo-map-pill").click();
  await tapMap(page, ...spot);
  if (!(await page.getByTestId("geo-guess").isEnabled())) fail(`${label}: a tap didn't drop the pin`);
  // The page never names a place before the reveal.
  const text = await page.getByTestId("geo-shell").innerText();
  if (/Route \d+|City\b|Town\b|Cave\b/.test(text)) fail(`${label}: the round names a place before the reveal`);
  await page.getByTestId("geo-guess").click();
  await page.getByTestId("hunt-reveal").waitFor();
  await page.getByTestId("hunt-skip").click().catch(() => {});
  if (!(await page.getByTestId("hunt-spot").count())) fail(`${label}: the reveal lists no spots for ${name}`);
  if ((await page.locator("[data-testid=hunt-spot][data-nearest]").count()) !== 1) fail(`${label}: the reveal doesn't mark the pin's nearest spot`);
  if (!(await page.getByTestId("geo-reveal-line").count())) fail(`${label}: no line from the pin to its nearest spot`);
  if (!(await page.getByTestId("hunt-found-line").innerText()).trim()) fail(`${label}: the reveal says nothing about the pin`);
  const dex = await page.getByTestId("hunt-dex-link").getAttribute("href");
  if (!/\/pokemon\/[a-z0-9-]+#encounters$/.test(dex ?? "")) fail(`${label}: the Pokédex link is ${dex}`);
  if (hint) {
    const line = page.getByTestId("hunt-hint-cost");
    if (!(await line.count()) || num(await line.innerText()) !== cost) fail(`${label}: the reveal doesn't take the hint's ${cost} off`);
  }
  if (shot) {
    await page.waitForTimeout(1600);
    await page.screenshot({ path: shot });
  }
  await page.getByTestId("hunt-next").click();
}

async function playGame(page, opts) {
  for (let r = 0; r < 5; r++) await playRound(page, { ...opts, label: `${opts.label} round ${r + 1}`, spot: SPOTS[r], hint: r === 0 ? opts.hint : undefined, shot: r === 0 ? opts.shot : undefined });
  // The end screen (#367's, as Classic's): the total over the dimmed map, the bar, BREAKDOWN and NEXT.
  await page.getByTestId("hunt-results").waitFor();
  await page.waitForTimeout(1800);
  const total = await page.getByTestId("hunt-results").getByTestId("geo-results-total").innerText();
  if (!/\d/.test(total)) fail(opts, `the results say "${total}"`);
  if (!(await page.getByTestId("geo-end-bar").isVisible())) fail(opts, "the end screen has no score bar");
  for (const id of ["hunt-again", "geo-breakdown-toggle"]) if (!(await page.getByTestId(id).isVisible())) fail(opts, `the end screen has no ${id}`);
  // BREAKDOWN: every round's pin and numbered flag on the whole map; a round picked in the tracker brings in its other spots.
  await page.getByTestId("geo-breakdown-toggle").click();
  await page.getByTestId("geo-end-tracker").waitFor();
  if ((await page.locator("[data-testid^=geo-end-round-]").count()) !== 5) fail(opts, "the breakdown's tracker doesn't hold the five rounds");
  if ((await page.getByTestId("geo-flag-number").count()) !== 5) fail(opts, "the breakdown's map doesn't show every round's flag");
  if (opts.shotBreakdown) await page.waitForTimeout(1200), await page.screenshot({ path: opts.shotBreakdown });
  await page.getByTestId("geo-end-round-1").click();
  await page.getByTestId("hunt-results-focus").waitFor();
  await page.getByTestId("geo-end-round-2").click();
  await page.waitForTimeout(400);
  if (!(await page.getByTestId("hunt-results-focus").innerText()).trim()) fail(opts, "picking a round in the tracker didn't show it");
  await page.getByTestId("geo-breakdown-toggle").click();
  await page.waitForTimeout(500);
}
const fail = (opts, msg) => opts.fail(`${opts.label}: ${msg}`);

/** The landing's Pokémon Hunt tile opens the setup in place, and closes it again. */
async function openSetup(page, f) {
  const tile = page.getByTestId("hunt-hub-entry");
  await tile.waitFor();
  if ((await tile.getAttribute("aria-expanded")) !== "false") f("the Pokémon Hunt tile doesn't say it's closed");
  if ((await tile.getAttribute("aria-controls")) !== "hunt") f("the Pokémon Hunt tile doesn't name the setup it opens");
  if (await tile.getAttribute("href")) f("the Pokémon Hunt tile is still a link to another page");
  await tile.click();
  await page.getByTestId("hunt-setup").waitFor();
  if ((await tile.getAttribute("aria-expanded")) !== "true") f("the open tile doesn't say it's open");
  if (!page.url().includes("/pokeguessr") || page.url().includes("/pokeguessr/hunt")) f(`the tile left the landing (${page.url()})`);
}

async function pick(page, group, attr, value) {
  await page.locator(`[data-testid=${group}] [${attr}="${value}"]`).click();
}

export async function runHunt({ browser, BASE, OUT, errors, step }) {
  const fails = (prefix) => (msg) => errors.push(`hunt ${prefix}: ${msg}`);

  step("pokémon hunt: the landing's tile opens the setup in place; a Normal hunt with a hint, the reveal and the end screen");
  {
    const f = fails("desktop");
    const { context, page } = await open(browser, { width: 1440, height: 900 }, false);
    page.on("pageerror", (e) => f(`page error: ${e.message}`));
    watchApi(page, f);
    try {
      await page.goto(`${BASE}/pokeguessr`, { waitUntil: "load" });
      await closeHowTo(page);
      await openSetup(page, f);
      await page.screenshot({ path: `${OUT}/hunt-setup.png` });
      await pick(page, "hunt-map-picker", "data-map", "world");
      await pick(page, "hunt-difficulty", "data-difficulty", "normal");
      await page.getByTestId("hunt-play").click();
      await playGame(page, { phone: false, fail: f, label: "normal", hint: "place", shot: `${OUT}/hunt-reveal-desktop.png`, shotBreakdown: `${OUT}/hunt-breakdown-desktop.png` });
      await page.screenshot({ path: `${OUT}/hunt-results-desktop.png` });

      step("pokémon hunt: Easy on Galar's map, then Hard (world only, no hints)");
      await page.getByTestId("geo-exit").click();
      await page.getByTestId("hunt-setup").waitFor();
      await pick(page, "hunt-map-picker", "data-map", "galar");
      await pick(page, "hunt-difficulty", "data-difficulty", "easy");
      await page.getByTestId("hunt-play").click();
      await playGame(page, { phone: false, fail: f, label: "easy galar", shot: `${OUT}/hunt-reveal-region.png` });
      await page.getByTestId("geo-exit").click();
      await page.getByTestId("hunt-setup").waitFor();
      await pick(page, "hunt-difficulty", "data-difficulty", "hard");
      if (!(await page.locator("[data-testid=hunt-map-picker] [data-map=galar]").isDisabled())) f("Hard still lets a region be picked");
      await page.getByTestId("hunt-play").click();
      await playRound(page, { phone: false, fail: f, label: "hard", spot: SPOTS[0], noHints: true });
      if (!/World|Welt|Monde|Mundo|世界/.test(await page.getByTestId("geo-shell").innerText())) f("Hard isn't on the world map");
    } catch (e) {
      f(e.message);
      await page.screenshot({ path: `${OUT}/hunt-desktop-failure.png` }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  step("pokémon hunt: the Daily Hunt on a phone from /pokeguessr#hunt (share card, today's board), the same for everyone");
  {
    const f = fails("phone");
    const { context, page } = await open(browser, { width: 390, height: 844 }, true);
    page.on("pageerror", (e) => f(`page error: ${e.message}`));
    watchApi(page, f);
    try {
      await page.goto(`${BASE}/pokeguessr#hunt`, { waitUntil: "load" });
      await closeHowTo(page);
      await page.getByTestId("hunt-setup").waitFor();
      await page.screenshot({ path: `${OUT}/hunt-setup-phone.png` });
      await page.getByTestId("hunt-play-daily").click();
      await playGame(page, { phone: true, fail: f, label: "daily", hint: "type", shot: `${OUT}/hunt-reveal-phone.png` });
      if (!(await page.getByTestId("hunt-share-button").isVisible())) f("the Daily's results have no share button");
      if ((await page.getByTestId("hunt-share").getByTestId("geo-share-squares").locator(":scope > span > span").count()) !== 5) f("the share card doesn't have a square per round");
      if (!/Pokémon Hunt #\d+/.test((await page.getByTestId("hunt-share").getAttribute("data-share")) ?? "")) f("the Daily's share text has no title");
      // Today's board (in memory with local accounts): save a name, and it's there.
      const board = page.getByTestId("hunt-end-board");
      if (await board.count()) {
        await page.getByTestId("hunt-board-name").fill("Hunt Tester");
        await page.getByTestId("hunt-board-save").click();
        await page.locator("[data-testid=hunt-board-row]", { hasText: "Hunt Tester" }).first().waitFor();
      } else if (process.env.E2E_HUNT_BOARD === "1") f("the Daily's end screen has no board");
      await page.screenshot({ path: `${OUT}/hunt-results-phone.png` });
      // The same Daily for everyone: a second player gets the same first Pokémon.
      const other = await open(browser, { width: 390, height: 844 }, true);
      try {
        const first = async (p) => {
          await p.goto(`${BASE}/pokeguessr/hunt`, { waitUntil: "load" });
          await p.getByTestId("hunt-setup").waitFor();
          await p.getByTestId("hunt-play-daily").click();
          return (await p.getByTestId("hunt-name").innerText()).trim();
        };
        const [a, b] = [await first(page), await first(other.page)];
        if (a !== b) f(`two players got different Dailies (${a}, ${b})`);
      } finally {
        await other.context.close();
      }
    } catch (e) {
      f(e.message);
      await page.screenshot({ path: `${OUT}/hunt-phone-failure.png` }).catch(() => {});
    } finally {
      await context.close();
    }
  }
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = process.argv[3] ?? "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  const errors = [];
  await runHunt({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ pokémon hunt passed");
}
