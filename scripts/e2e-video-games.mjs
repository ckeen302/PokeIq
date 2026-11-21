/**
 * The Pokédex's Games tab, end to end: the tab opens the list, every box art
 * loads and no cover is cut off by its card (at desktop, tablet and phone
 * widths), the kind chips, generation picker and sort filter the grid and go
 * in the URL (and a shared link's filter is applied on load), a game page
 * opens with its hero, facts, JSON-LD and back link, and a Pokémon on it
 * lands on its Pokédex entry. Fails on any console error. Run alone:
 *
 *   node scripts/e2e-video-games.mjs http://localhost:3000
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { openDexSection } from "./e2e-dex-menu.mjs";

async function ldTypes(page) {
  return page.$$eval('script[type="application/ld+json"]', (els) => els.flatMap((e) => [JSON.parse(e.textContent ?? "{}")].flat().map((x) => x["@type"])));
}

/** Scrolls every cover into view (they load lazily) and returns the ones that didn't load. */
async function brokenCovers(page) {
  for (const img of await page.locator('[data-testid="game-cover"] img').all()) await img.scrollIntoViewIfNeeded();
  const broken = await page.$$eval('[data-testid="game-cover"] img', (imgs) =>
    Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? null
          : new Promise((r) => {
              img.onload = () => r(null);
              img.onerror = () => r(img.getAttribute("src"));
              setTimeout(() => r(img.complete && img.naturalWidth > 0 ? null : img.getAttribute("src")), 8000);
            })
      )
    ).then((l) => l.filter(Boolean))
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  return broken;
}

/**
 * Runs in the page: every cover's drawn picture (object-fit: contain inside
 * its rotated box) must sit inside its frame, and the frame inside its card.
 * Returns the slugs of the cards where a picture is cut off.
 */
function clippedCovers() {
  const out = [];
  for (const card of document.querySelectorAll('[data-testid="games-card"]')) {
    const frame = card.querySelector('[data-testid="game-cover"]');
    if (!frame) continue;
    const f = frame.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const bad = [];
    if (f.left < c.left - 0.5 || f.right > c.right + 0.5 || f.top < c.top - 0.5 || f.bottom > c.bottom + 0.5) bad.push("frame outside its card");
    for (const el of frame.querySelectorAll('[data-testid="game-cover-img"]')) {
      // A turned box's bounding rectangle holds the whole box, and object-fit: contain draws the picture inside the box: so this is an outer bound.
      const r = el.getBoundingClientRect();
      if (r.left < f.left - 0.5 || r.right > f.right + 0.5 || r.top < f.top - 0.5 || r.bottom > f.bottom + 0.5) bad.push(`${el.getAttribute("src") ?? "tile"} outside its frame`);
    }
    if (bad.length) out.push(`${card.getAttribute("data-slug")}: ${bad.join(", ")}`);
  }
  return out;
}

/** The kinds and generations of the cards showing, in order. */
async function shownCards(page) {
  return page.$$eval('[data-testid="games-grid"] [data-testid="games-card"]', (els) => els.map((e) => e.getAttribute("data-slug")));
}

