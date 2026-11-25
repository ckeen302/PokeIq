/**
 * The Shiny Hunt Counter, end to end in the browser: the page (title, H1, how-to and structured data in the server's
 * HTML), picking a target, setting the game, method and Shiny Charm (the odds follow), counting by click, Space, Enter
 * and "+", subtracting with "−", undo with Z, a custom step, typing the count in, a reload that keeps everything, a
 * phase, the "Found it!" celebration and the trophy case, a share link that opens the hunt with its own title and
 * preview card, the chain and level inputs (Poké Radar, DexNav, Ultra Wormholes, Brilliant Pokémon), and the phone layout
 * (no sideways scroll at 390 px, the count button in thumb reach). Each part records
 * a failure instead of stopping the rest. Screenshots go to $SHOTS (or e2e-screenshots).
 *
 *   node scripts/e2e-shiny-counter.mjs [baseUrl]      (CHROMIUM_PATH picks the browser)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const PATH = "/tools/shiny-hunt-counter";

async function newContext(browser, BASE, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  return context;
}

function watch(page, consoleErrors) {
  page.on("console", (m) => {
    // Remote Pokémon pictures (HOME renders, sprites) can fail offline; that's not the counter's fault.
    if (m.type() === "error" && !/Failed to load resource|raw\.githubusercontent/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

const ready = (page) => page.locator('[data-testid="sh-app"][data-ready="1"]').waitFor({ timeout: 60_000 });
const count = async (page) => Number(await page.getByTestId("sh-counter").getAttribute("data-count"));
const odds = async (page) => (await page.getByTestId("sh-odds").innerText()).trim();
/** The hunt setup opens above the stage (it starts open on a hunt with nothing counted). */
async function openSetup(page) {
  const toggle = page.getByTestId("sh-setup-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByTestId("sh-setup").waitFor();
}
async function pickGame(page, id) {
  await openSetup(page);
  await page.getByTestId(`sh-game-${id}`).click();
}

export async function runShinyCounter({ browser, BASE, OUT, errors, step }) {
  const fail = (m) => errors.push(`shiny counter: ${m}`);
  const consoleErrors = [];

  step("shiny counter: the page's HTML");
  try {
    const res = await fetch(`${BASE}${PATH}`);
    const html = await res.text();
    if (res.status !== 200) fail(`page status ${res.status}`);
    if (!/<h1[^>]*>Shiny Hunt Counter<\/h1>/.test(html)) fail("no H1 in the server HTML");
    if (!html.includes("How it works")) fail("no how-to in the server HTML");
    if (!html.includes('"@type":"WebApplication"')) fail("no structured data");
    if (!/<link rel="canonical" href="[^"]*\/tools\/shiny-hunt-counter"/.test(html)) fail("no canonical link");
    const og = await fetch(`${BASE}${PATH}/og`);
    if (og.status !== 200 || !og.headers.get("content-type")?.includes("image/png")) fail(`tool card: ${og.status} ${og.headers.get("content-type")}`);
  } catch (e) {
    fail(`server HTML: ${e.message}`);
  }

  step("shiny counter: pick, set up, count, keys, undo, edit, reload");
  const ctx = await newContext(browser, BASE);
  const page = await ctx.newPage();
  watch(page, consoleErrors);
  let shareUrl = null;
  try {
    await page.goto(`${BASE}${PATH}`, { waitUntil: "load" });
    await ready(page);
    await page.getByTestId("sh-start").waitFor();
    await page.getByTestId("sh-picker-search").fill("gyarados");
    await page.getByTestId("sh-pick-130").click();
    await page.getByTestId("sh-counter").waitFor();
    if (!/Gyarados/.test(await page.getByTestId("sh-target-name").innerText())) fail("the target isn't Gyarados");

    // Game, method, charm: the odds follow.
    await pickGame(page, "sv");
    if ((await odds(page)) !== "1 in 4,096") fail(`SV base odds: ${await odds(page)}`);
    await page.getByTestId("sh-charm").click();
    if ((await odds(page)) !== "1 in 1,366") fail(`SV charm odds: ${await odds(page)}`);
    await page.getByTestId("sh-method-outbreak").click();
    await page.getByTestId("sh-choice-cleared-60").click();
    await page.getByTestId("sh-choice-sparkling-3").click();
    if ((await odds(page)) !== "1 in 512") fail(`SV best odds: ${await odds(page)}`);

    // Counting: click, Space, Enter, "+"; subtract with "−"; undo with Z.
    await page.getByTestId("sh-add").click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await page.keyboard.press("+");
    if ((await count(page)) !== 4) fail(`after a click and three keys the count is ${await count(page)}`);
    await page.keyboard.press("-");
    if ((await count(page)) !== 3) fail(`after "−" the count is ${await count(page)}`);
    await page.keyboard.press("z");
    if ((await count(page)) !== 4) fail(`after undo the count is ${await count(page)}`);
    const live = await page.getByTestId("sh-live").innerText();
    if (!/4 encounters/.test(live)) fail(`the live region says "${live}"`);

    // A step of 3.
    await page.getByTestId("sh-step-up").click();
    await page.getByTestId("sh-step-up").click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Space");
    if ((await count(page)) !== 7) fail(`a step of 3 made ${await count(page)}`);

    // Typing the count in.
    await page.getByTestId("sh-count").click();
    await page.getByTestId("sh-count-input").fill("2500");
    await page.keyboard.press("Enter");
    if ((await count(page)) !== 2500) fail(`typed 2500, the count is ${await count(page)}`);
    const chance = await page.getByTestId("sh-stat-chance").locator("[data-value]").innerText();
    // 1 − (1 − 8/4096-ish)^2500 at 1 in 512: about 99.2%.
    if (!/^99/.test(chance)) fail(`chance by now at 2,500 of 1 in 512: ${chance}`);
    if ((await page.getByTestId("sh-timer").getAttribute("data-running")) !== "1") fail("the timer didn't start with the first count");

    // Reload: the hunt is still there.
    await page.reload({ waitUntil: "load" });
    await ready(page);
    await page.getByTestId("sh-counter").waitFor();
    if ((await count(page)) !== 2500) fail(`after a reload the count is ${await count(page)}`);
    if ((await odds(page)) !== "1 in 512") fail(`after a reload the odds are ${await odds(page)}`);

    // A phase: a different shiny.
    await page.getByTestId("sh-found").click();
    await page.getByTestId("sh-found-other").click();
    await page.getByTestId("sh-phase-picker").getByTestId("sh-picker-search").fill("magikarp");
    await page.getByTestId("sh-phase-picker").getByTestId("sh-pick-129").click();
    await page.getByTestId("sh-phases").waitFor({ timeout: 5000 });
    if (!/Phase 2/.test(await page.getByTestId("sh-phase").innerText())) fail("no phase 2 chip");
    await page.keyboard.press("Space");
    if ((await count(page)) !== 2503) fail(`counting on after a phase: ${await count(page)}`);

    // Share link (before it's found: a hunt in progress).
    await page.getByTestId("sh-share").click();
    await page.getByTestId("sh-share-dialog").waitFor();
    shareUrl = await page.getByTestId("sh-share-url").inputValue();
    await page.locator('[data-testid="sh-share-preview"][data-ready="1"]').waitFor({ timeout: 20_000 }).catch(() => fail("the share picture didn't draw"));
    const dl = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
    await page.getByTestId("sh-share-png").click();
    if (!(await dl)) fail("no PNG download");
    await page.keyboard.press("Escape");

    // Found it: the celebration, then the trophy case.
    await page.getByTestId("sh-found").click();
    await page.getByTestId("sh-found-target").click();
    await page.getByTestId("sh-celebrate").waitFor();
    if (!/Shiny Gyarados!/.test(await page.getByTestId("sh-cel-title").innerText())) fail("the celebration doesn't name the shiny");
    if (OUT) await page.waitForTimeout(900);
    if (OUT) await page.screenshot({ path: `${OUT}/shiny-counter-found-desktop.png` }).catch(() => undefined);
    await page.getByTestId("sh-cel-trophies").click();
    await page.getByTestId("sh-trophy").first().waitFor();
    if ((await page.getByTestId("sh-trophy").count()) !== 1) fail("the trophy case doesn't have the one shiny");
    await page.reload({ waitUntil: "load" });
    await ready(page);
    await page.getByTestId("sh-tab-trophies").click();
    if ((await page.getByTestId("sh-trophy").count()) !== 1) fail("the trophy case is empty after a reload");

    // A second hunt, then rename and delete it from the hunts list.
    await page.getByTestId("sh-tab-hunts").click();
    await page.getByTestId("sh-new-hunt").click();
    await page.getByTestId("sh-pick-dialog").getByTestId("sh-picker-search").fill("25");
    await page.keyboard.press("Enter");
    await page.getByTestId("sh-counter").waitFor();
    await page.getByTestId("sh-tab-hunts").click();
    await page.getByTestId("sh-hunt-menu").first().click();
    await page.getByTestId("sh-menu-rename").click();
    await page.getByTestId("sh-rename-input").fill("Sparkly mouse");
    await page.getByTestId("sh-rename-save").click();
    if (!(await page.getByTestId("sh-hunt-name").first().innerText()).includes("Sparkly mouse")) fail("rename didn't stick");
    await page.getByTestId("sh-hunt-menu").first().click();
    await page.getByTestId("sh-menu-delete").click();
    await page.getByTestId("sh-delete-confirm").click();
    if ((await page.getByTestId("sh-hunt-card").count()) !== 0) fail("delete didn't remove the hunt");
  } catch (e) {
    fail(`desktop run stopped: ${e.message.split("\n")[0]}`);
  }
  await ctx.close();

  step("shiny counter: chains and levels (Poké Radar, DexNav, Ultra Wormholes, Brilliant Pokémon)");
  const c2 = await newContext(browser, BASE);
  const pg = await c2.newPage();
  watch(pg, consoleErrors);
  try {
    await pg.goto(`${BASE}${PATH}`, { waitUntil: "load" });
    await ready(pg);
    await pg.getByTestId("sh-picker-search").fill("ralts");
    await pg.getByTestId("sh-pick-280").click();
    await pg.getByTestId("sh-counter").waitFor();
    // Brilliant Diamond/Shining Pearl's Poké Radar: 1 in 99 from a chain of 40, and no Shiny Charm switch.
    await pickGame(pg, "bdsp");
    await pg.getByTestId("sh-method-pokeRadar").click();
    if (await pg.getByTestId("sh-charm").count()) fail("BD/SP Poké Radar shows a Shiny Charm switch");
    await pg.getByTestId("sh-chain-value").fill("16");
    if ((await odds(pg)) !== "1 in 2,048") fail(`BD/SP radar at 16: ${await odds(pg)}`);
    await pg.getByTestId("sh-chain-up").click();
    if ((await pg.getByTestId("sh-chain-value").inputValue()) !== "17") fail("the chain's + didn't add one");
    await pg.getByTestId("sh-chain-value").fill("40");
    if ((await odds(pg)) !== "1 in 99") fail(`BD/SP radar at 40: ${await odds(pg)}`);
    // Platinum's radar: 1 in 195 at 40 (the forced 328/65536 plus the normal 1/8192).
    await pickGame(pg, "dppt");
    await pg.getByTestId("sh-method-pokeRadar").click();
    await pg.getByTestId("sh-chain-value").fill("40");
    if ((await odds(pg)) !== "1 in 195") fail(`DPPt radar at 40: ${await odds(pg)}`);
    // DexNav: Search Level 999, the 50th of a chain: 1 in 62.
    await pickGame(pg, "oras");
    await pg.getByTestId("sh-method-dexNav").click();
    await pg.getByTestId("sh-level-value").fill("999");
    await pg.getByTestId("sh-chain-value").fill("49");
    if ((await odds(pg)) !== "1 in 62") fail(`DexNav 999 / 50th: ${await odds(pg)}`);
    await pg.getByTestId("sh-charm").click();
    await pg.getByTestId("sh-chain-value").fill("99");
    if ((await odds(pg)) !== "1 in 36.3") fail(`DexNav 999 / 100th with the charm: ${await odds(pg)}`);
    if (OUT) await pg.getByTestId("sh-setup").screenshot({ path: `${OUT}/shiny-counter-dexnav-desktop.png` }).catch(() => undefined);
    // Ultra Wormholes: 3 rings at 5,000 light-years is 36%; the distance steps by 100.
    await pickGame(pg, "usum");
    await pg.getByTestId("sh-method-wormhole").click();
    await pg.getByTestId("sh-choice-rings-3").click();
    await pg.getByTestId("sh-level-value").fill("4900");
    await pg.getByTestId("sh-level-up").click();
    if ((await pg.getByTestId("sh-level-value").inputValue()) !== "5,000") fail(`the distance's + made ${await pg.getByTestId("sh-level-value").inputValue()}`);
    if ((await odds(pg)) !== "1 in 2.8") fail(`3-ring wormhole at 5,000 ly: ${await odds(pg)}`);
    // Sword/Shield Brilliant Pokémon at 500 battled with the charm: 1 in 456.
    await pickGame(pg, "swsh");
    await pg.getByTestId("sh-method-brilliant").click();
    await pg.getByTestId("sh-choice-battled-500").click();
    if ((await odds(pg)) !== "1 in 456") fail(`Brilliant, 500 battled, charm: ${await odds(pg)}`);
    // Kept across a reload, level included.
    await pickGame(pg, "oras");
    await pg.getByTestId("sh-method-dexNav").click();
    await pg.getByTestId("sh-level-value").fill("250");
    await pg.reload({ waitUntil: "load" });
    await ready(pg);
    await pg.getByTestId("sh-counter").waitFor();
    if ((await pg.getByTestId("sh-level-value").inputValue()) !== "250") fail("the Search Level didn't survive a reload");
  } catch (e) {
    fail(`chains and levels stopped: ${e.message.split("\n")[0]}`);
  }
  await c2.close();

  step("shiny counter: a shared link opens the hunt with its own title and card");
  if (shareUrl) {
    try {
      const d = new URL(shareUrl).searchParams.get("d");
      const res = await fetch(`${BASE}${PATH}?d=${d}`);
      const html = await res.text();
      if (!/<title>[^<]*Hunting a shiny Gyarados/.test(html)) fail("the shared page's title doesn't name the hunt");
      if (!html.includes('data-testid="sh-shared"')) fail("the shared page doesn't show the hunt");
      if (!html.includes(`${PATH}/og?d=`)) fail("the shared page's preview card isn't the hunt's");
      const og = await fetch(`${BASE}${PATH}/og?d=${d}`);
      if (og.status !== 200) fail(`the shared card: ${og.status}`);
    } catch (e) {
      fail(`shared link: ${e.message}`);
    }
  } else fail("no share link to open");

  step("shiny counter: phone, 390 px: no sideways scroll, count button in thumb reach");
  for (const theme of ["dark", "light"]) {
    const p = await newContext(browser, BASE, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.addInitScript((th) => {
      try {
        localStorage.setItem("pokeiq-theme", th);
      } catch {}
    }, theme);
    const m = await p.newPage();
    watch(m, consoleErrors);
    try {
      await m.goto(`${BASE}${PATH}`, { waitUntil: "load" });
      await ready(m);
      const wide = () => m.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      if ((await wide()) > 391) fail(`${theme} phone: the start screen scrolls sideways (${await wide()}px)`);
      await m.getByTestId("sh-picker-search").fill("charizard");
      await m.getByTestId("sh-pick-6").click();
      await m.getByTestId("sh-counter").waitFor();
      for (let i = 0; i < 3; i++) await m.getByTestId("sh-add-dock").tap();
      if ((await count(m)) !== 3) fail(`${theme} phone: three taps made ${await count(m)}`);
      const box = await m.getByTestId("sh-add-dock").boundingBox();
      if (!box || box.y < 844 * 0.6) fail(`${theme} phone: the count button isn't in thumb reach (top ${box?.y})`);
      if ((await wide()) > 391) fail(`${theme} phone: the counter scrolls sideways (${await wide()}px)`);
      await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      if ((await wide()) > 391) fail(`${theme} phone: the page scrolls sideways at the bottom`);
      // The DexNav's two inputs fit the phone.
      await pickGame(m, "oras");
      await m.getByTestId("sh-method-dexNav").click();
      await m.getByTestId("sh-level-value").fill("300");
      await m.getByTestId("sh-chain-value").fill("24");
      if ((await wide()) > 391) fail(`${theme} phone: the DexNav setup scrolls sideways (${await wide()}px)`);
      if (OUT) await m.getByTestId("sh-setup").screenshot({ path: `${OUT}/shiny-counter-dexnav-phone-${theme}.png` }).catch(() => undefined);
    } catch (e) {
      fail(`${theme} phone stopped: ${e.message.split("\n")[0]}`);
    }
    await p.close();
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
  await runShinyCounter({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ shiny counter passed");
}
