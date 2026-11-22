/**
 * The Professor's Lab (/lab/pokedex), end to end in the browser: a deep
 * link opens on its Pokémon, the arrow keys, a drag and a fling turn the
 * wheel (the URL follows), the stats and roles tabs, filters, sort, search
 * (and a Pokémon outside the filters), the Forms toggle, Back, a pod click,
 * the phone layout and its sheet, the no-WebGL wheel, reduced motion, a lost
 * WebGL context coming back, the 3D Lab's card and the Pokédex entry's link.
 *
 * Then the stress test: rapid spins (keys, the mouse wheel, flings), repeated
 * filters / sorts / searches and the Forms toggle, after which no pod may be
 * left blank once it settles, the URL must match the Pokémon on the table,
 * and the JS heap and the renderer's geometries and textures must stay
 * bounded. LAB_STRESS=full runs the full 200 spins (CI runs a lighter pass).
 *
 * CI has no GPU: SwiftShader draws a few frames a second, so the scene runs at
 * its lightest tier (?q=0), waits are generous, and screenshots are optional.
 *
 *   node scripts/e2e-lab-dex.mjs [baseUrl]      (or E2E_ONLY=lab-dex in e2e-smoke)
 */
import fs from "fs";

const SPINS = process.env.LAB_STRESS === "full" ? 200 : 60;
const ROUNDS = process.env.LAB_STRESS === "full" ? 12 : 4;

const state = (page) => page.evaluate(() => window.__labDex?.() ?? null);

/** Waits until the wheel is at rest with the table and every pod filled. */
async function settled(page, timeout = 240_000) {
  return page
    .waitForFunction(
      () => {
        const d = window.__labDex?.();
        if (!d || !d.ready || d.settled === null || d.shown !== d.settled || d.wheel.target !== d.wheel.p) return false;
        if (d.mode === "2d") return true;
        return d.stats && d.stats.heroShown && d.stats.heroId === d.settled && d.stats.blankPods === 0;
      },
      null,
      { timeout, polling: 500 }
    )
    .then(() => true, () => false);
}

const pickOf = (page) => Number(new URL(page.url()).searchParams.get("pick"));

async function part(errors, name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`lab-dex: ${name}: ${e.message.split("\n")[0]}`);
  }
}

