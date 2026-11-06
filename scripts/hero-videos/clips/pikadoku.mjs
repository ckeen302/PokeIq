/**
 * Pikadoku: the Normal daily of 2026-11-04, solved by the site's own solver
 * (scripts/pikadoku-solve.ts, as the e2e test does). Seven cells are filled
 * before the take; on camera the player fills the last two and the grid
 * completes.
 */
import { execFileSync } from "node:child_process";

const DATE = "2026-11-04";

export const setup = () => ({ time: new Date(`${DATE}T15:00:00-05:00`) });

export async function run(rec, { base, phone }) {
  const { solution } = JSON.parse(execFileSync("npx", ["tsx", "scripts/pikadoku-solve.ts", DATE, "normal"], { encoding: "utf8" }));
  // The last three on camera: a row's end, so the grid fills towards a corner.
  const order = [...solution].sort((a, b) => [0, 1, 3, 4, 6, 2, 5, 7, 8].indexOf(a.cell) - [0, 1, 3, 4, 6, 2, 5, 7, 8].indexOf(b.cell));
  const page = rec.page;
  await rec.goto(`${base}/pikadoku`);
  const howto = page.getByTestId("howto-never");
  if (await howto.isVisible().catch(() => false)) await howto.click();
  await page.getByTestId("pdk-cell-0").waitFor();
  await page.waitForTimeout(600);
  const play = async ({ cell, name, id }) => {
    await page.getByTestId(`pdk-cell-${cell}`).click();
    await page.getByTestId("pdk-search").fill(name);
    await page.getByTestId(`pdk-option-${id}`).click();
    await page.waitForTimeout(900);
  };
  for (const s of order.slice(0, 7)) await play(s);
  // Warm the picker's sprites for the three to come.
  for (const { cell, name } of order.slice(7)) {
    await page.getByTestId(`pdk-cell-${cell}`).click();
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId("pdk-search").fill(name.slice(0, i));
      await page.waitForTimeout(200);
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await page.mouse.move(5, 5);
  await rec.hideChrome();
  const grid = [page.locator('[role="grid"][aria-label="Pikadoku grid"]'), page.getByTestId("pdk-col-0")];
  const top = await page.getByTestId("pdk-cell-0").boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top.y - (phone ? 160 : 220)));
  await page.waitForTimeout(400);
  await rec.freeze();
  if (phone) await rec.frameAround(grid, { aspect: 4 / 5, pad: 10, top: true });
  else await rec.frameAround(grid, { aspect: 16 / 9, pad: 40, shiftY: 30 });
  rec.cursor.x = rec.clip.x + rec.clip.width * 0.8;
  rec.cursor.y = rec.clip.y + rec.clip.height * 0.9;
  rec.start();
  await rec.wait(phone ? 1300 : 150);
  for (const s of order.slice(7)) {
    await rec.clickEl(page.getByTestId(`pdk-cell-${s.cell}`), { jitter: 0.4 });
    await rec.until(() => !!document.querySelector("[data-testid=pdk-search]"));
    await rec.wait(250);
    if (phone) {
      await rec.clickEl(page.getByTestId("pdk-search"), { jitter: 0.3, dx: -60 });
      await rec.wait(150);
    }
    await rec.type(s.name.slice(0, Math.min(phone ? 4 : 5, s.name.length)), { cps: 10 });
    await rec.wait(250);
    await rec.clickEl(page.getByTestId(`pdk-option-${s.id}`), { jitter: 0.2 });
    await rec.wait(800);
  }
  await rec.moveTo(rec.clip.x + rec.clip.width * 0.85, rec.clip.y + rec.clip.height * 0.92, 800);
  await rec.wait(2200);
  rec.mark("out");
  await rec.stop();
}
