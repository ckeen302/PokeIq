/**
 * The PokéIQ Test, end to end, in the browser: the landing, the four
 * cognitive sections (reasoning, memory, speed, spatial), the knowledge
 * quiz, the result page, the trainer card's readout and a retake — at
 * 1440 px and on a 390 px phone, with a screenshot of each section.
 *
 * The page's fast-mode hook (localStorage "pokeiq:iq-test:fast") shortens
 * every clock, so a whole test takes about a minute. Answers are the first
 * option each time: the run checks the flow, not the score.
 */

const SECTIONS = ["reasoning", "memory", "speed", "spatial"];

/** Plays whatever is on screen until the next section intro, the knowledge quiz or the result page shows. */
async function playSection(page) {
  for (let guard = 0; guard < 400; guard++) {
    if (await page.getByTestId("cog-intro").isVisible()) return "intro";
    if (await page.getByTestId("cog-knowledge").isVisible()) return "knowledge";
    if (await page.getByTestId("cog-results").isVisible()) return "results";
    const option = page.locator('[data-testid="cog-option"]:not([disabled])').first();
    if (await option.isVisible()) {
      // A tap can land as the item re-renders (adaptive step): a detached element just means try the next one.
      await option.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(700);
      continue;
    }
    const cell = page.locator('[data-testid="cog-span-cell"]:not([disabled])').first();
    if (await cell.isVisible()) {
      // The recall clock's bar slides in above the grid as it appears: skip the stability wait.
      await cell.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(80);
      continue;
    }
    const speedCell = page.locator('[data-testid="cog-speed-cell"]').first();
    if (await speedCell.isVisible()) {
      await speedCell.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(150);
  }
  throw new Error("the PokéIQ Test never reached its next section");
}

/** Clicks a button that animates in and may re-render once: retries a few times instead of waiting forever for it to sit still. */
async function clickWhenSettled(locator) {
  for (let attempt = 0; ; attempt++) {
    try {
      await locator.waitFor({ state: "visible", timeout: 15_000 });
      await locator.click({ timeout: 5_000, force: attempt > 0 });
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function runAt(page, { BASE, OUT, errors, tag }) {
  await page.goto(`${BASE}/iq-test`, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.setItem(key, "1"), "pokeiq:iq-test:fast");
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/iq-test-${tag}-0-landing.png`, fullPage: true });
  await page.getByTestId("iq-start").click();

  for (let i = 0; i < SECTIONS.length; i++) {
    await page.getByTestId("cog-intro").waitFor({ timeout: 15_000 });
    const intro = await page.getByTestId("cog-intro").innerText();
    if (!intro.toLowerCase().includes(`section ${i + 1} of 5`)) errors.push(`iq-test ${tag}: section ${i + 1}'s intro reads "${intro.slice(0, 40)}"`);
    await clickWhenSettled(page.getByTestId("cog-begin"));
    await page.locator('[data-testid="cog-item"], [data-testid="cog-speed"]').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(i === 1 ? 1200 : 500);
    await page.screenshot({ path: `${OUT}/iq-test-${tag}-${i + 1}-${SECTIONS[i]}.png`, fullPage: true });
    const next = await playSection(page);
    if (i < SECTIONS.length - 1 && next !== "intro") errors.push(`iq-test ${tag}: after ${SECTIONS[i]} came ${next}, not the next intro`);
  }

  // Section 5: the knowledge quiz, 20 questions.
  await page.getByTestId("cog-intro").waitFor({ timeout: 15_000 });
  await page.getByTestId("cog-begin").click();
  await page.getByTestId("cog-knowledge").waitFor({ timeout: 15_000 });
  for (let i = 0; i < 20; i++) {
    await page.waitForSelector("[data-answer-tile]:not([disabled])", { timeout: 20_000 });
    if (i === 0) {
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/iq-test-${tag}-5-knowledge.png`, fullPage: true });
    }
    await page.locator("[data-answer-tile]:not([disabled])").first().click();
    const next = page.getByRole("button", { name: /Next question|See results/ });
    await next.waitFor({ timeout: 15_000 });
    await next.click();
  }

  // The result page.
  await page.getByTestId("cog-results").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  const score = Number((await page.getByTestId("cog-score").innerText()).trim());
  if (!(score >= 55 && score <= 145)) errors.push(`iq-test ${tag}: composite reads "${score}"`);
  const pct = await page.getByTestId("cog-percentile").innerText();
  if (!/^\d+(st|nd|rd|th) percentile of trainers$/.test(pct.trim())) errors.push(`iq-test ${tag}: percentile reads "${pct}"`);
  const bars = await page.getByTestId("cog-bar").count();
  if (bars !== 5) errors.push(`iq-test ${tag}: ${bars} profile bars, expected 5`);
  if (!(await page.getByTestId("cog-words").isVisible())) errors.push(`iq-test ${tag}: no strengths/weaknesses text`);
  if (!(await page.getByText("not a clinical IQ test").first().isVisible())) errors.push(`iq-test ${tag}: no framing text`);
  if (!(await page.getByTestId("share-result").isVisible())) errors.push(`iq-test ${tag}: no share button`);
  await page.screenshot({ path: `${OUT}/iq-test-${tag}-6-results.png`, fullPage: true });

  // Kept in progress and shown on the trainer card beside the PokéIQ rating.
  await page.goto(`${BASE}/trainer`, { waitUntil: "networkidle" });
  const readout = await page.getByTestId("trainer-cognitive").innerText();
  if (!readout.includes(String(score))) errors.push(`iq-test ${tag}: trainer card reads "${readout.replace(/\s+/g, " ")}", expected ${score}`);
  await page.screenshot({ path: `${OUT}/iq-test-${tag}-7-trainer.png` });

  // A retake starts over with the first intro.
  await page.goto(`${BASE}/iq-test`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("iq-current").innerText()).includes(String(score))) errors.push(`iq-test ${tag}: the landing doesn't show the last score`);
  return score;
}

export async function runIqTest({ newPage, BASE, OUT, errors }) {
  const desktop = await newPage({ width: 1440, height: 1000 });
  await runAt(desktop, { BASE, OUT, errors, tag: "1440" });
  // The retake button draws fresh items: back at section 1's intro.
  await desktop.getByTestId("iq-start").click();
  await desktop.getByTestId("cog-intro").waitFor();
  await desktop.context().close();

  const phone = await newPage({ width: 390, height: 844 });
  await runAt(phone, { BASE, OUT, errors, tag: "390" });
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 0) errors.push(`iq-test 390: the page scrolls sideways by ${wide}px`);
  await phone.context().close();
}
