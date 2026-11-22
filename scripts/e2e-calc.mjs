/**
 * The damage calculator's compact layout (/battle/calc), in the browser: at 1440, 1024, 390 and 360 wide nothing
 * scrolls sideways; at 1440 × 900 the results strip and the top of both Pokémon panels are on the first screen,
 * and the three columns sit side by side (Pokémon 1, the field, Pokémon 2); picking a move updates the full damage
 * line and its rolls; a crit toggle changes that move's damage; Swap sides keeps the picked move's line; on phones
 * the move buttons are thumb-sized. Each part records a failure instead of stopping the rest.
 *
 *   node scripts/e2e-calc.mjs [baseUrl]       (or from e2e-smoke.mjs; E2E_ONLY=calc runs just this)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const SIZES = [
  [1440, 900, false],
  [1024, 768, false],
  [390, 844, true],
  [360, 780, true],
];

async function open(browser, [width, height, phone]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    sessionStorage.setItem("pokeiq-splash", "1");
    localStorage.setItem("pokeiq-muted", "1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${BASE_URL.value}/battle/calc`, { waitUntil: "load" });
  await page.getByTestId("calc-desc").waitFor({ timeout: 60_000 });
  return { context, page };
}
const BASE_URL = { value: "" };

const desc = (page) => page.getByTestId("calc-desc").innerText();

export async function runCalc({ browser, BASE, OUT, errors, step }) {
  step("damage calc: compact layout at 1440, 1024, 390 and 360; the results strip above the fold; picking a move updates the line");
  BASE_URL.value = BASE;
  const fail = (msg) => errors.push(`calc: ${msg}`);
  for (const size of SIZES) {
    const [w, h] = size;
    let context;
    try {
      const opened = await open(browser, size);
      context = opened.context;
      const { page } = opened;
      const wide = await page.evaluate(() => Math.max(window.innerWidth, document.documentElement.scrollWidth));
      if (wide > w + 1) fail(`${w}: the page scrolls sideways (${wide}px wide)`);
      const box = (id) => page.getByTestId(id).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left, right: r.right };
      });
      const results = await box("calc-results");
      const one = await box("calc-side-1");
      const field = await box("calc-field");
      const two = await box("calc-side-2");
      if (w === 1440) {
        if (results.bottom > h) fail(`1440 × 900: the results strip ends at ${Math.round(results.bottom)}px, under the fold`);
        if (one.top + 120 > h || two.top + 120 > h) fail(`1440 × 900: the tops of the Pokémon panels aren't on the first screen (${Math.round(one.top)}px, ${Math.round(two.top)}px)`);
      }
      if (w >= 1024) {
        // Three columns: Pokémon 1, the field (narrower), Pokémon 2, tops aligned.
        if (!(one.right <= field.left && field.right <= two.left)) fail(`${w}: the columns aren't Pokémon 1, Field, Pokémon 2 side by side`);
        if (Math.abs(one.top - field.top) > 2 || Math.abs(one.top - two.top) > 2) fail(`${w}: the three columns don't start level`);
        if (field.right - field.left >= one.right - one.left) fail(`${w}: the field column isn't narrower than a Pokémon panel`);
        // Dense panels: small fields.
        const fieldHeight = await page.getByTestId("calc-side-1").getByRole("combobox").first().evaluate((el) => el.getBoundingClientRect().height);
        if (fieldHeight > 30) fail(`${w}: the panels' fields are ${Math.round(fieldHeight)}px tall, not compact`);
      } else {
        // Phones: Pokémon 1, Pokémon 2, then the field, under the results.
        if (!(results.bottom <= one.top && one.bottom <= two.top && two.bottom <= field.top)) fail(`${w}: the phone order isn't results, Pokémon 1, Pokémon 2, Field`);
        const small = await page.getByTestId("calc-move").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((x) => x < 40));
        if (small.length) fail(`${w}: move buttons too small to tap (${small.join(", ")}px)`);
      }

      if (w === 1440 || w === 390) {
        // Picking a move shows its full line, in bold, with its rolls.
        if (!/Garchomp Earthquake vs\. .*Heatran: \d+-\d+ \(/.test(await desc(page))) fail(`${w}: the first line isn't Garchomp's Earthquake: ${await desc(page)}`);
        const earthPower = page.getByTestId("calc-moves-2").getByTestId("calc-move").filter({ hasText: "Earth Power" });
        await earthPower.click();
        if ((await earthPower.getAttribute("aria-pressed")) !== "true") fail(`${w}: the picked move isn't marked`);
        const line = await desc(page);
        if (!/Heatran Earth Power vs\. .*Garchomp: \d+-\d+ \(/.test(line)) fail(`${w}: picking Earth Power didn't update the line: ${line}`);
        const weight = await page.getByTestId("calc-desc").evaluate((el) => Number(getComputedStyle(el).fontWeight));
        if (weight < 600) fail(`${w}: the damage line isn't bold`);
        if (!/\(\d+(, \d+)+\)/.test(await page.getByTestId("calc-rolls").innerText())) fail(`${w}: the damage rolls aren't shown`);
        // The move's range on its button matches the line.
        const nums = (text) => (/([\d.]+) [-–] ([\d.]+)%/.exec(text) ?? []).slice(1).map(Number);
        const [lo, hi] = nums(line);
        const [blo, bhi] = nums(await earthPower.innerText());
        if (lo === undefined || lo !== blo || hi !== bhi) fail(`${w}: Earth Power's button doesn't show the line's ${lo} – ${hi}%`);

        if (w === 1440) {
          // A field toggle changes the result (Light Screen on the defender's side cuts a special hit).
          const plain = await desc(page);
          await page.getByRole("button", { name: "Garchomp: Light Screen" }).click();
          if ((await desc(page)) === plain) fail("1440: Light Screen on Garchomp's side didn't change Earth Power's damage");
          await page.getByRole("button", { name: "Garchomp: Light Screen" }).click();
          // A crit raises that move's damage; Swap sides keeps the picked move's line.
          const before = await desc(page);
          await page.getByRole("button", { name: "Critical hit for Pokémon 2 move 2" }).click();
          const after = await desc(page);
          if (after === before || !/critical hit/i.test(after)) fail(`1440: the crit toggle didn't change Earth Power's line: ${after}`);
          await page.getByTestId("calc-swap").click();
          const swapped = await desc(page);
          if (!/Heatran Earth Power vs\. .*Garchomp/.test(swapped)) fail(`1440: after Swap sides the line is ${swapped}`);
          if (!(await page.getByTestId("calc-moves-1").innerText()).includes("Earth Power")) fail("1440: after Swap sides Heatran's moves aren't on the left");
        }
      }
      if (OUT && (w === 1440 || w === 390)) await page.screenshot({ path: `${OUT}/battle-calc-${w}.png`, fullPage: true }).catch(() => {});
    } catch (e) {
      fail(`${w}: stopped: ${e.message.split("\n")[0]}`);
    }
    await context?.close();
  }
}

// Run on its own.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  await runCalc({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`✗ ${errors.length} error(s):`);
    errors.forEach((e) => console.error("  ", e));
    process.exit(1);
  }
  console.log("✓ damage calc passed");
}
