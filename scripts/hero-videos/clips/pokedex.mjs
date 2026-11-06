/**
 * Pokédex: the grid scrolls down to Pikachu, a click opens its entry, then
 * down through its base stats to its evolution line.
 */
export const setup = () => ({});

export async function run(rec, { base, phone }) {
  const page = rec.page;
  const W = phone ? 390 : 1440;
  await rec.goto(`${base}/pokedex`);
  await rec.hideChrome("[data-testid=study-mode], a[href*='study'], button:has-text('Study mode') { visibility: hidden !important; }");
  // Warm the entry (its page and artwork) and the grid's first rows.
  await page.request.get(`${base}/pokemon/pikachu`);
  const card = page.locator('a[href="/pokemon/pikachu"]').first();
  const grid = page.locator('a[href="/pokemon/bulbasaur"]').first();
  await grid.waitFor();
  const gTop = (await grid.boundingBox()).y;
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, gTop - (phone ? 16 : 30)));
  await page.waitForTimeout(800);
  await page.mouse.move(5, 5);
  // Pre-load the rows we scroll through.
  await page.evaluate(() => window.scrollBy(0, 1400));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollBy(0, -1400));
  await page.waitForTimeout(800);
  await rec.freeze();
  rec.setClip(phone ? { x: 0, y: 0, width: 390, height: 487.5 } : { x: (W - 1184) / 2, y: 0, width: 1184, height: 666 });
  rec.cursor.x = rec.clip.x + rec.clip.width * 0.7;
  rec.cursor.y = rec.clip.y + rec.clip.height * 0.75;
  rec.start();
  await rec.wait(500);
  // Down to Pikachu's row.
  const cTop = (await card.boundingBox()).y;
  await rec.scrollBy(cTop - (phone ? 120 : 160), 1500);
  await rec.wait(250);
  await rec.clickEl(card, { jitter: 0.3, dy: -20 });
  // The entry loads over the network: the clock holds till it's in.
  for (let i = 0; i < 100 && !/\/pokemon\/pikachu$/.test(page.url()); i++) await rec.settle(100);
  await page.locator("#stats").waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => [...document.querySelectorAll("main img")].slice(0, 3).every((im) => im.complete))) break;
    await rec.settle(100);
  }
  await rec.wait(phone ? 1100 : 1300);
  const to = async (sel, off) => (await page.locator(sel).boundingBox()).y - off;
  await rec.moveTo(rec.clip.x + rec.clip.width * 0.85, rec.clip.y + rec.clip.height * 0.6, 600);
  await rec.scrollBy(await to("#stats", phone ? 10 : 20), 1100);
  await rec.wait(1500);
  await rec.scrollBy(await to("#evolution", phone ? 10 : 20), 1100);
  await rec.wait(1400);
  rec.mark("out");
  await rec.stop();
}
