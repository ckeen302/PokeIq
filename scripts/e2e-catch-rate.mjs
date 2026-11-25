/**
 * The Catch Rate Calculator, end to end in the browser: the page (title, H1, explainer and structured data in the
 * server's HTML), picking a Pokémon by search and keyboard, the inputs (game, level, the draggable HP bar, status,
 * the situation), the ranked results (every ball, best first, the best and the budget pick), a throw, the URL
 * round-trip (a reload and a shared link open the same encounter with its own title and preview card), and the phone
 * layout (no sideways scroll at 390 px). Each part records a failure instead of stopping the rest. Screenshots
 * (desktop 1440 × 900 and phone 390 × 844, dark and light) go to OUT.
 *
 *   node scripts/e2e-catch-rate.mjs [baseUrl] [outDir]        (PW_CHROMIUM=/path/to/chromium to pick a browser)
 */
import fs from "fs";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const PATH = "/tools/catch-rate-calculator";

async function newContext(browser, BASE, { viewport = { width: 1440, height: 900 }, theme = "dark", reducedMotion = "no-preference", isMobile = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion, isMobile, hasTouch: isMobile });
  await context.addInitScript((th) => {
    sessionStorage.setItem("pokeiq-splash", "1");
    if (th === "light") localStorage.setItem("pokeiq-theme", "light");
  }, theme);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => undefined);
  return context;
}

function watch(page, consoleErrors) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|raw\.githubusercontent/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
}

