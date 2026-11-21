/**
 * The Pokédex's Movies tab, end to end: the tab opens the list, every poster
 * loads, an era chip narrows the grid (and the era survives a reload from
 * the URL), a film page opens with its hero, JSON-LD and back link, and a
 * featured Pokémon links to its Pokédex entry. Fails on any console error.
 * Run alone:
 *
 *   node scripts/e2e-movies.mjs http://localhost:3000
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { openDexSection } from "./e2e-dex-menu.mjs";

async function ldTypes(page) {
  return page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => JSON.parse(e.textContent ?? "{}")["@type"]));
}

/** The cards still showing (an era filter hides the rest). */
async function visibleEras(page) {
  return page.$$eval('[data-testid="movie-grid"] > li:not([hidden]) [data-testid="movie-card"]', (els) => els.map((e) => e.getAttribute("data-era")));
}

export async function runMovies({ browser, BASE, errors, step }) {
  step("pokédex Movies tab: posters, an era filter (and its URL), a film page, a featured Pokémon's entry");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  try {
    await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    await openDexSection(page, "movies");
    await page.waitForURL(/\/pokedex\/movies$/);
    await page.getByTestId("movie-grid").waitFor();
    if ((await page.getByTestId("dex-tab-movies").getAttribute("aria-current")) !== "page") errors.push("movies: the Movies tab isn't marked current on its page");

    // Every poster loads (scrolled into view, as they load lazily).
    const cards = await page.getByTestId("movie-card").count();
    if (cards < 20) errors.push(`movies: the list shows ${cards} films`);
    for (const img of await page.getByTestId("movie-poster").all()) await img.scrollIntoViewIfNeeded();
    const broken = await page.$$eval('[data-testid="movie-poster"]', (imgs) =>
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
    if (broken.length) errors.push(`movies: posters didn't load: ${broken.join(", ")}`);
    await page.evaluate(() => window.scrollTo(0, 0));

    // An era chip narrows the grid and goes in the URL; "All" brings every film back.
    await page.getByTestId("movie-era-dp").click();
    await page.waitForURL(/\?era=dp$/);
    const dp = await visibleEras(page);
    if (!dp.length || dp.length >= cards || dp.some((e) => e !== "dp")) errors.push(`movies: the Diamond & Pearl chip shows ${dp.length} films (${[...new Set(dp)].join(", ")})`);
    await page.getByTestId("movie-era-all").click();
    await page.waitForURL(/\/pokedex\/movies$/);
    if ((await visibleEras(page)).length !== cards) errors.push("movies: All didn't bring every film back");
    // A shared link opens filtered.
    await page.goto(`${BASE}/pokedex/movies?era=live-action`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="movie-grid"] > li:not([hidden])').length === 1, null, { timeout: 10_000 }).catch(() => {});
    const live = await visibleEras(page);
    if (live.length !== 1 || live[0] !== "live-action") errors.push(`movies: ?era=live-action shows ${live.join(", ")}`);
    if ((await page.getByTestId("movie-era-live-action").getAttribute("aria-current")) !== "true") errors.push("movies: the live-action chip isn't marked when opened from the URL");

    // A film page: hero, label, JSON-LD, back link.
    await page.goto(`${BASE}/pokedex/movies?era=dp`, { waitUntil: "load" });
    await page.locator('[data-testid="movie-card"][href="/pokedex/movies/the-rise-of-darkrai"]').click();
    await page.waitForURL(/\/pokedex\/movies\/the-rise-of-darkrai$/);
    await page.getByTestId("movie-hero").waitFor();
    const hero = await page.getByTestId("movie-hero").innerText();
    if (!/Movie 10/i.test(hero) || !/Diamond & Pearl era/i.test(hero)) errors.push(`movies: Darkrai's hero reads "${hero.slice(0, 80)}"`);
    if (!/Alamos Town/.test(hero)) errors.push("movies: Darkrai's hero has no setting");
    const ok = await page.getByTestId("movie-hero-poster").evaluate((img) => img.complete && img.naturalWidth > 0);
    if (!ok) errors.push("movies: Darkrai's poster didn't load");
    const ld = await ldTypes(page);
    for (const t of ["BreadcrumbList", "Movie"]) if (!ld.includes(t)) errors.push(`movies: film page has no ${t} JSON-LD`);
    if ((await page.getByTestId("movie-character").count()) < 3) errors.push("movies: Darkrai lists too few characters");
    if (!(await page.locator('[data-testid="movie-related"] a[href="/pokedex/movies/giratina-and-the-sky-warrior"]').count())) errors.push("movies: Darkrai doesn't link the rest of its trilogy");
    if (!(await page.locator('a[data-back-button][href="/pokedex/movies"]').count())) errors.push("movies: film page has no back link to the list");
    if ((await page.getByTestId("dex-next").getAttribute("href")) !== "/pokedex/movies/giratina-and-the-sky-warrior") errors.push("movies: Darkrai's next film isn't Giratina");

    // A featured Pokémon lands on its Pokédex entry.
    await page.getByTestId("movie-featured").locator('a[href="/pokemon/darkrai"]').click();
    await page.waitForURL(/\/pokemon\/darkrai$/);
    await page.getByRole("heading", { name: /Darkrai/i }).first().waitFor();
  } catch (e) {
    errors.push(`movies: ${e.message.split("\n")[0]}`);
  }
  await context.close();
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runMovies({ browser, BASE, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("movies OK");
}
