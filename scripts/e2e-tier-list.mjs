/**
 * The Pokémon Tier List Maker, end to end in the browser: its card on /tools and its front page, then each mode on
 * a template. Tier List: drag into a tier, select and press a number, shift-click several, double-click back to the
 * pool, undo and redo, rename and add a tier, the autosave across a reload, a share link that rebuilds the exact
 * list (with its own preview card) and a PNG download. Bracket: setup, picks by click and by arrow key, undo, the
 * champion, the full bracket. Top 10: a shorter list, reorder, a caption. Blind Ranking: a seeded run, then a
 * friend's challenge from its link, played to the side-by-side result. Then no sideways scroll at 1440, 1024, 390 and
 * 360, a replay video, and the frame rate with every Pokémon and form loaded. Each part records a failure instead of
 * stopping the rest. Screenshots are best effort.
 *
 *   node scripts/e2e-tier-list.mjs [baseUrl]       (or from e2e-smoke.mjs; E2E_ONLY=tier-list runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

async function shot(page, path) {
  await page.screenshot({ path }).catch((e) => console.log(`  (screenshot skipped: ${e.message.split("\n")[0]})`));
}

/** A tile of the pool that is on screen (the pool is virtualised: tiles above or below the view are not clickable). */
const poolTile = (page, key) => page.getByTestId("pool-grid").locator(`[data-tile="${key}"]`);

/** The keys in each tier, top to bottom. */
const tiers = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-testid="tier-row"]')].map((r) => [...r.querySelectorAll('[data-testid="tier-items"] [data-tile]')].map((t) => t.dataset.tile)));

