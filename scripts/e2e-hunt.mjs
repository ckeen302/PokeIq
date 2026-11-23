/**
 * Pokémon Hunt (/pokeguessr/hunt), end to end against a running build: the
 * hub's card, then Classic on a desktop (several pins: place, move, remove;
 * the reveal's spots, regions found and Pokédex link; the results), Region
 * mode, and the Daily Hunt on a phone (the map card, the share grid). Checks
 * that no answer reaches the browser before a round is graded. A screenshot
 * of each screen goes to the output folder.
 *
 *   node scripts/e2e-hunt.mjs [baseUrl] [outDir]     (or from e2e-smoke.mjs; E2E_ONLY=hunt runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { guessMapReady, spotIn } from "./e2e-geo-map.mjs";

/** Spots to drop pins on, as fractions of the map (spread out, so pins land apart). */
const SPOTS = [
  [0.62, 0.42],
  [0.3, 0.38],
  [0.5, 0.7],
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
    if (!/\/api\/geo\/hunt(\/guess)?$/.test(url) || res.request().method() !== "POST") return;
    const body = await res.json().catch(() => null);
    if (!body || body.error) return;
    const round = url.endsWith("/guess") ? body.next : body.round;
    if (!round) return;
    const keys = Object.keys(round).sort().join(",");
    if (keys !== "art,dex,id,index,name,pins,regions") fail(`a round carries more than the Pokémon: ${keys}`);
    if (!url.endsWith("/guess") && ("spots" in body || "places" in body || "reveal" in body)) fail("the start response carries answers");
  });
}

async function tapMap(page, fx, fy) {
  const { map, area } = await guessMapReady(page);
  await map.click({ position: spotIn(area, fx, fy) });
}

/** Pins down: the tray's placed chips (a one-pin round has no chips: the Guess button turns on instead). */
const pinCount = async (page) => {
  const chips = await page.locator('[data-testid^="hunt-pin-chip-"]').count();
  if (chips) return page.locator('[data-testid^="hunt-pin-chip-"][data-placed]').count();
  return (await page.getByTestId("geo-guess").isEnabled()) ? 1 : 0;
};
const pinMax = async (page) => Math.max(1, await page.locator('[data-testid^="hunt-pin-chip-"]').count());

