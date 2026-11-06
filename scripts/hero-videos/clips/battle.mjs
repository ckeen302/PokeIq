/**
 * Battle: a [Gen 9] Random Battle against the computer, the real engine on
 * the server. The battle is played in real time (the strongest-looking move
 * each turn, as the e2e test plays) until the foe is low; then the turn is
 * filmed frame by frame: the move, its animation, the HP bar draining, the
 * faint. A turn that doesn't KO is thrown away and the battle goes on.
 */
// A tall phone, so the whole battle fits and the page never scrolls under the camera.
export const setup = (phone) => ({ viewport: phone ? { width: 390, height: 1500 } : { width: 1440, height: 900 } });

const READY = "[data-testid=move-button]:not([disabled]), [data-testid=switch-button]:not([disabled]), [data-testid=lead-button]:not([disabled]), [data-testid=battle-result]";

async function bestMove(page) {
  const moves = page.locator("[data-testid=move-button]:not([disabled])");
  const texts = (await moves.allInnerTexts()).map((t) => t.toLowerCase());
  if (!texts.length) return null;
  const score = (t) => (Number(/pow (\d+)/.exec(t)?.[1] ?? 0) || 1) * (t.includes("super effective") ? 2 : t.includes("not very") ? 0.5 : t.includes("no effect") ? 0 : 1);
  const best = texts.reduce((b, t, i) => (score(t) > score(texts[b]) ? i : b), 0);
  return moves.nth(best);
}

const foePct = (page) => page.evaluate(() => {
  const t = document.querySelector("[data-testid=hud-foe]")?.textContent ?? "";
  const m = /(\d+)%/.exec(t);
  return m ? Number(m[1]) : null;
});

const foeFaints = (page) => page.evaluate(() => (document.querySelector("[data-testid=battle-log]")?.textContent ?? "").match(/The opposing [^!]*? fainted!/g)?.length ?? 0);

export async function run(rec, ctx) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await battle(rec, ctx);
    } catch (e) {
      console.log(`\n  battle ${attempt}: ${e.message}; a new battle`);
      await rec.thaw().catch(() => {});
      rec.recording = false;
    }
  }
  throw new Error("no KO take in five battles");
}

async function battle(rec, { base, phone }) {
  const page = rec.page;
  await rec.goto(`${base}/battle/play`);
  await page.locator("label").filter({ hasText: "[Gen 9] Random Battle" }).first().click();
  await page.getByLabel("Your trainer name").fill("Red");
  await page.getByRole("button", { name: /Start battle/ }).click();
  await page.waitForURL(/\/battle\/play\/[a-z2-9]{8}$/);
  await page.locator("[data-testid=move-button]").first().waitFor({ timeout: 90_000 });
  await rec.hideChrome();
  let takes = 0;
  for (let turn = 0; turn < 80; turn++) {
    await page.locator(READY).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(400);
    if (await page.locator("[data-testid=battle-result]").count()) throw new Error("the battle ended before a good take");
    const leads = page.locator("[data-testid=lead-button]:not([disabled])");
    if (await leads.count()) {
      await leads.first().click();
      continue;
    }
    const move = await bestMove(page);
    if (!move) {
      await page.locator("[data-testid=switch-button]:not([disabled])").first().click();
      continue;
    }
    const pct = await foePct(page);
    if (pct === null || pct > 45 || turn < 1) {
      await move.click();
      await page.waitForTimeout(300);
      continue;
    }
    // A take: this turn could be the KO.
    takes++;
    await page.mouse.move(5, 5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await rec.freeze();
    // The stage: its two HUDs sit in its corners.
    const huds = [page.getByTestId("stage-far"), page.getByTestId("stage-near")];
    if (phone) await rec.frameAround([page.getByTestId("battle-arena")], { aspect: 4 / 5, pad: 0, top: true, shiftX: 0 });
    else await rec.frameAround(huds, { aspect: 16 / 9, pad: 14 });
    console.log("\n  clip", JSON.stringify(rec.clip), JSON.stringify(await page.getByTestId("battle-arena").boundingBox()));
    rec.cursor.x = rec.clip.x + rec.clip.width * 0.8;
    rec.cursor.y = rec.clip.y + rec.clip.height * 0.95;
    rec.start();
    await rec.wait(500);
    await rec.clickEl(await bestMove(page), { jitter: 0.3 });
    const before = await foeFaints(page);
    await rec.wait(400);
    // Film until the turn is over (the next choice, or the end).
    let over = false;
    for (let i = 0; i < 60 * 25 && !over; i++) {
      await rec.tick();
      if (i % 15 === 0) over = await page.evaluate((sel) => !!document.querySelector(sel), READY);
    }
    const faints = await foeFaints(page);
    const foeDown = faints > before;
    console.log(`\n  take ${takes}: foe was ${pct}%, KO: ${foeDown} (${before} -> ${faints} faint lines), ${rec.frame} frames`);
    if (foeDown) {
      await rec.wait(1200);
      rec.mark("out");
      await rec.stop();
      return;
    }
    rec.recording = false;
    await rec.thaw();
  }
  throw new Error("no KO take");
}
