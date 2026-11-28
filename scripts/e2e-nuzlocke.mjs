/**
 * The Nuzlocke Tracker, end to end in the browser: its card on /tools, the front page's and a game page's server HTML
 * (H1, structured data, canonical, every area), starting a FireRed run, logging Route 1 and nicknaming it, the dupes
 * mark on a second Pidgey-family encounter, marking one dead and finding it in the graveyard, a reload that keeps it
 * all, a boss beaten moving the level cap, the share link opening read-only (with its own title and card), and the
 * phone layout (no sideways scroll at 390 px, in dark and light). Each part records a failure instead of stopping the
 * rest. Screenshots go to $SHOTS (or e2e-screenshots).
 *
 *   node scripts/e2e-nuzlocke.mjs [baseUrl]      (CHROMIUM_PATH picks the browser)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const PATH = "/tools/nuzlocke-tracker";
const GAME = "firered-leafgreen";

async function newContext(browser, BASE, opts = {}, theme = "dark") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  await context.addInitScript((th) => {
    sessionStorage.setItem("pokeiq-splash", "1");
    try {
      localStorage.setItem("pokeiq-theme", th);
    } catch {}
  }, theme);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  return context;
}

function watch(page, consoleErrors) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

const wide = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
const text = async (page, id) => (await page.getByTestId(id).first().innerText()).trim();

/** Starts a run from the game's tile on the front page: its version, its name, the default rules. */
async function startRun(page, BASE, { version = "firered", name = "E2E Run" } = {}) {
  await page.goto(`${BASE}${PATH}`, { waitUntil: "load" });
  await page.getByTestId(`nz-game-${GAME}`).click();
  await page.getByTestId("nz-start").waitFor();
  await page.getByTestId(`nz-version-${version}`).click();
  await page.getByTestId("nz-start-name").fill(name);
  await page.getByTestId("nz-start-go").click();
  await page.waitForURL(/\/tools\/nuzlocke-tracker\/run\?id=/, { timeout: 20_000 });
  await page.getByTestId("nz-run").waitFor({ timeout: 30_000 });
}

/** Logs an area: opens its picker, picks the Pokémon, says it was caught (or got away). */
async function log(page, area, mon, outcome = "caught") {
  await page.getByTestId(`nz-log-${area}`).click();
  await page.getByTestId("nz-picker").waitFor();
  await page.getByTestId(`nz-pick-${mon}`).first().click();
  await page.getByTestId(outcome === "caught" ? "nz-caught" : "nz-failed").click();
  await page.getByTestId("nz-picker").waitFor({ state: "detached" });
}