const ready = (page) => page.getByTestId("catch-rate-app").waitFor({ timeout: 60_000 });
const hydrated = (page) => page.waitForFunction(() => !!document.querySelector('[data-testid="cr-picker-button"]') && Object.keys(document.querySelector('[data-testid="cr-picker-button"]')).some((k) => k.startsWith("__reactProps")), null, { timeout: 60_000 });
const rows = (page) => page.$$eval('[data-testid="cr-row"]', (els) => els.map((e) => ({ ball: e.getAttribute("data-ball"), chance: Number(e.getAttribute("data-chance")) })));
const best = async (page) => ({ ball: await page.getByTestId("cr-best-name").getAttribute("data-ball"), chance: Number(await page.getByTestId("cr-best-chance").getAttribute("data-chance")) });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export async function runCatchRate({ browser, BASE, OUT, errors, step }) {
  const consoleErrors = [];
  fs.mkdirSync(OUT, { recursive: true });

  await step("catch rate: page HTML (title, H1, explainer, structured data, ranking)", async () => {
    const html = await (await fetch(`${BASE}${PATH}`)).text();
    assert(/<h1[^>]*>Catch Rate Calculator<\/h1>/.test(html), "no H1");
    assert(html.includes("How catch rate works"), "no explainer");
    assert(html.includes("application/ld+json") && html.includes("WebApplication"), "no structured data");
    assert(html.includes('data-testid="cr-row"'), "the ranking isn't in the server's HTML");
    assert(/<title>[^<]*Catch Rate Calculator/.test(html), "no title");
  });

  const context = await newContext(browser, BASE);
  const page = await context.newPage();
  watch(page, consoleErrors);
  await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await hydrated(page);

  await step("catch rate: every ball ranked, best first", async () => {
    const r = await rows(page);
    assert(r.length >= 15, `only ${r.length} balls in Scarlet & Violet`);
    for (let i = 1; i < r.length; i++) assert(r[i - 1].chance >= r[i].chance, `not sorted at ${i}: ${JSON.stringify(r.slice(i - 1, i + 1))}`);
    const b = await best(page);
    assert(b.ball === r[0].ball && b.chance === r[0].chance, "the hero isn't the top row");
    assert(await page.getByTestId("cr-master").isVisible(), "no Master Ball line");
  });

  await step("catch rate: pick a Pokémon by search (Gyarados) and by keyboard", async () => {
    await page.getByTestId("cr-picker-button").click();
    await page.getByTestId("cr-search").fill("gyara");
    await page.getByTestId("cr-option-130").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cr-species-name"]')?.textContent?.includes("Gyarados"));
    assert((await page.getByTestId("cr-species-rate").textContent()).trim() === "45", "Gyarados's catch rate isn't 45");
    // A Water type: the Net Ball's tag is ×3.5 in Scarlet & Violet.
    const net = await page.locator('[data-testid="cr-row"][data-ball="net"]').textContent();
    assert(net.includes("×3.5"), `Net Ball row: ${net}`);
    // By keyboard: type, arrow down, Enter.
    await page.getByTestId("cr-picker-button").click();
    await page.getByTestId("cr-search").fill("150");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-testid="cr-species-rate"]')?.textContent?.trim() === "3");
    await page.getByTestId("cr-picker-button").click();
    await page.getByTestId("cr-search").fill("magikarp");
    await page.keyboard.press("Enter");
    await page.getByTestId("cr-picker-button").click();
    await page.getByTestId("cr-search").fill("gyarados");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-testid="cr-species-name"]')?.textContent?.includes("Gyarados"));
  });

  await step("catch rate: inputs change the odds (status, HP presets, HP drag, level, game, situation)", async () => {
    const start = (await best(page)).chance;
    await page.getByTestId("cr-status-sleep").click();
    await page.waitForFunction((s) => Number(document.querySelector('[data-testid="cr-best-chance"]').getAttribute("data-chance")) > s, start);
    const asleep = (await best(page)).chance;
    await page.getByTestId("cr-hp-one").click();
    assert((await page.getByTestId("cr-hp").getAttribute("data-hp")) === "1", "1 HP preset");
    await page.waitForFunction((s) => Number(document.querySelector('[data-testid="cr-best-chance"]').getAttribute("data-chance")) > s, asleep);
    // Drag the HP bar to about 40%: the fill turns yellow.
    const bar = await page.getByTestId("cr-hp").boundingBox();
    await page.mouse.move(bar.x + 4, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.2, bar.y + bar.height / 2, { steps: 4 });
    await page.mouse.move(bar.x + bar.width * 0.4, bar.y + bar.height / 2, { steps: 4 });
    await page.mouse.up();
    const colour = await page.locator('[data-testid="cr-hp"] [data-colour]').getAttribute("data-colour");
    assert(colour === "yellow", `HP colour at 40%: ${colour}`);
    // The keyboard moves it too.
    await page.getByTestId("cr-hp").focus();
    const before = Number(await page.getByTestId("cr-hp").getAttribute("data-hp"));
    await page.keyboard.press("ArrowRight");
    assert(Number(await page.getByTestId("cr-hp").getAttribute("data-hp")) === before + 1, "ArrowRight on the HP bar");
    // Level: the stepper and the low-level bonus in Scarlet & Violet.
    await page.getByTestId("cr-level").fill("40");
    await page.getByTestId("cr-level-up").click();
    assert((await page.getByTestId("cr-level").inputValue()) === "41", "level stepper");
    // Turn 2: the Quick Ball drops to ×1.
    await page.getByTestId("cr-turn-up").click();
    const quick = await page.locator('[data-testid="cr-row"][data-ball="quick"]').textContent();
    assert(quick.includes("×1"), `Quick Ball on turn 2: ${quick}`);
    // Night: the Dusk Ball goes up to ×3.
    await page.getByTestId("cr-dark").click();
    const dusk = await page.locator('[data-testid="cr-row"][data-ball="dusk"]').textContent();
    assert(dusk.includes("×3"), `Dusk Ball at night: ${dusk}`);
    // An older game: no Beast, Dream or Apricorn balls in Diamond & Pearl, and its Dusk Ball is ×3.5.
    await page.getByTestId("cr-game-dppt").click();
    const balls = (await rows(page)).map((r) => r.ball);
    for (const b of ["beast", "dream", "level", "heavy"]) assert(!balls.includes(b), `${b} in Diamond & Pearl`);
    const dusk4 = await page.locator('[data-testid="cr-row"][data-ball="dusk"]').textContent();
    assert(dusk4.includes("×3.5"), `Dusk Ball in Gen 4: ${dusk4}`);
    await page.getByTestId("cr-game-sv").click();
    const r = await rows(page);
    for (let i = 1; i < r.length; i++) assert(r[i - 1].chance >= r[i].chance, "not sorted after changes");
  });

  await step("catch rate: the throw preview ends in a catch or a break-out", async () => {
    await page.getByTestId("cr-throw").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="cr-throw-result"]')?.hasAttribute("data-caught"), null, { timeout: 15_000 });
    assert(await page.getByTestId("cr-tally").isVisible(), "no tally");
    // Throwing another ball from the list.
    await page.locator('[data-testid="cr-row"][data-ball="ultra"] button').click();
    assert((await page.locator('[data-testid="cr-row"][data-ball="ultra"] button').getAttribute("aria-pressed")) === "true", "picking a ball to throw");
  });

  await step("catch rate: the URL keeps the inputs (reload, shared link title and card)", async () => {
    await page.waitForFunction(() => new URLSearchParams(location.search).get("p") === "130", null, { timeout: 5000 });
    const url = page.url();
    const q = new URL(url).searchParams;
    assert(q.get("s") === "sleep" && q.get("dark") === "1" && q.get("t") === "2" && q.get("l") === "41", `query: ${q}`);
    const want = await best(page);
    const p2 = await context.newPage();
    watch(p2, consoleErrors);
    await p2.goto(url, { waitUntil: "domcontentloaded" });
    await ready(p2);
    assert((await p2.getByTestId("cr-species-name").textContent()).includes("Gyarados"), "shared link: species");
    assert((await p2.getByTestId("cr-status-sleep").getAttribute("aria-pressed")) === "true", "shared link: status");
    const got = await best(p2);
    assert(got.ball === want.ball && Math.abs(got.chance - want.chance) < 1e-9, `shared link: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
    assert((await p2.title()).includes("Catching Gyarados"), `shared title: ${await p2.title()}`);
    const og = await p2.locator('meta[property="og:image"]').getAttribute("content");
    assert(og.includes("/og?"), `og:image: ${og}`);
    const res = await fetch(new URL(og, BASE).toString().replace(/^https?:\/\/[^/]+/, BASE));
    const bytes = Buffer.from(await res.arrayBuffer());
    assert(res.ok && bytes.subarray(1, 4).toString() === "PNG", `share card: ${res.status}`);
    fs.writeFileSync(`${OUT}/og-shared.png`, bytes);
    const own = await fetch(`${BASE}${PATH}/og`);
    assert(own.ok, "the tool's own card");
    fs.writeFileSync(`${OUT}/og.png`, Buffer.from(await own.arrayBuffer()));
    await p2.close();
  });

  await step("catch rate: reduced motion shows the outcome at once", async () => {
    const c = await newContext(browser, BASE, { reducedMotion: "reduce" });
    const p = await c.newPage();
    await p.goto(`${BASE}${PATH}?p=10&hp=1&s=sleep&l=3`, { waitUntil: "domcontentloaded" });
    await ready(p);
    await hydrated(p);
    assert(Number(await p.getByTestId("cr-best-chance").getAttribute("data-chance")) === 1, "a sleeping Caterpie at 1 HP is a sure catch");
    await p.getByTestId("cr-throw").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="cr-throw-result"]')?.getAttribute("data-caught") === "true", null, { timeout: 2000 });
    await c.close();
  });

  for (const theme of ["dark", "light"]) {
    await step(`catch rate: desktop screenshot (${theme})`, async () => {
      const c = await newContext(browser, BASE, { theme });
      const p = await c.newPage();
      await p.goto(`${BASE}${PATH}?p=130&l=40&hp=350&dark=1`, { waitUntil: "networkidle" });
      await ready(p);
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${OUT}/desktop-${theme}.png` });
      await p.screenshot({ path: `${OUT}/desktop-${theme}-full.png`, fullPage: true });
      await c.close();
    });
    await step(`catch rate: phone (${theme}): no sideways scroll at 390, screenshots`, async () => {
      const c = await newContext(browser, BASE, { theme, viewport: { width: 390, height: 844 }, isMobile: true });
      const p = await c.newPage();
      watch(p, consoleErrors);
      await p.goto(`${BASE}${PATH}?p=130&l=40&hp=350&dark=1`, { waitUntil: "networkidle" });
      await ready(p);
      await hydrated(p);
      await p.waitForTimeout(600);
      assert(await noSideScroll(p), "sideways scroll at 390");
      await p.screenshot({ path: `${OUT}/phone-${theme}.png` });
      await p.screenshot({ path: `${OUT}/phone-${theme}-full.png`, fullPage: true });
      await p.getByTestId("cr-results").scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/phone-${theme}-results.png` });
      await p.getByTestId("cr-picker-button").scrollIntoViewIfNeeded();
      await p.getByTestId("cr-picker-button").tap();
      await p.getByTestId("cr-search").fill("pi");
      await p.waitForTimeout(300);
      assert(await noSideScroll(p), "sideways scroll with the picker open");
      if (theme === "dark") await p.screenshot({ path: `${OUT}/phone-picker.png` });
      await p.getByTestId("cr-option-25").tap();
      assert(await noSideScroll(p), "sideways scroll after picking");
      await c.close();
    });
  }

  await context.close();
  if (consoleErrors.length) errors.push(`catch rate: console errors:\n  ${consoleErrors.slice(0, 8).join("\n  ")}`);
}

// Run on its own: node scripts/e2e-catch-rate.mjs [baseUrl] [outDir]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const BASE = process.argv[2] ?? "http://localhost:3000";
  const OUT = process.argv[3] ?? "e2e-shots/catch-rate";
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const errors = [];
  const step = async (name, f) => {
    try {
      await f();
      console.log(`ok   ${name}`);
    } catch (e) {
      console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`);
      errors.push(`${name}: ${e.message}`);
    }
  };
  await runCatchRate({ browser, BASE, OUT, errors, step });
  await browser.close();
  if (errors.length) {
    console.log(`\n${errors.length} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
}
