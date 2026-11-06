/**
 * PokéConnections: the daily of 2026-11-04, its groups from the committed
 * dailies file (as the e2e test reads them). One group is found before the
 * take; on camera the player picks four, submits, and the group locks in,
 * then a second.
 */
import fs from "node:fs";

const DATE = "2026-11-04";

export const setup = () => ({ time: new Date(`${DATE}T15:00:00-05:00`) });

function groups() {
  const d = JSON.parse(fs.readFileSync("src/data/connections-dailies.json", "utf8"));
  const day = Math.round((Date.parse(`${DATE}T00:00:00Z`) - Date.parse(`${d.start}T00:00:00Z`)) / 86_400_000);
  return d.puzzles[day].g.map(([, ...members]) => members);
}

export async function run(rec, { base, phone }) {
  const g = groups();
  const page = rec.page;
  await rec.goto(`${base}/connections`);
  const howto = page.getByTestId("howto-never");
  if (await howto.isVisible().catch(() => false)) await howto.click();
  await page.getByTestId("conn-tile").first().waitFor();
  await page.waitForTimeout(800);
  const tile = (id) => page.locator(`[data-testid=conn-tile][data-id="${id}"]`);
  // One group before the take.
  for (const id of g[1]) await tile(id).click();
  await page.getByTestId("conn-submit").click();
  await page.locator("[data-testid=conn-group]").first().waitFor();
  await page.waitForTimeout(2000);
  // Two of the next four already picked.
  for (const id of g[0].slice(0, 2)) await tile(id).click();
  await page.mouse.move(5, 5);
  await rec.hideChrome();
  const board = page.locator("[data-testid=conn-group], [data-testid=conn-tile]");
  const first = page.locator("[data-testid=conn-group]").first();
  const top = await first.boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top.y - (phone ? 90 : 120)));
  await page.waitForTimeout(400);
  await rec.freeze();
  const lastTile = page.getByTestId("conn-tile").last();
  const submit = page.getByTestId("conn-submit");
  if (phone) await rec.frameAround([first, lastTile, submit], { aspect: 4 / 5, pad: 14 });
  else await rec.frameAround([first, lastTile, submit], { aspect: 16 / 9, pad: 40, shiftY: 26 });
  rec.cursor.x = rec.clip.x + rec.clip.width * 0.8;
  rec.cursor.y = rec.clip.y + rec.clip.height * 0.9;
  rec.pace = 0.7;
  rec.start();
  await rec.wait(150);
  for (const [n, group] of [g[0], g[2]].entries()) {
    for (const id of n ? group : group.slice(2)) {
      await rec.clickEl(tile(id), { jitter: 0.5, before: 50 });
      await rec.wait(40 + rec.rand() * 90);
    }
    await rec.wait(200);
    await rec.clickEl(submit, { jitter: 0.3 });
    await rec.until((k) => document.querySelectorAll("[data-testid=conn-group]").length >= k, n + 2);
    await rec.moveTo(rec.cursor.x + (n ? -60 : 80), rec.cursor.y - 40, 700);
    await rec.wait(n ? 1300 : 300);
  }
  rec.mark("out");
  await rec.stop();
}