async function drag(page, from, to, at = "middle") {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
  await page.mouse.move(at === "before" ? b.x + b.width * 0.2 : b.x + Math.min(40, b.width / 2), b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
}

async function newContext(browser, BASE, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  return context;
}

function watch(page, consoleErrors) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

async function ready(page) {
  await page.getByTestId("tier-list-app").waitFor({ timeout: 45_000 });
  await page.getByTestId("pool-grid").locator("[data-tile]").first().waitFor({ timeout: 30_000 });
}

export async function runTierList({ browser, BASE, OUT = "e2e-screenshots", errors, step }) {
  step("Pokémon Tier List Maker");
  const consoleErrors = [];
  const fail = (msg) => errors.push(`tier list: ${msg}`);
  const context = await newContext(browser, BASE);
  const page = await context.newPage();
  watch(page, consoleErrors);
  let shareLink = null;

  // ---- The card on /tools, the front page and a template.
  try {
    await page.goto(`${BASE}/tools`, { waitUntil: "load" });
    const card = page.getByTestId("tool-card-tier-list");
    await card.waitFor({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/tools\/tier-list$/, { timeout: 15_000 });
    if ((await page.locator("h1").first().innerText()).trim() !== "Pokémon Tier List Maker") fail("the front page's H1 is wrong");
    const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    if (!ld.some((s) => s.includes('"WebApplication"') && s.includes("Tier List Maker"))) fail("the front page has no WebApplication JSON-LD");
    await shot(page, `${OUT}/tier-list-home.png`);
    await page.getByTestId("template-starters").click();
    await page.waitForURL(/\/tools\/tier-list\/starters/, { timeout: 15_000 });
    await ready(page);
    if (!/Pokémon Starters Tier List Maker/.test(await page.title())) fail(`the Starters page's title is "${await page.title()}"`);
    if ((await page.locator("h1").first().innerText()).trim() !== "Pokémon Starters Tier List Maker") fail("the Starters page's H1 is wrong");
    const canonical = await page.evaluate(() => [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href")));
    if (!canonical.some((c) => c?.endsWith("/tools/tier-list/starters"))) fail(`the Starters page's canonical is ${canonical.join()}`);
  } catch (e) {
    fail(`front page: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- Tier List.
  try {
    step("tier list: drag, keys, multi-select, undo, autosave");
    await drag(page, poolTile(page, "bulbasaur"), page.locator('[data-row="t0"] [data-testid="tier-items"]'));
    let t = await tiers(page);
    if (!t[0].includes("bulbasaur")) fail("dragging Bulbasaur into S didn't place it");
    // Drop before Bulbasaur: the order inside a tier follows the drop point.
    await drag(page, poolTile(page, "charmander"), page.locator('[data-row="t0"] [data-tile="bulbasaur"]'), "before");
    t = await tiers(page);
    if (t[0].join() !== "charmander,bulbasaur") fail(`dropping before a tile gave S = ${t[0].join()}`);
    // Select, then a number key.
    await poolTile(page, "squirtle").click();
    await page.keyboard.press("2");
    // Shift-click several, then 3.
    await poolTile(page, "chikorita").click();
    await poolTile(page, "cyndaquil").click({ modifiers: ["Shift"] });
    await poolTile(page, "totodile").click({ modifiers: ["Shift"] });
    await page.keyboard.press("3");
    t = await tiers(page);
    if (t[1].join() !== "squirtle") fail(`pressing 2 gave A = ${t[1].join()}`);
    if (t[2].join() !== "chikorita,cyndaquil,totodile") fail(`shift-click and 3 gave B = ${t[2].join()}`);
    if ((await poolTile(page, "squirtle").count()) > 0) fail("a placed Pokémon is still in the pool");
    // Double-click sends one back; Backspace sends the selection back.
    await page.locator('[data-row="t2"] [data-tile="totodile"]').dblclick();
    await page.locator('[data-row="t2"] [data-tile="cyndaquil"]').click();
    await page.keyboard.press("Backspace");
    t = await tiers(page);
    if (t[2].join() !== "chikorita") fail(`double-click and Backspace left B = ${t[2].join()}`);
    // Undo and redo, by keyboard.
    await page.keyboard.press("Control+z");
    t = await tiers(page);
    if (t[2].join() !== "chikorita,cyndaquil") fail(`undo gave B = ${t[2].join()}`);
    await page.keyboard.press("Control+Shift+z");
    t = await tiers(page);
    if (t[2].join() !== "chikorita") fail(`redo gave B = ${t[2].join()}`);
    // Rename a tier and add one.
    await page.locator('[data-row="t5"] [data-testid="tier-settings"]').click();
    await page.getByTestId("tier-name").fill("Never");
    await page.getByTestId("tier-colour").nth(7).click();
    await page.getByTestId("tier-editor").getByRole("button", { name: "Done" }).click();
    await page.getByTestId("tier-editor").waitFor({ state: "hidden", timeout: 3_000 }).catch(() => fail("the tier editor didn't close"));
    if ((await page.locator('[data-row="t5"] [data-testid="tier-label"] span').first().innerText()).trim() !== "Never") fail("renaming F didn't show");
    await page.getByTestId("tier-add-row").click();
    if ((await page.getByTestId("tier-row").count()) !== 7) fail("Add a tier didn't add one");
    // Pixel art and shiny.
    await page.getByTestId("art-pixel").click();
    await page.getByTestId("shiny-toggle").click();
    const src = await page.locator('[data-row="t0"] [data-tile="charmander"] img').getAttribute("src");
    if (!/sprites\/pokemon\/shiny\/4\.png$/.test(src ?? "")) fail(`Pixel + Shiny didn't switch the picture (${src})`);
    await page.getByTestId("art-hd").click();
    await page.getByTestId("shiny-toggle").click();
    // Search by number and by name, with a filter.
    await page.getByTestId("pool-search").fill("387");
    if ((await page.getByTestId("pool-grid").locator("[data-tile]").count()) !== 1 || !(await poolTile(page, "turtwig").count())) fail("searching 387 didn't find Turtwig alone");
    await page.getByTestId("pool-search").fill("pip");
    if (!(await poolTile(page, "piplup").count())) fail("searching pip didn't find Piplup");
    await page.getByTestId("pool-search").fill("");
    await page.getByTestId("pool-filters").click();
    await page.getByTestId("pool-filter-row").locator("select").nth(1).selectOption("fire");
    const fire = await page.getByTestId("pool-grid").locator("[data-tile]").evaluateAll((els) => els.map((e) => e.dataset.tile));
    if (!fire.length || fire.includes("treecko")) fail("the Fire type filter let a Grass starter through");
    await page.getByTestId("pool-filter-row").locator("select").nth(1).selectOption("");
    await page.getByTestId("pool-filters").click();
    await shot(page, `${OUT}/tier-list-desktop.png`);
    // Autosave: the same list after a reload.
    const before = await tiers(page);
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "load" });
    await ready(page);
    const after = await tiers(page);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail(`the list didn't survive a reload (${JSON.stringify(after)})`);

    step("tier list: share link and PNG");
    await page.getByTestId("share").click();
    shareLink = await page.getByTestId("share-url").inputValue();
    await page.getByTestId("share-copy").click();
    await page.keyboard.press("Escape");
    if (!/\/tools\/tier-list\/starters\?s=/.test(shareLink)) fail(`the share link looks wrong: ${shareLink}`);
    const other = await newContext(browser, BASE);
    const p2 = await other.newPage();
    watch(p2, consoleErrors);
    await p2.goto(shareLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
    await ready(p2);
    const shared = await tiers(p2);
    if (JSON.stringify(shared) !== JSON.stringify(after)) fail(`the share link rebuilt ${JSON.stringify(shared)} instead of ${JSON.stringify(after)}`);
    if (!(await p2.getByTestId("shared-banner").count())) fail("a shared list doesn't say it's shared");
    const og = await p2.locator('meta[property="og:image"]').getAttribute("content");
    if (!og?.includes("/tools/tier-list/starters/og?s=")) fail(`the share link's preview card is ${og}`);
    else {
      const r = await p2.request.get(og.replace(/^https?:\/\/[^/]+/, BASE));
      if (r.status() !== 200 || !(r.headers()["content-type"] ?? "").includes("image/png")) fail(`the preview card answered ${r.status()} ${r.headers()["content-type"]}`);
    }
    if ((await p2.locator('meta[name="robots"]').getAttribute("content"))?.includes("noindex") !== true) fail("a shared link isn't kept out of search results");
    await other.close();
    // A PNG download.
    await page.getByTestId("export").click();
    await page.getByTestId("export-png").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="export-preview"]')?.width > 0, null, { timeout: 20_000 });
    for (const aspect of ["square", "vertical", "wide"]) {
      await page.getByTestId(`export-aspect-${aspect}`).click();
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), page.getByTestId("export-png").click()]);
      const path = await dl.path();
      const buf = path ? fs.readFileSync(path) : Buffer.alloc(0);
      if (buf.length < 20_000 || buf.toString("ascii", 1, 4) !== "PNG") fail(`the ${aspect} PNG is ${buf.length} bytes`);
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      const want = { square: [1080, 1080], vertical: [1080, 1920], wide: [1920, 1080] }[aspect];
      if (w !== want[0] || h !== want[1]) fail(`the ${aspect} PNG is ${w}×${h}`);
    }
    await shot(page, `${OUT}/tier-list-export.png`);
    // The replay video (a short list makes a short video).
    await page.getByTestId("export-video").click();
    await page.getByTestId("export-video-ready").waitFor({ timeout: 120_000 }).catch(() => fail("the replay video didn't finish"));
    await page.keyboard.press("Escape");
  } catch (e) {
    fail(`tier list: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- Bracket.
  try {
    step("bracket: setup, picks, undo, champion, full view");
    await page.getByTestId("mode-bracket").click();
    await page.getByTestId("bracket-size-8").click();
    await page.getByTestId("bracket-seeding-bst").click();
    await page.getByTestId("bracket-start").click();
    await page.getByTestId("bracket-matchup").waitFor();
    if (!(await page.getByTestId("bracket-progress").innerText()).includes("1 of 4")) fail("the first round doesn't start at 1 of 4");
    await page.getByTestId("bracket-pick-a").click();
    await page.keyboard.press("ArrowRight");
    await page.getByTestId("bracket-undo").click();
    if (!(await page.getByTestId("bracket-progress").innerText()).includes("2 of 4")) fail("undo didn't go back one pick");
    for (let i = 0; i < 6; i++) await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
    await page.getByTestId("bracket-champion").waitFor({ timeout: 5_000 });
    const champ = (await page.getByTestId("bracket-champion-name").innerText()).trim();
    if (!champ) fail("the champion has no name");
    await shot(page, `${OUT}/tier-list-bracket-champion.png`);
    await page.getByTestId("bracket-view").click();
    await page.getByTestId("bracket-canvas").waitFor();
    await page.waitForTimeout(800);
    await shot(page, `${OUT}/tier-list-bracket-full.png`);
    await page.getByTestId("bracket-back").click();
  } catch (e) {
    fail(`bracket: stopped: ${e.message.split("\n")[0]}`);
  }

/** The top list's keys, #1 first (the podium shows #2, #1, #3 left to right). */
const topKeys = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="top-slot"]')]
      .sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank))
      .map((el) => el.querySelector("[data-tile]")?.dataset.tile)
      .filter(Boolean)
  );

  // ---- Top 10.
  try {
    step("top list: length, picks, reorder, caption");
    await page.getByTestId("mode-top").click();
    await page.getByTestId("top-length-5").click();
    for (const k of ["piplup", "rowlet", "litten", "popplio", "sobble", "fuecoco"]) if (await poolTile(page, k).count()) await poolTile(page, k).click();
    const filled = await topKeys(page);
    if (filled.length !== 5) fail(`a top 5 holds ${filled.length}`);
    if (filled[0] !== "piplup") fail(`#1 is ${filled[0]}, not the first pick`);
    await page.getByRole("button", { name: /Move Sobble up/ }).click();
    const reordered = await topKeys(page);
    if (reordered[3] !== "sobble") fail(`moving Sobble up gave ${reordered.join()}`);
    await page.getByTestId("top-caption").first().fill("The best one");
    await shot(page, `${OUT}/tier-list-top.png`);
  } catch (e) {
    fail(`top list: stopped: ${e.message.split("\n")[0]}`);
  }

  // ---- Blind Ranking, and a friend's challenge.
  try {
    step("blind ranking: a run and a friend's challenge");
    await page.getByTestId("mode-blind").click();
    await page.getByTestId("blind-length-5").click();
    await page.getByTestId("blind-start").click();
    const seen = [];
    for (const n of [3, 1, 5, 2, 4]) {
      await page.getByTestId("blind-name").filter({ hasText: /\S/ }).waitFor({ timeout: 5_000 });
      seen.push((await page.getByTestId("blind-name").innerText()).trim());
      await page.waitForTimeout(350);
      await page.keyboard.press(String(n));
    }
    await page.getByTestId("blind-result").waitFor({ timeout: 5_000 });
    await shot(page, `${OUT}/tier-list-blind.png`);
    await page.getByTestId("blind-name-input").fill("Ash");
    await page.getByTestId("blind-challenge").click();
    const link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (!link || !link.includes("?s=")) fail("Challenge a friend didn't copy a link");
    else {
      const friend = await newContext(browser, BASE);
      const f = await friend.newPage();
      watch(f, consoleErrors);
      await f.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
      await f.getByTestId("blind-challenge-intro").waitFor({ timeout: 45_000 });
      if (!(await f.getByTestId("blind-challenge-intro").innerText()).includes("Ash")) fail("the challenge doesn't name its sender");
      await f.getByTestId("blind-accept").click();
      await f.getByTestId("blind-start").click();
      const theirs = [];
      for (const n of [1, 2, 3, 4, 5]) {
        await f.getByTestId("blind-name").filter({ hasText: /\S/ }).waitFor({ timeout: 5_000 });
        theirs.push((await f.getByTestId("blind-name").innerText()).trim());
        await f.waitForTimeout(350);
        await f.keyboard.press(String(n));
      }
      if (theirs.join() !== seen.join()) fail(`the challenge drew ${theirs.join()} instead of ${seen.join()}`);
      await f.getByTestId("blind-compare").waitFor({ timeout: 5_000 }).catch(() => fail("the friend's result doesn't show both lists"));
      // Their result link shows both too.
      await f.getByTestId("share").click();
      const back = await f.getByTestId("share-url").inputValue();
      const g = await friend.newPage();
      await g.goto(back.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "load" });
      await g.getByTestId("blind-compare").waitFor({ timeout: 45_000 }).catch(() => fail("the friend's result link doesn't show both lists"));
      await shot(g, `${OUT}/tier-list-blind-compare.png`);
      await friend.close();
    }
  } catch (e) {
    fail(`blind ranking: stopped: ${e.message.split("\n")[0]}`);
  }
  await context.close();

  // ---- No sideways scroll, every mode, at four widths.
  step("tier list: no sideways scroll at 1440, 1024, 390 and 360");
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844], [360, 740]]) {
    const ctx = await newContext(browser, BASE, { width: w, height: h });
    const p = await ctx.newPage();
    watch(p, consoleErrors);
    try {
      await p.goto(`${BASE}/tools/tier-list`, { waitUntil: "load" });
      let sw = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sw > 0) fail(`${w}px: the front page scrolls sideways by ${sw}px`);
      await p.goto(`${BASE}/tools/tier-list/starters`, { waitUntil: "load" });
      await ready(p);
      for (const mode of ["tier", "bracket", "top", "blind"]) {
        await p.getByTestId(`mode-${mode}`).click();
        await p.waitForTimeout(250);
        sw = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sw > 0) fail(`${w}px: ${mode} scrolls sideways by ${sw}px`);
        if (w <= 390) await shot(p, `${OUT}/tier-list-${mode}-${w}.png`);
      }
      if (w <= 390) {
        // Tap a tile, then tap a tier.
        await p.getByTestId("mode-tier").click();
        await poolTile(p, "bulbasaur").click();
        await p.locator('[data-row="t0"] [data-testid="tier-label"]').click();
        if (!(await tiers(p))[0].includes("bulbasaur")) fail(`${w}px: tap then tap didn't place a tile`);
        const box = await p.getByTestId("tl-pool-panel").boundingBox();
        const bar = await p.getByTestId("tabbar").boundingBox().catch(() => null);
        if (box && bar && box.y + box.height > bar.y + 1) fail(`${w}px: the pool goes under the tab bar`);
      }
    } catch (e) {
      fail(`${w}px: stopped: ${e.message.split("\n")[0]}`);
    }
    await ctx.close();
  }

  // ---- Performance: every Pokémon and form in the pool.
  step("tier list: frame rate with every Pokémon and form");
  {
    const ctx = await newContext(browser, BASE);
    const p = await ctx.newPage();
    watch(p, consoleErrors);
    try {
      await p.goto(`${BASE}/tools/tier-list/every-form`, { waitUntil: "load" });
      await ready(p);
      const inDom = await p.getByTestId("pool-grid").locator("[data-tile]").count();
      if (inDom > 200) fail(`the pool isn't virtualised (${inDom} tiles in the page)`);
      const fps = async (fn) => {
        await p.evaluate(() => {
          window.__f = [];
          window.__stop = false;
          const loop = (t) => (window.__f.push(t), !window.__stop && requestAnimationFrame(loop));
          requestAnimationFrame(loop);
        });
        await fn();
        return p.evaluate(() => {
          window.__stop = true;
          const f = window.__f;
          const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
          return { avg: 1000 / (d.reduce((a, b) => a + b, 0) / d.length), p95: d[Math.floor(d.length * 0.95)] };
        });
      };
      const grid = await p.getByTestId("pool-grid").boundingBox();
      await p.mouse.move(grid.x + grid.width / 2, grid.y + 120);
      const scroll = await fps(async () => {
        for (let i = 0; i < 50; i++) {
          await p.mouse.wheel(0, 260);
          await p.waitForTimeout(16);
        }
      });
      const first = p.getByTestId("pool-grid").locator("[data-tile]").first();
      await p.getByTestId("pool-grid").evaluate((el) => (el.scrollTop = 0));
      await p.waitForTimeout(200);
      const dragged = await fps(() => drag(p, first, p.locator('[data-row="t1"] [data-testid="tier-items"]')));
      console.log(`  scroll ${scroll.avg.toFixed(0)} fps (p95 ${scroll.p95.toFixed(1)} ms), drag ${dragged.avg.toFixed(0)} fps (p95 ${dragged.p95.toFixed(1)} ms)`);
      if (scroll.avg < 45) fail(`scrolling every Pokémon runs at ${scroll.avg.toFixed(0)} fps`);
      if (dragged.avg < 45) fail(`dragging with every Pokémon loaded runs at ${dragged.avg.toFixed(0)} fps`);
      if (!(await tiers(p))[1].length) fail("the drag with every Pokémon loaded didn't place a tile");
    } catch (e) {
      fail(`performance: stopped: ${e.message.split("\n")[0]}`);
    }
    await ctx.close();
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
  await runTierList({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ tier list passed");
}