export async function runNuzlocke({ browser, BASE, OUT, errors, step }) {
  const fail = (m) => errors.push(`nuzlocke: ${m}`);
  const consoleErrors = [];

  step("nuzlocke: its card on /tools opens it");
  {
    const c = await newContext(browser, BASE);
    const p = await c.newPage();
    try {
      await p.goto(`${BASE}/tools`, { waitUntil: "load" });
      const card = p.getByTestId("tool-card-nuzlocke");
      await card.waitFor({ timeout: 15_000 });
      if (!/Nuzlocke Tracker/i.test(await card.innerText())) fail("the /tools card doesn't say Nuzlocke Tracker");
      await card.click();
      await p.waitForURL(/\/tools\/nuzlocke-tracker$/, { timeout: 15_000 });
    } catch (e) {
      fail(`the /tools card: ${e.message.split("\n")[0]}`);
    }
    await c.close();
  }

  step("nuzlocke: the front page's and a game page's HTML");
  try {
    const res = await fetch(`${BASE}${PATH}`);
    const html = await res.text();
    if (res.status !== 200) fail(`front page status ${res.status}`);
    if (!/<h1[^>]*>Nuzlocke Tracker<\/h1>/.test(html)) fail("no H1 on the front page");
    if (!html.includes('"@type":"WebApplication"')) fail("no structured data on the front page");
    if (!/<link rel="canonical" href="[^"]*\/tools\/nuzlocke-tracker"/.test(html)) fail("no canonical link on the front page");
    if (!html.includes(`${PATH}/${GAME}`)) fail("the front page doesn't link to the game page");
    const g = await fetch(`${BASE}${PATH}/${GAME}`);
    const gh = await g.text();
    if (g.status !== 200) fail(`game page status ${g.status}`);
    if (!/<h1[^>]*>FireRed &amp; LeafGreen Nuzlocke Tracker<\/h1>/.test(gh)) fail("no H1 on the game page");
    for (const s of ["Pallet Town", "Route 1", "Viridian Forest", "Mt. Moon", "Brock", "Boulder Badge", "Level cap 14", "/pokemon/pidgey"]) if (!gh.includes(s)) fail(`the game page's HTML has no "${s}"`);
    if ((await fetch(`${BASE}${PATH}/no-such-game`)).status !== 404) fail("an unknown game isn't a 404");
    for (const og of [`${PATH}/og`, `${PATH}/${GAME}/og`]) {
      const r = await fetch(`${BASE}${og}`);
      if (r.status !== 200 || !r.headers.get("content-type")?.includes("image/png")) fail(`${og}: ${r.status} ${r.headers.get("content-type")}`);
    }
    const data = await fetch(`${BASE}${PATH}/${GAME}/data.json`);
    if (data.status !== 200) fail(`data.json status ${data.status}`);
  } catch (e) {
    fail(`server HTML: ${e.message}`);
  }

  step("nuzlocke: start a FireRed run, log Route 1, nickname it, dupes, a death, reload, a boss, share");
  const ctx = await newContext(browser, BASE);
  const page = await ctx.newPage();
  watch(page, consoleErrors);
  let shareLink = null;
  try {
    await startRun(page, BASE, { name: "E2E Run" });
    if ((await text(page, "nz-run-name")) !== "E2E Run") fail("the run's name isn't shown");
    if ((await text(page, "nz-version")) !== "FireRed") fail("the run's version isn't FireRed");
    if ((await page.getByTestId("nz-onboarding").count()) !== 1) fail("no first-run tips");
    await page.getByTestId("nz-onboarding-ok").click();

    // Route 1: only its own Pokémon, in FireRed.
    await page.getByTestId("nz-log-route-1").click();
    await page.getByTestId("nz-picker").waitFor();
    const picks = await page.locator('[data-testid^="nz-pick-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    if (JSON.stringify(picks.sort()) !== JSON.stringify(["nz-pick-16", "nz-pick-19"])) fail(`Route 1's picker offers ${picks.join(", ")}`);
    await page.getByTestId("nz-pick-16").click();
    await page.getByTestId("nz-caught").click();
    // The nickname field takes the focus right after the catch.
    const nick = page.locator('[data-area="route-1"] [data-testid="nz-nickname"]');
    await nick.waitFor();
    if (!(await nick.evaluate((el) => el === document.activeElement))) fail("the nickname field isn't focused after the catch");
    await page.keyboard.type("Skye");
    await page.keyboard.press("Enter");
    if ((await page.locator('[data-area="route-1"]').getAttribute("data-state")) !== "caught") fail("Route 1 isn't logged as caught");

    // A second Pidgey-family encounter (Route 2's Pidgey) is marked, but can still be picked.
    await page.getByTestId("nz-log-route-2").click();
    await page.getByTestId("nz-picker").waitFor();
    const pidgey = page.getByTestId("nz-pick-16").first();
    if ((await pidgey.getAttribute("data-dupe")) !== "1") fail("Route 2's Pidgey isn't marked as a dupe");
    if (!/already have Pidgey's line/.test(await pidgey.innerText())) fail(`the dupe mark says "${await pidgey.innerText()}"`);
    if ((await page.getByTestId("nz-pick-19").first().getAttribute("data-dupe")) !== "0") fail("Rattata is marked as a dupe");
    if (await pidgey.isDisabled()) fail("a dupe can't be picked");
    if (OUT) await page.getByTestId("nz-picker").screenshot({ path: `${OUT}/nuzlocke-picker-dupe.png` }).catch(() => undefined);
    await page.keyboard.press("Escape");

    // Route 22: a Mankey, then it falls to Brock's Onix.
    await log(page, "route-22", "56");
    const mankey = page.locator('[data-area="route-22"] [data-testid="nz-mon"]');
    await mankey.locator('[data-testid="nz-nickname"]').fill("Bruiser");
    await mankey.locator('[data-testid="nz-nickname"]').press("Enter");
    await mankey.getByTestId("nz-status-dead").click();
    await page.getByTestId("nz-death").waitFor();
    await page.getByTestId("nz-death-by").fill("Onix");
    await page.getByTestId("nz-death-pick-95").click();
    await page.getByTestId("nz-death-level").fill("12");
    await page.getByTestId("nz-death-confirm").click();
    await page.getByTestId("nz-death").waitFor({ state: "detached" });
    if (!/graveyard/i.test(await text(page, "nz-toast"))) fail("no toast for the death");
    await page.getByTestId("nz-tab-grave").click();
    const grave = page.getByTestId("nz-grave-mon");
    if ((await grave.count()) !== 1 || !/Bruiser/.test(await grave.innerText()) || !/Onix/.test(await grave.innerText())) fail("the graveyard doesn't hold Bruiser, fainted by Onix");
    if ((await text(page, "nz-stat-dead")) !== "1") fail("the dead count isn't 1");

    // Reload: everything is still there.
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("nz-run").waitFor();
    if ((await page.locator('[data-area="route-1"] [data-testid="nz-nickname"]').inputValue()) !== "Skye") fail("the nickname didn't survive a reload");
    if ((await page.locator('[data-area="route-22"] [data-testid="nz-mon"]').getAttribute("data-status")) !== "dead") fail("the death didn't survive a reload");
    if ((await page.getByTestId("nz-onboarding").count()) !== 0) fail("the first-run tips came back");

    // A boss beaten: the level cap moves on, and a badge is won.
    const cap = () => page.getByTestId("nz-cap").getAttribute("data-cap");
    if ((await cap()) !== "14") fail(`the first level cap is ${await cap()}, not Brock's 14`);
    await page.getByTestId("nz-boss-brock").click();
    if ((await cap()) !== "21") fail(`after Brock the cap is ${await cap()}, not Misty's 21`);
    if (!/^1/.test(await text(page, "nz-badges"))) fail("beating Brock didn't count a badge");
    await page.getByTestId("nz-undo").click();
    if ((await cap()) !== "14") fail("Undo didn't take Brock back");
    await page.getByTestId("nz-boss-brock").click();

    // Share: the read-only link.
    await page.getByTestId("nz-menu").click();
    await page.getByTestId("menu-share").click();
    await page.getByTestId("nz-share").waitFor();
    shareLink = await page.getByTestId("nz-share-link").inputValue();
    if (!shareLink.includes(`${PATH}/run?s=`)) fail(`the share link is ${shareLink}`);
    if (OUT) await page.screenshot({ path: `${OUT}/nuzlocke-run.png` }).catch(() => undefined);
  } catch (e) {
    fail(`the run stopped: ${e.message.split("\n")[0]}`);
  }
  await ctx.close();

  step("nuzlocke: the share link opens read-only, with its own title and card");
  if (shareLink) {
    const s = new URL(shareLink).searchParams.get("s");
    const c = await newContext(browser, BASE);
    const p = await c.newPage();
    watch(p, consoleErrors);
    try {
      const res = await fetch(`${BASE}${PATH}/run?s=${s}`);
      const html = await res.text();
      if (!/<title>[^<]*E2E Run: a FireRed Nuzlocke/.test(html)) fail("the shared page's title doesn't name the run");
      if (!html.includes(`${PATH}/run/og?s=`)) fail("the shared page's preview card isn't the run's");
      if (!/<meta name="robots" content="noindex/.test(html)) fail("the shared page isn't noindex");
      const og = await fetch(`${BASE}${PATH}/run/og?s=${s}`);
      if (og.status !== 200 || !og.headers.get("content-type")?.includes("image/png")) fail(`the shared card: ${og.status}`);
      await p.goto(`${BASE}${PATH}/run?s=${s}`, { waitUntil: "load" });
      await p.getByTestId("nz-shared").waitFor({ timeout: 30_000 });
      if ((await text(p, "nz-run-name")) !== "E2E Run") fail("the shared run's name isn't shown");
      if ((await p.getByTestId("nz-nickname").count()) !== 0) fail("the shared run can be edited");
      if ((await p.locator('[data-testid^="nz-log-"]').count()) !== 0) fail("the shared run offers to log encounters");
      if ((await p.getByTestId("nz-cap").getAttribute("data-cap")) !== "21") fail("the shared run's cap isn't 21");
      if (await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("pokeiq:nuzlocke:v1") ?? '{"runs":{}}').runs).length)) fail("opening a share link saved a run");
    } catch (e) {
      fail(`shared link: ${e.message.split("\n")[0]}`);
    }
    await c.close();
  } else fail("no share link to open");

  step("nuzlocke: phone, 390 px: no sideways scroll, the picker as a sheet, in dark and light");
  for (const theme of ["dark", "light"]) {
    const c = await newContext(browser, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, theme);
    const m = await c.newPage();
    watch(m, consoleErrors);
    try {
      await m.goto(`${BASE}${PATH}`, { waitUntil: "load" });
      if ((await wide(m)) > 391) fail(`${theme} phone: the front page scrolls sideways (${await wide(m)}px)`);
      await m.goto(`${BASE}${PATH}/${GAME}`, { waitUntil: "load" });
      if ((await wide(m)) > 391) fail(`${theme} phone: the game page scrolls sideways (${await wide(m)}px)`);
      await startRun(m, BASE, { name: `Phone ${theme}` });
      if ((await wide(m)) > 391) fail(`${theme} phone: the run scrolls sideways (${await wide(m)}px)`);
      await m.getByTestId("nz-log-route-1").tap();
      await m.getByTestId("nz-picker").waitFor();
      const sheet = await m.locator('[data-testid="nz-picker"] [role="dialog"]').boundingBox();
      if (!sheet || sheet.y + sheet.height < 840) fail(`${theme} phone: the picker isn't a sheet along the bottom`);
      await m.getByTestId("nz-pick-19").tap();
      await m.getByTestId("nz-caught").tap();
      await m.getByTestId("nz-picker").waitFor({ state: "detached" });
      if ((await wide(m)) > 391) fail(`${theme} phone: a logged area scrolls sideways (${await wide(m)}px)`);
      await m.getByTestId("nz-dock-team").tap();
      await m.getByTestId("nz-panel-team").waitFor();
      if ((await m.getByTestId("nz-slot").count()) !== 1) fail(`${theme} phone: the team tab doesn't show the catch`);
      if ((await wide(m)) > 391) fail(`${theme} phone: the team tab scrolls sideways (${await wide(m)}px)`);
      const dock = await m.getByTestId("nz-dock-team").boundingBox();
      if (!dock || dock.y < 844 * 0.75) fail(`${theme} phone: the dock isn't along the bottom (top ${dock?.y})`);
      if (OUT) await m.screenshot({ path: `${OUT}/nuzlocke-team-phone-${theme}.png` }).catch(() => undefined);
    } catch (e) {
      fail(`${theme} phone stopped: ${e.message.split("\n")[0]}`);
    }
    await c.close();
  }
  for (const e of consoleErrors) fail(`console: ${e.slice(0, 200)}`);
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = process.env.SHOTS || "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runNuzlocke({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ nuzlocke e2e passed");
}