export async function runLabDex({ browser, BASE, OUT, errors, step }) {
  const shot = async (page, name) => {
    if (!OUT) return;
    await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => undefined);
  };
  const open = async (viewport, extra = {}) => {
    const context = await browser.newContext({ viewport, ...extra });
    await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`lab-dex [${page.url()}] ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`lab-dex [${page.url()}] PAGEERROR: ${e.message}`));
    return { context, page };
  };

  step("professor's lab: deep link, keys, drag, tabs, filters, sort, search, forms, back");
  const { context, page } = await open({ width: 1280, height: 800 });
  await part(errors, "deep link", async () => {
    const t0 = Date.now();
    await page.goto(`${BASE}/lab/pokedex?pick=25&q=0`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("lab-stage").waitFor({ timeout: 30_000 });
    const shell = Date.now() - t0;
    await page.getByTestId("lab-name").waitFor({ timeout: 60_000 });
    if ((await page.getByTestId("lab-name").textContent()) !== "Pikachu") errors.push("lab-dex: ?pick=25 didn't open on Pikachu");
    if (!(await settled(page))) errors.push(`lab-dex: the lab didn't settle on Pikachu (${JSON.stringify(await state(page))})`);
    console.log(`  shell ${shell} ms, settled ${Date.now() - t0} ms`);
    await shot(page, "lab-dex-desktop");
  });

  await part(errors, "keys", async () => {
    await page.getByTestId("lab-wheel").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    if (!(await settled(page))) errors.push("lab-dex: didn't settle after two arrow presses");
    if (pickOf(page) !== 27) errors.push(`lab-dex: two → presses from Pikachu should reach Sandshrew (pick=27), URL has ${pickOf(page)}`);
    await page.keyboard.press("ArrowLeft");
    await settled(page);
    if (pickOf(page) !== 26) errors.push(`lab-dex: ← should go back to Raichu, URL has ${pickOf(page)}`);
  });

  await part(errors, "drag and fling", async () => {
    const before = (await state(page)).settled;
    const box = await page.getByTestId("lab-wheel").boundingBox();
    const y = box.y + box.height * 0.55;
    await page.mouse.move(box.x + box.width * 0.6, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.6 - i * 45, y);
    await page.mouse.up();
    if (!(await settled(page))) errors.push(`lab-dex: didn't settle after a fling (${JSON.stringify(await state(page))})`);
    const after = await state(page);
    if (after.settled <= before) errors.push(`lab-dex: a leftward fling should move on to later Pokémon (${before} → ${after.settled})`);
    if (pickOf(page) !== after.settled) errors.push(`lab-dex: the URL (pick=${pickOf(page)}) doesn't match the table (${after.settled})`);
  });

  await part(errors, "tabs", async () => {
    await page.getByTestId("lab-tab-roles").click();
    await page.getByTestId("lab-roles").waitFor({ timeout: 10_000 });
    const roles = await page.locator('[data-testid^="lab-role-"][data-testid$="sweeper"], [data-testid="lab-role-wall"], [data-testid$="-tank"]').count();
    if (roles !== 5) errors.push(`lab-dex: the Roles tab shows ${roles} roles, not 5`);
    if ((await page.locator('[data-best="1"]').count()) !== 1) errors.push("lab-dex: the Roles tab doesn't light exactly one best role");
    const pct = await page.getByTestId("lab-role-pct").first().textContent();
    if (!/^(Top|Bottom) \d+%$/.test(pct ?? "")) errors.push(`lab-dex: a role's percentile reads "${pct}"`);
    await page.getByTestId("lab-tab-stats").click();
    await page.getByTestId("lab-stats").waitFor({ timeout: 10_000 });
  });

  await part(errors, "details", async () => {
    await page.getByTestId("lab-entry").waitFor({ timeout: 30_000 });
    await page.getByTestId("lab-matchups").waitFor({ timeout: 10_000 });
  });

  await part(errors, "filters and search", async () => {
    await page.getByTestId("lab-types").click();
    await page.getByTestId("lab-type-fire").click();
    await page.keyboard.press("Escape");
    await page.waitForURL(/type=fire/, { timeout: 30_000 });
    await settled(page);
    const s = await state(page);
    if (!s.seqLength || s.seqLength > 120) errors.push(`lab-dex: the Fire filter left ${s.seqLength} Pokémon`);
    // Charmander is in the filter: search jumps there.
    await page.getByTestId("lab-search").fill("charmander");
    await page.keyboard.press("Enter");
    await settled(page);
    if (pickOf(page) !== 4) errors.push(`lab-dex: searching "charmander" landed on ${pickOf(page)}`);
    // Blastoise isn't: Enter shows it anyway (the filters reset).
    await page.getByTestId("lab-search").fill("blastoise");
    await page.keyboard.press("Enter");
    await settled(page);
    if (pickOf(page) !== 9 || /type=/.test(page.url())) errors.push(`lab-dex: a search outside the filters should clear them and show Blastoise (${page.url()})`);
    // Back returns to the Fire filter on Charmander.
    await page.goBack();
    await settled(page);
    if (!/type=fire/.test(page.url())) errors.push(`lab-dex: Back didn't restore the Fire filter (${page.url()})`);
    // Sort by Speed, fastest first.
    await page.getByTestId("lab-sort").selectOption("spe");
    await page.waitForURL(/sort=spe/, { timeout: 30_000 });
    await settled(page);
    await page.keyboard.press("Home");
    await settled(page);
    const v = await page.getByTestId("lab-sort-value").textContent();
    if (!/Speed\s*\d+/.test(v ?? "")) errors.push(`lab-dex: sorted by Speed, the panel shows "${v}"`);
    await page.getByTestId("lab-reset").click();
    await page.waitForURL((u) => !/type=|sort=/.test(u.search), { timeout: 30_000 });
    await settled(page);
  });

  await part(errors, "forms", async () => {
    await page.getByTestId("lab-filters").click();
    await page.getByTestId("lab-forms").click();
    await page.keyboard.press("Escape");
    await page.waitForURL(/forms=1/, { timeout: 30_000 });
    await page.getByTestId("lab-search").fill("mega charizard x");
    await page.keyboard.press("Enter");
    if (!(await settled(page))) errors.push("lab-dex: didn't settle on Mega Charizard X");
    if (pickOf(page) !== 10034) errors.push(`lab-dex: "mega charizard x" landed on ${pickOf(page)}`);
    if ((await page.getByTestId("lab-name").textContent()) !== "Mega Charizard X") errors.push("lab-dex: the panel doesn't name Mega Charizard X");
    await shot(page, "lab-dex-form");
  });

  await part(errors, "pod click", async () => {
    // Pull back (a held drag), then let go: the wheel snaps; a click on the stage's side lands on a pod or nothing (no errors either way).
    const box = await page.getByTestId("lab-wheel").boundingBox();
    await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.62);
    await settled(page);
  });

  step("professor's lab: stress (rapid spins, filters, sorts, searches, forms)");
  await part(errors, "stress", async () => {
    await page.goto(`${BASE}/lab/pokedex?pick=1&q=0`, { waitUntil: "domcontentloaded" });
    await settled(page);
    // Warm up first: the first pull-back reveals the whole room, and three.js counts a geometry once it's first drawn.
    await page.evaluate(() => { for (let k = 0; k < 6; k++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })); });
    await settled(page);
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const r0 = (await state(page)).stats;
    // Rapid spins: key bursts, wheel bursts and flings, without waiting for anything to load.
    const box = await page.getByTestId("lab-wheel").boundingBox();
    for (let i = 0; i < SPINS; i++) {
      const kind = i % 4;
      if (kind === 0) await page.evaluate((n) => { for (let k = 0; k < n; k++) window.dispatchEvent(new KeyboardEvent("keydown", { key: k % 3 ? "ArrowRight" : "ArrowLeft", bubbles: true })); }, 3 + (i % 5));
      else if (kind === 1) await page.evaluate(() => document.querySelector('[data-testid="lab-wheel"]').dispatchEvent(new WheelEvent("wheel", { deltaY: 240, bubbles: true, cancelable: true })));
      else if (kind === 2) {
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
        await page.mouse.down();
        for (let k = 1; k <= 4; k++) await page.mouse.move(box.x + box.width * 0.7 - k * 90 * (i % 8 < 4 ? 1 : -1), box.y + box.height * 0.5);
        await page.mouse.up();
      } else await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })));
    }
    if (!(await settled(page, 300_000))) errors.push(`lab-dex: after ${SPINS} rapid spins the lab didn't settle with every pod filled (${JSON.stringify(await state(page))})`);
    const s1 = await state(page);
    if (pickOf(page) !== s1.settled) errors.push(`lab-dex: after the spins the URL (pick=${pickOf(page)}) doesn't match the table (${s1.settled})`);
    // Filters, sorts, searches, the Forms toggle, over and over.
    const types = ["water", "dragon", "grass", "ghost"];
    const sorts = ["bst", "physicalSweeper", "name", "wall", "spe", "id"];
    for (let r = 0; r < ROUNDS; r++) {
      await page.getByTestId("lab-types").click();
      await page.getByTestId(`lab-type-${types[r % types.length]}`).click();
      await page.keyboard.press("Escape");
      await page.getByTestId("lab-sort").selectOption(sorts[r % sorts.length]);
      await page.getByTestId("lab-search").fill(["dra", "a", "mew", "10"][r % 4]);
      await page.keyboard.press("Enter");
      await page.getByTestId("lab-filters").click();
      await page.getByTestId("lab-forms").click();
      await page.keyboard.press("Escape");
      if (r % 2) await page.getByTestId("lab-reset").click().catch(() => undefined);
    }
    if (!(await settled(page, 300_000))) errors.push(`lab-dex: after repeated filters, sorts and searches the lab didn't settle (${JSON.stringify(await state(page))})`);
    const s2 = await state(page);
    if (pickOf(page) !== s2.settled) errors.push(`lab-dex: after the filter churn the URL (pick=${pickOf(page)}) doesn't match the table (${s2.settled})`);
    await page.evaluate(() => window.gc?.());
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const r1 = s2.stats;
    const mb = (n) => Math.round(n / 1048576);
    console.log(`  heap ${mb(heap0)} → ${mb(heap1)} MB; geometries ${r0.geometries} → ${r1.geometries}; textures ${r0.textures} → ${r1.textures}; figures ${JSON.stringify(r1.stream)}`);
    if (heap1 > 400 * 1048576) errors.push(`lab-dex: JS heap at ${mb(heap1)} MB after the stress test`);
    if (r1.orphans) errors.push(`lab-dex: ${r1.orphans} figure(s) on show that the cache already disposed`);
    if (r1.geometries > r0.geometries + 120) errors.push(`lab-dex: geometries grew from ${r0.geometries} to ${r1.geometries}`);
    if (r1.textures > r0.textures + 60) errors.push(`lab-dex: textures grew from ${r0.textures} to ${r1.textures}`);
    if (r1.stream.pod > 40 || r1.stream.hero > 6) errors.push(`lab-dex: the figure cache is over its caps (${JSON.stringify(r1.stream)})`);
    fs.writeFileSync(`${OUT ?? "."}/lab-dex-stress.json`, JSON.stringify({ spins: SPINS, rounds: ROUNDS, heap0, heap1, before: r0, after: r1 }, null, 2));
  });

  step("professor's lab: lost WebGL context comes back");
  await part(errors, "context loss", async () => {
    const frames0 = (await state(page)).frames;
    await page.evaluate(() => document.querySelector('[data-testid="lab-wheel"] canvas')?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext());
    await page.waitForTimeout(4000);
    if (!(await settled(page))) errors.push("lab-dex: the lab didn't come back after losing its WebGL context");
    if ((await page.locator('[data-testid="lab-wheel"] canvas').count()) !== 1) errors.push("lab-dex: more or fewer than one canvas after the context came back");
    if ((await state(page)).frames <= frames0) errors.push("lab-dex: frames stopped after the context loss");
  });
  await context.close();

  step("professor's lab: phone layout, no-WebGL wheel, reduced motion, hub card, Pokédex link");
  await part(errors, "phone", async () => {
    const { context: c, page: p } = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await p.goto(`${BASE}/lab/pokedex?pick=448&q=0`, { waitUntil: "domcontentloaded" });
    await settled(p);
    if ((await p.getByTestId("lab-name").textContent()) !== "Lucario") errors.push("lab-dex: the phone layout doesn't show Lucario");
    if (await p.getByTestId("tabbar").isVisible().catch(() => false)) errors.push("lab-dex: the site's tab bar covers the lab's sheet on a phone");
    await p.getByTestId("lab-sheet-handle").click();
    await p.waitForFunction(() => document.querySelector('[data-testid="lab-sheet"]')?.getAttribute("data-open") === "1", null, { timeout: 10_000 });
    await p.getByTestId("lab-sheet-handle").click();
    await p.getByTestId("lab-next").click();
    await settled(p);
    if (pickOf(p) !== 449) errors.push(`lab-dex: the phone's next button landed on ${pickOf(p)}`);
    await p.getByTestId("lab-filters").click();
    await p.getByTestId("lab-filter-sheet").waitFor({ timeout: 10_000 });
    await p.getByTestId("lab-filters-done").click();
    await shot(p, "lab-dex-phone");
    await c.close();
  });
  await part(errors, "no WebGL", async () => {
    const { context: c, page: p } = await open({ width: 1280, height: 800 });
    await p.goto(`${BASE}/lab/pokedex?pick=133&view=2d`, { waitUntil: "domcontentloaded" });
    await p.getByTestId("lab-fallback").waitFor({ timeout: 30_000 });
    await settled(p);
    await p.keyboard.press("ArrowRight");
    await p.waitForURL(/pick=134/, { timeout: 60_000 }).catch(() => undefined);
    await settled(p);
    if (pickOf(p) !== 134) errors.push(`lab-dex: the 2D wheel's → landed on ${pickOf(p)}`);
    await c.close();
  });
  await part(errors, "reduced motion", async () => {
    const { context: c, page: p } = await open({ width: 1280, height: 800 }, { reducedMotion: "reduce" });
    await p.goto(`${BASE}/lab/pokedex?pick=150&q=0`, { waitUntil: "domcontentloaded" });
    if (!(await settled(p))) errors.push("lab-dex: didn't settle with reduced motion");
    await c.close();
  });
  await part(errors, "links in", async () => {
    const { context: c, page: p } = await open({ width: 1280, height: 800 });
    await p.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" });
    const card = p.getByTestId("lab-card-pokedex");
    if (!(await card.count())) errors.push("lab-dex: no Professor's Lab card on /lab");
    else if ((await p.getByTestId("lab-open-pokedex").getAttribute("href")) !== "/lab/pokedex") errors.push("lab-dex: the /lab card doesn't open /lab/pokedex");
    await p.goto(`${BASE}/pokemon/charizard`, { waitUntil: "domcontentloaded" });
    if ((await p.getByTestId("dex-lab").getAttribute("href")) !== "/lab/pokedex?pick=6") errors.push("lab-dex: Charizard's Pokédex entry has no 'View in the 3D Lab' link");
    await c.close();
  });
}

// Standalone: node scripts/e2e-lab-dex.mjs [baseUrl]
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const { chromium } = await import("playwright");
  const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
  const OUT = "e2e-screenshots";
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--expose-gc", "--enable-precise-memory-info"],
  });
  const errors = [];
  await runLabDex({ browser, BASE, OUT, errors, step: (s) => console.log(`• ${s}`) });
  await browser.close();
  if (errors.length) {
    console.error(`\n${errors.length} problem(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nProfessor's Lab: all checks passed.");
}