/** Plays one round: drops the round's pins (on a phone, through the map card), checks the counter, hunts, checks the reveal. */
async function playRound(page, { phone, fail, label, shot, edit = false }) {
  await page.getByTestId("hunt-card").waitFor();
  const name = (await page.getByTestId("hunt-name").innerText()).trim();
  if (phone) await page.getByTestId("geo-map-pill").click();
  const max = await pinMax(page);
  for (let i = 0; i < max; i++) await tapMap(page, ...SPOTS[i % SPOTS.length]);
  if ((await pinCount(page)) !== max) fail(`${label}: ${max} taps placed ${await pinCount(page)} pins`);
  if (edit) {
    // A tap past the round's pins moves the nearest one (never a pin too many).
    await tapMap(page, 0.55, 0.45);
    if ((await pinCount(page)) !== max) fail(`${label}: a tap with every pin down changed the count`);
    // Remove a pin, then put it back.
    await page.getByTestId("hunt-pin-remove-1").click();
    if ((await pinCount(page)) !== max - 1) fail(`${label}: removing a pin didn't drop the count`);
    await tapMap(page, ...SPOTS[0]);
    if (max > 1) {
      // Pick a pin up and move it: the count stays.
      await page.getByTestId(`hunt-pin-chip-${max}`).click();
      await tapMap(page, 0.45, 0.55);
    }
    if ((await pinCount(page)) !== max) fail(`${label}: after remove and move there are ${await pinCount(page)} of ${max} pins`);
  }
  if (shot) await page.screenshot({ path: shot.replace(".png", "-pins.png") });
  // The page never names a place before the reveal.
  const text = await page.getByTestId("geo-shell").innerText();
  if (/Route \d+|City\b|Town\b|Cave\b/.test(text)) fail(`${label}: the round names a place before the reveal`);
  await page.getByTestId("geo-guess").click();
  await page.getByTestId("hunt-reveal").waitFor();
  // Skip the pop-in, so the whole answer is on screen.
  await page.getByTestId("hunt-skip").click().catch(() => {});
  const spots = await page.getByTestId("hunt-spot").count();
  if (!spots) fail(`${label}: the reveal lists no spots for ${name}`);
  const found = await page.getByTestId("hunt-found-line").innerText();
  if (!/found/i.test(found) && !/regions/i.test(found)) fail(`${label}: the reveal says "${found}"`);
  const dex = await page.getByTestId("hunt-dex-link").getAttribute("href");
  if (!/\/pokemon\/[a-z0-9-]+#encounters$/.test(dex ?? "")) fail(`${label}: the Pokédex link is ${dex}`);
  if (shot) {
    await page.waitForTimeout(1600);
    await page.screenshot({ path: shot });
  }
  await page.getByTestId("hunt-next").click();
}

async function playGame(page, opts) {
  for (let r = 0; r < 5; r++) await playRound(page, { ...opts, label: `${opts.label} round ${r + 1}`, edit: opts.edit && r === 0, shot: r === 0 ? opts.shot : undefined });
  await page.getByTestId("hunt-results").waitFor();
  const total = await page.getByTestId("hunt-results-total").innerText();
  if (!/\d/.test(total)) fail(opts, `the results say "${total}"`);
}
const fail = (opts, msg) => opts.fail(`${opts.label}: ${msg}`);

export async function runHunt({ browser, BASE, OUT, errors, step }) {
  const fails = (prefix) => (msg) => errors.push(`hunt ${prefix}: ${msg}`);

  step("pokémon hunt: hub card, Classic on a desktop (several pins, move, remove), the reveal and results");
  {
    const f = fails("desktop");
    const { context, page } = await open(browser, { width: 1440, height: 900 }, false);
    page.on("pageerror", (e) => f(`page error: ${e.message}`));
    watchApi(page, f);
    try {
      await page.goto(`${BASE}/pokeguessr`, { waitUntil: "load" });
      await page.getByTestId("hunt-hub-entry").waitFor();
      await page.getByTestId("hunt-hub-entry").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/hunt-hub-entry.png` });
      await page.getByTestId("hunt-hub-entry").click();
      await page.getByTestId("hunt-hub").waitFor();
      await page.screenshot({ path: `${OUT}/hunt-hub.png`, fullPage: true });
      await page.getByTestId("hunt-play-classic").click();
      await playGame(page, { phone: false, fail: f, label: "classic", edit: true, shot: `${OUT}/hunt-reveal-desktop.png` });
      await page.screenshot({ path: `${OUT}/hunt-results-desktop.png`, fullPage: true });

      step("pokémon hunt: Region mode (one pin a round, on the region's map)");
      await page.getByTestId("hunt-again").click();
      await page.getByTestId("hunt-card").waitFor();
      // Back to the hunt's hub for Region mode.
      await page.goto(`${BASE}/pokeguessr/hunt`, { waitUntil: "load" });
      await page.getByTestId("hunt-region-picker").getByRole("radio", { name: "Galar" }).click();
      await page.getByTestId("hunt-play-region").click();
      await page.getByTestId("hunt-card").waitFor();
      if ((await pinMax(page)) !== 1) f("region mode takes more than one pin");
      await playGame(page, { phone: false, fail: f, label: "region", shot: `${OUT}/hunt-reveal-region.png` });
    } catch (e) {
      f(e.message);
      await page.screenshot({ path: `${OUT}/hunt-desktop-failure.png` }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  step("pokémon hunt: the Daily Hunt on a phone (the map card, the share grid)");
  {
    const f = fails("phone");
    const { context, page } = await open(browser, { width: 390, height: 844 }, true);
    page.on("pageerror", (e) => f(`page error: ${e.message}`));
    watchApi(page, f);
    try {
      await page.goto(`${BASE}/pokeguessr/hunt`, { waitUntil: "load" });
      await page.getByTestId("hunt-hub").waitFor();
      await page.screenshot({ path: `${OUT}/hunt-hub-phone.png`, fullPage: true });
      await page.getByTestId("hunt-play-daily").click();
      await page.getByTestId("hunt-card").waitFor();
      await page.screenshot({ path: `${OUT}/hunt-round-phone.png` });
      await playGame(page, { phone: true, fail: f, label: "daily", shot: `${OUT}/hunt-reveal-phone.png` });
      if (!(await page.getByTestId("hunt-share-button").isVisible())) f("the Daily's results have no share button");
      if ((await page.getByTestId("hunt-share-grid").locator("li").count()) !== 5) f("the share grid doesn't have a row per round");
      await page.screenshot({ path: `${OUT}/hunt-results-phone.png`, fullPage: true });
      // The same Daily for everyone: a second player gets the same first Pokémon.
      const other = await open(browser, { width: 390, height: 844 }, true);
      try {
        const first = async (p) => {
          await p.goto(`${BASE}/pokeguessr/hunt`, { waitUntil: "load" });
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
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
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
