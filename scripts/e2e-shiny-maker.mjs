/**
 * The Tools tab and the Shiny Pokémon Maker, end to end in the browser: /tools and its card, the maker's first
 * design, picking a Pokémon by search, recolouring a part from its chip and by clicking the sprite, Randomise,
 * the Normal / Official / Yours switch, undo, a share link that reopens with the same pixels, a PNG download, HD
 * (where the browser has WebGL 2), the preview card, and the phone layout (no sideways scroll, controls at least
 * 40 px, labels at least 12 px, the colour sheet above the tab bar). Each part records a failure instead of
 * stopping the rest. Screenshots are best effort (CI runners sometimes can't capture one).
 *
 *   node scripts/e2e-shiny-maker.mjs [baseUrl]       (or from e2e-smoke.mjs; E2E_ONLY=shiny-maker runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

/** A hash of the figure's pixels (the canvas the maker draws). */
const figureHash = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="sm-canvas"]');
    if (!c || !c.width) return null;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
    return `${c.width}x${c.height}:${h >>> 0}`;
  });

/** Waits for the figure's pixels to differ from `before` (the maker redraws on the next frame). */
async function changedFrom(page, before, timeout = 5_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const now = await figureHash(page);
    if (now && now !== before) return now;
    await page.waitForTimeout(100);
  }
  return null;
}

/** Client coordinates of an opaque pixel of the figure near its middle (a part, not the outline, if possible). */
const opaquePoint = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="sm-canvas"]');
    const r = c.getBoundingClientRect();
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let best = null;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const o = (y * c.width + x) * 4;
        if (d[o + 3] < 200) continue;
        const lum = d[o] + d[o + 1] + d[o + 2];
        if (lum < 120) continue; // skip the dark outline
        const dist = Math.hypot(x - c.width / 2, y - c.height / 2);
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    if (!best) return null;
    return { x: r.left + ((best.x + 0.5) / c.width) * r.width, y: r.top + ((best.y + 0.5) / c.height) * r.height };
  });

async function shot(page, path, errors) {
  await page.screenshot({ path }).catch((e) => console.log(`  (screenshot skipped: ${e.message.split("\n")[0]})`));
  void errors;
}

