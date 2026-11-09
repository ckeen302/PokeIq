/**
 * Pokémon rankings (/pokedex/rankings), end to end: the Pokédex's Rankings
 * link opens the hub, the hub opens a list, the list's table links to a
 * Pokémon entry; each page carries its canonical URL and its BreadcrumbList
 * and ItemList JSON-LD; a type variant ranks only that type; a 390 px phone
 * doesn't scroll sideways. Run alone:
 *
 *   node scripts/e2e-rankings.mjs http://localhost:3000
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";

async function ldTypes(page) {
  return page.$$eval('script[type="application/ld+json"]', (els) => els.map((e) => JSON.parse(e.textContent ?? "{}")["@type"]));
}

async function canonical(page) {
  return page.$eval('link[rel="canonical"]', (l) => new URL(l.href).pathname).catch(() => null);
}

export async function runRankings({ browser, BASE, errors, step }) {
  step("pokédex rankings: hub → list → entry, canonical, JSON-LD, a type list, phone width");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  try {
    await page.goto(`${BASE}/pokedex`, { waitUntil: "load" });
    await page.getByTestId("dex-rankings-link").click();
    await page.waitForURL(/\/pokedex\/rankings$/);
    await page.getByTestId("rankings-hub").waitFor();
    if ((await canonical(page)) !== "/pokedex/rankings") errors.push(`rankings: hub canonical is ${await canonical(page)}`);
    const hubLd = await ldTypes(page);
    for (const t of ["BreadcrumbList", "ItemList"]) if (!hubLd.includes(t)) errors.push(`rankings: hub has no ${t} JSON-LD`);

    await page.locator('[data-testid="hub-list-link"][href="/pokedex/rankings/heaviest"]').click();
    await page.waitForURL(/\/pokedex\/rankings\/heaviest$/);
    await page.getByTestId("ranking-table").waitFor();
    if ((await canonical(page)) !== "/pokedex/rankings/heaviest") errors.push(`rankings: heaviest canonical is ${await canonical(page)}`);
    const ld = await ldTypes(page);
    for (const t of ["BreadcrumbList", "ItemList"]) if (!ld.includes(t)) errors.push(`rankings: heaviest has no ${t} JSON-LD`);
    const h1 = (await page.locator("h1").innerText()).toLowerCase();
    if (!h1.includes("heaviest")) errors.push(`rankings: heaviest h1 reads "${h1}"`);
    // The page carries the top of the list; the rest comes in as the reader nears its end.
    const first = await page.locator('[data-testid="ranking-table"] tbody tr').count();
    if (first < 50 || first > 200) errors.push(`rankings: heaviest's page carries ${first} rows, expected the top of the list`);
    await page.getByTestId("ranking-more").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="ranking-table"] tbody tr').length >= 1000, null, { timeout: 15_000 }).catch(() => {});
    const rows = await page.locator('[data-testid="ranking-table"] tbody tr').count();
    if (rows < 1000) errors.push(`rankings: heaviest lists ${rows} rows once scrolled, expected every Pokémon`);
    if (await page.getByTestId("ranking-more").count()) errors.push(`rankings: the "Show the full list" button stays after the rest is in`);
    const rest = await page.request.get(`${BASE}/pokedex/rankings/heaviest/rows`);
    if (rest.status() !== 200 || !/noindex/i.test(rest.headers()["x-robots-tag"] ?? "")) errors.push(`rankings: heaviest/rows answers ${rest.status()} with X-Robots-Tag "${rest.headers()["x-robots-tag"]}"`);
    const explorer = await page.getByTestId("ranking-explorer-link").getAttribute("href");
    if (explorer !== "/pokedex?sort=weight") errors.push(`rankings: "Open in the Pokédex" goes to ${explorer}`);

    const top = page.locator('[data-testid="ranking-table"] tbody tr').first().locator('a[href^="/pokemon/"]');
    const href = await top.getAttribute("href");
    await page.evaluate(() => window.scrollTo(0, 0));
    await top.click();
    await page.waitForURL(new RegExp(`${href}$`));
    await page.locator("h1").first().waitFor();
    // The entry links back to its placing.
    await page.locator('[data-testid="dex-ranking-facts"] a[href^="/pokedex/rankings/heaviest#"]').first().waitFor({ state: "attached" });

    await page.goto(`${BASE}/pokedex/rankings/fastest/fire`, { waitUntil: "load" });
    if ((await canonical(page)) !== "/pokedex/rankings/fastest/fire") errors.push(`rankings: fastest/fire canonical is ${await canonical(page)}`);
    const nonFire = await page.$$eval('[data-testid="ranking-table"] tbody tr', (trs) => trs.filter((tr) => !/fire/i.test(tr.querySelector("td:nth-child(3)")?.textContent ?? "")).length);
    if (nonFire) errors.push(`rankings: fastest/fire lists ${nonFire} Pokémon without the Fire type`);
    const status = (await page.request.get(`${BASE}/pokedex/rankings/lightest/fire`)).status();
    if (status !== 404) errors.push(`rankings: an unbuilt variant answers ${status}, expected 404`);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/pokedex/rankings", "/pokedex/rankings/strongest"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "load" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) errors.push(`rankings: ${path} scrolls sideways at 390 px`);
    }
  } catch (e) {
    errors.push(`rankings: ${e.message}`);
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const errors = [];
  await runRankings({ browser, BASE, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("rankings e2e: ok");
}
