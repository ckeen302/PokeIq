/**
 * Pokédle: the daily of 2026-11-04 (a past day, so no spoiler for today),
 * played by its own route (answers.ts): Pikachu and Garchomp are on the
 * board, then Talonflame narrows it and Meowscarada solves it.
 */
import { execFileSync } from "node:child_process";

const DATE = "2026-11-04";

export const setup = () => ({ time: new Date(`${DATE}T15:00:00-05:00`) });

function route() {
  const out = execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/hero-videos/answers.ts", "pokedle", DATE], { encoding: "utf8" });
  const r = JSON.parse(out);
  if (!r.guesses || r.guesses.length !== 4) throw new Error(`no route for ${DATE}: ${out}`);
  return r.guesses;
}

export async function run(rec, { base, phone }) {
  const guesses = route();
  const [g1, g2, g3, g4] = guesses.map((g) => g.name);
  const page = rec.page;
  await rec.goto(`${base}/pokedle`);
  await page.getByTestId("howto-never").click();
  await page.getByTestId("howto-sheet").waitFor({ state: "detached" });
  const box = page.getByRole("combobox");
  // The first two guesses, before the take.
  for (const name of [g1, g2]) {
    await box.fill(name);
    await page.getByRole("option").first().waitFor();
    await box.press("Enter");
    await page.locator(`[role=row]:has([role=rowheader][title="${name}"])`).waitFor();
    await page.waitForTimeout(1600);
  }
  // Warm the list's sprites (a person's browser would have them as they type).
  for (const name of [g3, g4]) {
    for (let i = 1; i <= 5; i++) {
      await box.fill(name.slice(0, i));
      await page.waitForTimeout(i < 3 ? 900 : 300);
    }
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  await box.fill("");
  await box.press("Escape");
  await box.blur();
  await page.waitForTimeout(1500);
  // The answer's artwork, which the result card shows.
  await rec.preload(guesses.map((g) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${g.id}.png`));
  await rec.hideChrome();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const rows = page.locator("[role=table] > div");
  const top = await box.boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top.y - (phone ? 70 : 40)));
  await page.waitForTimeout(300);
  await rec.freeze();
  if (phone) await rec.frameAround([box, rows.nth(5)], { aspect: 4 / 5, pad: 14, top: true });
  else await rec.frameAround([box, rows.nth(4)], { aspect: 16 / 9, pad: 30, shiftY: 14 });
  rec.cursor.x = rec.clip.x + rec.clip.width * 0.72;
  rec.cursor.y = rec.clip.y + rec.clip.height * 0.85;
  rec.start();
  await rec.wait(150);
  for (const [name, typed] of [
    [g3, g3.slice(0, 5)],
    [g4, g4.slice(0, 5)],
  ]) {
    await rec.clickEl(box, { jitter: 0.5, dx: phone ? -40 : -120 });
    await rec.wait(150);
    await rec.type(typed, { cps: 9 });
    await rec.wait(250);
    const opt = page.getByRole("option", { name: new RegExp(name) }).first();
    await rec.clickEl(opt, { jitter: 0.2, dx: phone ? 60 : 150 });
    await rec.until((n) => !!document.querySelector(`[role=row] [role=rowheader][title="${n}"]`), name);
    // Let the tiles flip.
    if (name === g4) {
      rec.mark("solved");
      await rec.moveTo(rec.clip.x + rec.clip.width * 0.82, rec.clip.y + rec.clip.height * 0.92, 900);
      await rec.wait(2600);
      rec.mark("out");
    } else {
      await rec.moveTo(rec.cursor.x + 140, rec.cursor.y + 160, 700);
      await rec.wait(900);
    }
  }
  await rec.stop();
}