export async function runVideoGames({ browser, BASE, errors, step }) {
  step("pokédex Games tab: box art (never cut off), kind / generation / sort in the URL, a game page, a Pokémon's entry");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  try {
    await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    await openDexSection(page, "games");
    await page.waitForURL(/\/pokedex\/games$/);
    await page.getByTestId("games-grid").waitFor();
    if ((await page.getByTestId("dex-tab-games").getAttribute("aria-current")) !== "page") errors.push("games: the Games tab isn't marked current on its page");

    const all = await shownCards(page);
    if (all.length < 60) errors.push(`games: the list shows only ${all.length} games`);
    if (all.at(-1) !== "red-blue") errors.push(`games: newest first should end with Red & Blue, ends with ${all.at(-1)}`);
    const broken = await brokenCovers(page);
    if (broken.length) errors.push(`games: box art didn't load: ${broken.join(", ")}`);

    // Six cards a row at 1440 (the 1152px content width), and no cover cut off at any width.
    const tops = await page.$$eval('[data-testid="games-grid"] > li', (els) => els.slice(0, 7).map((e) => Math.round(e.getBoundingClientRect().top)));
    if (tops.slice(0, 6).some((t) => t !== tops[0]) || tops[6] === tops[0]) errors.push(`games: expected 6 cards a row at 1440, rows start at ${tops.join(",")}`);
    for (const width of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const clipped = await page.evaluate(clippedCovers);
      if (clipped.length) errors.push(`games at ${width}px: box art cut off: ${clipped.slice(0, 5).join(" | ")}`);
      if (width === 390) {
        const cols = await page.$$eval('[data-testid="games-grid"] > li', (els) => new Set(els.slice(0, 4).map((e) => Math.round(e.getBoundingClientRect().top))).size);
        if (cols !== 2) errors.push(`games: expected 2 cards a row on a phone (${cols} rows in the first 4 cards)`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // A kind chip narrows the grid and goes in the URL.
    await page.getByTestId("games-kind-remake").click();
    await page.waitForURL(/\?kind=remake$/);
    const remakes = await shownCards(page);
    if (!remakes.length || remakes.some((s) => !/firered|heartgold|omega-ruby|lets-go|brilliant/.test(s))) errors.push(`games: Remakes shows ${remakes.join(", ")}`);
    if ((await page.getByTestId("games-kind-tag").allTextContents()).some((t) => t.trim().toLowerCase() !== "remake")) errors.push("games: a non-remake tag under the Remakes chip");

    // Generation and sort too, all three in the URL.
    await page.getByTestId("games-kind-mainline").click();
    await page.getByTestId("games-gen").selectOption("1");
    await page.getByTestId("games-sort").selectOption("oldest");
    await page.waitForURL(/\?kind=mainline&gen=1&sort=oldest$/);
    const gen1 = await shownCards(page);
    if (gen1.join(",") !== "red-blue,yellow") errors.push(`games: Gen 1 mainline, oldest first, shows ${gen1.join(", ")}`);

    // A shared link's filter is applied on load.
    await page.goto(`${BASE}/pokedex/games?kind=spinoff&gen=3&sort=oldest`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector('[data-testid="games-gen"]')?.value === "3");
    const shared = await shownCards(page);
    if (shared[0] !== "pinball-ruby-sapphire" && shared[0] !== "channel") errors.push(`games: ?kind=spinoff&gen=3&sort=oldest starts with ${shared[0]}`);
    if ((await page.getByTestId("games-kind-spinoff").getAttribute("aria-pressed")) !== "true") errors.push("games: the shared link's kind chip isn't pressed");

    // A game page: hero, facts, links that exist, JSON-LD, back to the list.
    await page.goto(`${BASE}/pokedex/games`, { waitUntil: "load" });
    await page.locator('[data-testid="games-card"][data-slug="scarlet-violet"]').click();
    await page.waitForURL(/\/pokedex\/games\/scarlet-violet$/);
    await page.getByTestId("game-hero").waitFor();
    if (!/Scarlet/.test((await page.locator("h1").textContent()) ?? "")) errors.push("games: Scarlet & Violet's page has no title");
    if ((await page.getByTestId("game-hero").locator('[data-testid="game-cover-img"]').count()) !== 2) errors.push("games: Scarlet & Violet's hero should show both covers");
    const facts = (await page.getByTestId("game-facts").textContent()) ?? "";
    for (const k of ["Released", "Platform", "Region", "Developer"]) if (!facts.includes(k)) errors.push(`games: Scarlet & Violet's facts have no ${k}`);
    if (await brokenCovers(page).then((b) => b.length)) errors.push("games: Scarlet & Violet's covers didn't load");
    const types = await ldTypes(page);
    for (const t of ["BreadcrumbList", "VideoGame"]) if (!types.includes(t)) errors.push(`games: Scarlet & Violet's page has no ${t} JSON-LD`);
    for (const [id, re] of [["game-places-link", /\/pokedex\/places\?region=Paldea$/], ["game-trainers-link", /\/pokedex\/trainers\/scarlet-violet$/]]) {
      const href = await page.getByTestId(id).getAttribute("href");
      if (!href || !re.test(href)) errors.push(`games: ${id} goes to ${href}`);
    }
    for (const id of ["game-new", "game-starters", "game-legendaries", "game-exclusives", "game-dlc", "game-related"]) {
      if (!(await page.getByTestId(id).count())) errors.push(`games: Scarlet & Violet's page has no ${id}`);
    }

    // A starter lands on its Pokédex entry.
    await page.getByTestId("game-starters").locator('a[href="/pokemon/sprigatito"]').click();
    await page.waitForURL(/\/pokemon\/sprigatito$/);
    await page.getByRole("heading", { name: /Sprigatito/i }).first().waitFor();

    // "← All games" goes back; a spin-off page (no map, no starters) still renders.
    await page.goto(`${BASE}/pokedex/games/new-pokemon-snap`, { waitUntil: "load" });
    await page.getByTestId("game-hero").waitFor();
    if (await page.getByTestId("game-starters").count()) errors.push("games: New Pokémon Snap shows starters");
    await page.getByRole("link", { name: /All games/ }).first().click();
    await page.waitForURL(/\/pokedex\/games$/);
  } catch (e) {
    errors.push(`games: ${e.message.split("\n")[0]}`);
  }
  await context.close();
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runVideoGames({ browser, BASE, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("games tab OK");
}