export async function runShinyMaker({ browser, BASE, OUT = "e2e-screenshots", errors, step }) {
  step("Tools tab and the Shiny Pokémon Maker");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
  const fail = (msg) => errors.push(`shiny maker: ${msg}`);

  try {
    // The hub and its one card.
    await page.goto(`${BASE}/tools`, { waitUntil: "load" });
    if ((await page.locator("h1").first().innerText()).trim().toUpperCase() !== "TOOLS") fail("/tools has no TOOLS title");
    const card = page.getByTestId("tool-card-shiny-maker");
    await card.waitFor({ timeout: 15_000 });
    const nav = page.locator('header a[href="/tools"]');
    if (!(await nav.count())) fail("the header has no Tools link");
    else if ((await nav.first().getAttribute("aria-current")) !== "page") fail("the Tools link isn't marked current on /tools");
    await shot(page, `${OUT}/tools-hub.png`, errors);
    await card.click();
    await page.waitForURL(/\/tools\/shiny-maker/, { timeout: 15_000 });

    // The first design draws.
    await page.getByTestId("sm-canvas").waitFor({ timeout: 30_000 });
    if ((await page.locator("h1").first().innerText()).trim() !== "Shiny Pokémon Maker") fail("the maker's H1 is wrong");
    const scale = Number(await page.getByTestId("sm-figure").getAttribute("data-scale"));
    if (!Number.isInteger(scale) || scale < 2) fail(`the sprite isn't at a whole-number scale (${scale})`);
    await page.waitForFunction(() => new URL(location.href).searchParams.get("d"), null, { timeout: 5_000 }).catch(() => fail("the address doesn't carry the design"));
    await shot(page, `${OUT}/shiny-maker-desktop.png`, errors);

    // Pick a Pokémon by search.
    await page.getByTestId("sm-pokemon").click();
    await page.getByTestId("sm-picker-search").fill("pikachu");
    await page.getByTestId("sm-pick-25").click();
    await page.getByTestId("sm-pokemon").filter({ hasText: "Pikachu" }).waitFor({ timeout: 15_000 }).catch(() => fail("picking Pikachu by search didn't switch the Pokémon"));
    await page.waitForTimeout(400);

    // Recolour a part from its chip.
    let before = await figureHash(page);
    await page.getByTestId("sm-part-0").click();
    await page.getByTestId("sm-popover").waitFor({ timeout: 5_000 }).catch(() => fail("a part chip didn't open its colour"));
    await page.getByTestId("sm-swatch").nth(4).click();
    let after = await changedFrom(page, before);
    if (!after) fail("a swatch didn't recolour the part");
    // Keyboard on the hue ring nudges the colour.
    before = after;
    await page.getByTestId("sm-hue").focus();
    await page.keyboard.press("Shift+ArrowRight");
    if (!(await changedFrom(page, before))) fail("the hue ring didn't respond to the arrow keys");
    await shot(page, `${OUT}/shiny-maker-popover.png`, errors);
    await page.keyboard.press("Escape");
    await page.getByTestId("sm-popover").waitFor({ state: "hidden", timeout: 3_000 }).catch(() => fail("Escape didn't close the colour"));

    // Recolour by clicking the sprite.
    const pt = await opaquePoint(page);
    if (!pt) fail("no opaque pixel to click");
    else {
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      await page.mouse.up();
      if (!(await page.getByTestId("sm-popover").waitFor({ timeout: 5_000 }).then(() => true, () => false))) fail("clicking the sprite didn't open that part's colour");
      else {
        before = await figureHash(page);
        await page.getByTestId("sm-swatch").nth(1).click();
        if (!(await changedFrom(page, before))) fail("recolouring from a sprite click changed nothing");
        await page.keyboard.press("Escape");
      }
    }

    // Randomise, then undo with the keyboard.
    before = await figureHash(page);
    await page.getByTestId("sm-randomise").click();
    const randomised = await changedFrom(page, before);
    if (!randomised) fail("Randomise changed nothing");
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("Control+z");
    if ((await changedFrom(page, randomised)) !== before) fail("Ctrl+Z didn't undo Randomise");
    await page.keyboard.press("Control+Shift+z");
    if ((await changedFrom(page, before)) !== randomised) fail("Ctrl+Shift+Z didn't redo");

    // The Normal / Official / Yours switch.
    const yours = await figureHash(page);
    await page.locator('[data-testid="sm-view"] [data-value="official"]').click();
    const official = await changedFrom(page, yours);
    if (!official) fail("Official shows the same pixels as Yours");
    await page.locator('[data-testid="sm-view"] [data-value="normal"]').click();
    if (!(await changedFrom(page, official))) fail("Normal shows the same pixels as Official");
    await page.locator('[data-testid="sm-view"] [data-value="yours"]').click();
    if ((await changedFrom(page, "x")) !== yours) fail("Yours didn't come back");

    // Share: the link reopens with the same pixels.
    await page.getByTestId("sm-share").click();
    await page.getByTestId("sm-toast").waitFor({ timeout: 5_000 }).catch(() => fail("Share showed no toast"));
    let link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (!/\/tools\/shiny-maker\?d=[A-Za-z0-9_-]+$/.test(link)) {
      fail(`Share didn't copy a design link (${link.slice(0, 80)})`);
      link = page.url();
    }
    const shared = await context.newPage();
    await shared.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
    await shared.getByTestId("sm-canvas").waitFor({ timeout: 30_000 });
    await shared.waitForTimeout(500);
    if ((await figureHash(shared)) !== yours) fail("the share link didn't recreate the same pixels");
    await shared.close();

    // A junk link opens a fresh design, with a note.
    const junk = await context.newPage();
    await junk.goto(`${BASE}/tools/shiny-maker?d=%3Cscript%3E`, { waitUntil: "load" });
    await junk.getByTestId("sm-canvas").waitFor({ timeout: 30_000 }).catch(() => fail("a junk link didn't fall back to a fresh design"));
    await junk.close();

    // Extras: a finish, and a PNG download at 4×.
    await page.getByTestId("sm-more").click();
    await page.getByTestId("sm-extras").waitFor({ timeout: 5_000 });
    await shot(page, `${OUT}/shiny-maker-extras.png`, errors);
    before = await figureHash(page);
    await page.getByTestId("sm-finish-metallic").click();
    if (!(await changedFrom(page, before))) fail("the Metallic finish changed nothing");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), page.getByTestId("sm-png-4").click()]);
    const file = await download.path();
    const png = fs.readFileSync(file);
    if (png.readUInt32BE(0) !== 0x89504e47) fail("the PNG download isn't a PNG");
    else {
      const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      if (w % 4 || h % 4 || w < 200) fail(`the 4× PNG has an odd size (${w}×${h})`);
    }
    if (!/\.png$/.test(download.suggestedFilename())) fail(`download name ${download.suggestedFilename()}`);
    await page.getByTestId("sm-drawer-close").click();

    // HD, where WebGL 2 is available (Charizard has HD).
    const gl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    if (gl2) {
      await page.getByTestId("sm-pokemon").click();
      await page.getByTestId("sm-picker-search").fill("charizard");
      await page.getByTestId("sm-pick-6").click();
      await page.getByTestId("sm-pokemon").filter({ hasText: "Charizard" }).waitFor({ timeout: 15_000 });
      await page.getByTestId("sm-more").click();
      await page.locator('[data-testid="sm-style"] [data-value="hd"]').click();
      await page.getByTestId("sm-drawer-close").click();
      if (!(await page.getByTestId("sm-hd-canvas").waitFor({ timeout: 30_000 }).then(() => true, () => false))) fail("HD didn't draw for Charizard");
      else {
        await page.waitForTimeout(2_000);
        await shot(page, `${OUT}/shiny-maker-hd.png`, errors);
      }
    }

    // The preview card.
    const og = await page.request.get(`${BASE}/tools/shiny-maker/og?d=${link.split("d=")[1] ?? ""}`);
    const ogBody = await og.body();
    if (!og.ok() || ogBody.readUInt32BE(0) !== 0x89504e47 || ogBody.readUInt32BE(16) !== 1200 || ogBody.readUInt32BE(20) !== 630) fail("the preview card isn't a 1200×630 PNG");
    else fs.writeFileSync(`${OUT}/shiny-maker-card.png`, ogBody);
  } catch (e) {
    fail(`stopped: ${e.message.split("\n")[0]}`);
  }

  // Phone: 390 × 844.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await phone.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const p = await phone.newPage();
  p.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
  try {
    await p.goto(`${BASE}/tools/shiny-maker`, { waitUntil: "load" });
    await p.getByTestId("sm-canvas").waitFor({ timeout: 30_000 });
    await p.waitForTimeout(500);
    const layout = await p.evaluate(() => {
      const root = document.querySelector('[data-testid="shiny-maker"]');
      const small = [], tiny = [];
      for (const el of root.querySelectorAll("button, [role=slider], input, a")) {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === "hidden") continue;
        if (el.closest(".sm-noscroll") && (r.right < 0 || r.left > innerWidth)) continue;
        if (r.height < 40 || r.width < 40) small.push(`${el.dataset.testid ?? el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 20)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      for (const el of root.querySelectorAll("button, span, p, h1, h2, label")) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) tiny.push(`${el.textContent.trim().slice(0, 20)} ${fs}px`);
      }
      return { scroll: document.documentElement.scrollWidth - innerWidth, small, tiny };
    });
    if (layout.scroll > 0) fail(`phone: the page scrolls sideways by ${layout.scroll}px`);
    if (layout.small.length) fail(`phone: controls under 40px: ${layout.small.slice(0, 6).join(", ")}`);
    if (layout.tiny.length) fail(`phone: text under 12px: ${layout.tiny.slice(0, 6).join(", ")}`);
    await shot(p, `${OUT}/shiny-maker-phone.png`, errors);
    await p.getByTestId("sm-part-0").click();
    const sheet = p.getByTestId("sm-sheet");
    await sheet.waitFor({ timeout: 5_000 }).catch(() => fail("phone: a part chip didn't open the colour sheet"));
    // Let the sheet slide in and the Pokémon step back.
    await p.waitForTimeout(700);
    const geo = await p.evaluate(() => {
      const s = document.querySelector('[data-testid="sm-sheet"]').getBoundingClientRect();
      const bar = document.querySelector('[data-testid="tabbar"]')?.getBoundingClientRect();
      const fig = document.querySelector('[data-testid="sm-canvas"]').getBoundingClientRect();
      return { sheetBottom: s.bottom, sheetTop: s.top, barTop: bar?.top ?? innerHeight, figBottom: fig.bottom, figTop: fig.top };
    });
    if (geo.sheetBottom > geo.barTop + 1) fail(`phone: the colour sheet goes under the tab bar (${Math.round(geo.sheetBottom)} > ${Math.round(geo.barTop)})`);
    const geo2 = await p.evaluate(() => document.querySelector('[data-testid="sm-canvas"]').getBoundingClientRect().bottom);
    if (geo2 > geo.sheetTop + 4) fail("phone: the colour sheet covers the Pokémon");
    await shot(p, `${OUT}/shiny-maker-phone-sheet.png`, errors);
    await p.getByTestId("sm-sheet-close").click();
  } catch (e) {
    fail(`phone: stopped: ${e.message.split("\n")[0]}`);
  }
  await phone.close();
  await context.close();
  for (const e of consoleErrors) fail(`console: ${e.slice(0, 200)}`);
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runShinyMaker({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ shiny maker passed");
}
