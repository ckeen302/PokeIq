/**
 * PokéGuessr's in-game UI, end to end against a running build: a solo round
 * (map docked and hovered), its result and summary, then a duel (versus intro,
 * round, the reveal with its damage sequence, Turbo, an emote, the end screen
 * and its post-game dances),
 * at a desktop and a phone size, with a screenshot of each screen. Fails on
 * any console or page error.
 *
 *   npm run build && npm start      # in another terminal
 *   node scripts/e2e-guessr.mjs [baseUrl] [outDir]
 *
 * Set CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { chromium } from "playwright";
import fs from "fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function newPage(viewport, extra = {}) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768, ...extra });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));
  return page;
}

function step(name) {
  console.log(`▶ ${name}`);
}

const HOWTO = '[data-testid="howto-sheet"]';
async function closeHowTo(p) {
  const sheet = p.locator(HOWTO).first();
  if (await sheet.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) {
    await p.getByTestId("howto-never").click();
    await sheet.waitFor({ state: "hidden" });
  }
}

const shotLoaded = (p) =>
  p.waitForFunction(
    () => {
      const img = document.querySelector("img[alt='Where is this?']");
      return img?.complete && img.naturalWidth > 0;
    },
    null,
    { timeout: 30_000 }
  );

/** Drops a pin at (at, at) across the map and presses Guess: through the dock, or the phone's sheet. */
async function pinAndGuess(p, phone, at, shots) {
  if (phone) {
    await p.getByTestId("geo-map-pill").click();
    await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
    await p.waitForTimeout(350);
    if (shots) await p.screenshot({ path: `${OUT}/${shots}-sheet.png` });
  } else {
    const dock = p.getByTestId("geo-dock");
    if (shots) {
      // The pointer is off the dock: it sits collapsed, then grows a step when hovered.
      await p.mouse.move(120, 320);
      await p.waitForTimeout(750);
      if ((await dock.getAttribute("data-open")) === "true") errors.push("the map dock is open before anyone hovers it");
    }
    const box = await dock.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    const opened = await p.waitForFunction(() => document.querySelector("[data-testid=geo-dock]")?.getAttribute("data-open") === "true", null, { timeout: 5_000 }).then(() => true, () => false);
    if (!opened) {
      const under = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 160), [box.x + box.width / 2, box.y + box.height / 2]);
      throw new Error(`the map dock didn't grow on hover (${await dock.getAttribute("data-size")}, open=${await dock.getAttribute("data-open")}, box=${JSON.stringify(box)}, under=${under})`);
    }
    await p.waitForTimeout(350);
    if (shots) await p.screenshot({ path: `${OUT}/${shots}-hovered.png` });
  }
  const map = p.locator("[role=application]");
  const box = await map.boundingBox();
  // Along the map's middle: on a phone the world sits in a band across the sheet.
  await map.click({ position: { x: box.width * at, y: box.height * 0.5 } });
  // The phone's pill also reads "Guess": the button under the map is the one.
  const guess = p.getByTestId("geo-guess");
  await guess.waitFor();
  const enabled = await p.locator("[data-testid=geo-guess]:not([disabled])").waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (!enabled) {
    await p.screenshot({ path: `${OUT}/fail-pin.png` });
    throw new Error(`Guess stays disabled after a pin (${await p.getByTestId("geo-round").innerText().catch(() => "?")}, at ${at}, box ${JSON.stringify(box)})`);
  }
  await guess.click();
}

// ---------------------------------------------------------------------------
// Solo
// ---------------------------------------------------------------------------

async function solo(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  const page = await newPage({ width, height });
  step(`solo at ${tag}`);
  await page.goto(`${BASE}/guessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  await page.getByRole("button", { name: /5-round game/ }).click();
  await shotLoaded(page);
  await page.locator("[data-testid=geo-shell]").waitFor();
  if (await page.locator("header").first().isVisible().catch(() => false)) {
    const covered = await page.evaluate(() => {
      const h = document.querySelector("header");
      const r = h.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(10, r.height / 2));
      return !!top?.closest("[data-testid=geo-shell]");
    });
    if (!covered) errors.push("the site header shows over the game");
  }
  await page.getByTestId("geo-notch").waitFor();
  if (!/round 1/i.test(await page.getByTestId("geo-round").innerText())) errors.push("the notch doesn't say Round 1");
  if (!(await page.getByRole("button", { name: /Place your pin/ }).isDisabled().catch(() => true)) && !phone) errors.push("Guess is enabled before a pin");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/guessr-round-${tag}.png` });
  await pinAndGuess(page, phone, 0.5, `guessr-round-${tag}`);
  await page.getByTestId("geo-reveal").waitFor();
  await page.getByTestId("geo-next").waitFor();
  if ((await page.getByTestId("geo-reveal-line").count()) !== 1) errors.push("the result map draws no line");
  // The line draws, the camera fits, the score counts up.
  await page.waitForTimeout(2700);
  if (!(await page.getByTestId("geo-answer-place").innerText()).trim()) errors.push("the reveal names no place");
  if (!/Pokémon /.test(await page.getByTestId("geo-answer-game").innerText())) errors.push("the reveal names no game");
  await page.screenshot({ path: `${OUT}/guessr-result-${tag}.png` });
  // Space goes on.
  await page.keyboard.press("Space");
  await shotLoaded(page);
  for (let i = 1; i < 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, phone, 0.3 + i * 0.1);
    const next = page.getByTestId("geo-next");
    await next.waitFor();
    const label = await next.innerText();
    await next.click();
    if (/summary/i.test(label)) break;
  }
  await page.getByTestId("geo-share-card").waitFor();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/guessr-summary-${tag}.png`, fullPage: true });
  await page.context().close();
}

// ---------------------------------------------------------------------------
// The hub's sections, and the Weekly Challenge (one scored try a week)
// ---------------------------------------------------------------------------

async function weekly(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  const page = await newPage({ width, height });
  step(`hub + weekly challenge at ${tag}`);
  // No start or guess response may name a place before it's guessed.
  page.on("response", async (res) => {
    if (!res.url().endsWith("/api/geo") || res.request().method() !== "POST" || !res.ok()) return;
    const body = await res.json().catch(() => null);
    if (body && /"(name|pin|mask|location)"/.test(JSON.stringify(body.round ?? {}))) errors.push(`weekly round leaked its place: ${JSON.stringify(body.round)}`);
  });
  await page.goto(`${BASE}/guessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  for (const id of ["play", "multiplayer", "maps", "you"]) await page.getByTestId(`geo-hub-${id}`).waitFor();
  for (const id of ["geo-solo-card", "geo-daily-card", "geo-weekly-card", "region-streak-card", "geo-duels-card", "geo-ranked-tile", "geo-party-card", "geo-map-gallery", "globe-card", "geo-history-link"]) {
    if ((await page.getByTestId(id).count()) !== 1) errors.push(`the hub has no ${id}`);
  }
  if ((await page.getByTestId("geo-history-link").getAttribute("href")) !== "/guessr/history") errors.push("the duel history link doesn't go to /guessr/history");
  await page.getByTestId("geo-achievements").waitFor({ timeout: 15_000 });
  await page.getByTestId("geo-mastery").waitFor();
  // A map tile picks the map for a solo game.
  await page.getByTestId("geo-map-tile-johto").click();
  await page.getByRole("radio", { name: "Johto", checked: true }).waitFor();
  // The Ranked tile opens the duel panel on the ranked queue.
  await page.getByTestId("geo-open-ranked").click();
  await page.getByTestId("geo-ranked-card").waitFor();
  await page.getByTestId("geo-duel-queue-casual").click();
  const label = await page.getByTestId("geo-weekly-card").innerText();
  if (!/Weekly #\d+/i.test(label)) errors.push(`the weekly card has no number: ${label}`);
  await page.getByTestId("geo-weekly-play").click();
  await shotLoaded(page);
  if (!/Weekly #\d+/i.test(await page.getByTestId("geo-notch").innerText())) errors.push("the weekly game's notch doesn't say Weekly");
  for (let i = 0; i < 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, phone, 0.3 + i * 0.1);
    const next = page.getByTestId("geo-next");
    await next.waitFor();
    const text = await next.innerText();
    await next.click();
    if (/summary|results/i.test(text)) break;
  }
  await page.getByTestId("geo-share-card").waitFor();
  const card = await page.getByTestId("geo-share-preview").innerText();
  if (!/PokéGuessr Weekly #\d+/.test(card)) errors.push(`the weekly result card is off: ${card}`);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/guessr-weekly-summary-${tag}.png`, fullPage: true });
  // A second start the same week is practice.
  const again = await page.request.post(`${BASE}/api/geo`, { data: { weekly: true } });
  if ((await again.json()).practice !== "repeat-weekly") errors.push("a second weekly start wasn't practice");
  await page.goto(`${BASE}/leaderboard?board=geo&format=weekly`, { waitUntil: "networkidle" });
  await page.getByTestId("geo-board-weekly").click();
  await page.getByTestId("geo-weekly-board-title").waitFor();
  await page.context().close();
}

// ---------------------------------------------------------------------------
// Duels
// ---------------------------------------------------------------------------

async function duel(width, height, { turbo }) {
  const phone = width < 768;
  const tag = `${width}`;
  const red = await newPage({ width, height });
  const blue = await newPage({ width, height });
  step(`duel at ${tag}${turbo ? " (Turbo)" : ""}`);
  await red.goto(`${BASE}/guessr?region=kanto`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  if (turbo) {
    await red.getByTestId("geo-duel-turbo").click();
    if ((await red.getByTestId("geo-duel-turbo").getAttribute("aria-checked")) !== "true") errors.push("Turbo didn't switch on");
  }
  await red.getByLabel("Your trainer name").fill("Red");
  for (let i = 0; i < 4; i++) {
    const name = red.getByLabel("Your trainer name").first();
    if (!(await name.inputValue())) await name.fill("Red");
    await red.getByRole("button", { name: /Create duel/ }).click({ timeout: 10_000 }).catch(() => {});
    if (await red.waitForURL(/\/guessr\/duel\/[a-z2-9]{8}$/, { timeout: 10_000 }).then(() => true, () => false)) break;
  }
  const url = red.url();
  await red.getByText("Waiting for a challenger").waitFor();
  if (turbo && !(await red.getByText(/Turbo/).first().isVisible())) errors.push("the Turbo lobby doesn't say Turbo");
  await blue.goto(url, { waitUntil: "networkidle" });
  await blue.getByText("Red challenges you!").waitFor();
  await blue.getByLabel("Your trainer name").fill("Blue");
  await blue.getByRole("button", { name: /Join duel/ }).click();
  await red.getByText("Blue").first().waitFor();
  await Promise.all([red, blue].map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));

  // The versus intro.
  await red.getByTestId("geo-versus").waitFor({ timeout: 15_000 });
  if ((await red.getByTestId("geo-intro-digit").count()) !== 1) errors.push("the versus intro has no countdown digit");
  await red.waitForTimeout(500);
  await red.screenshot({ path: `${OUT}/duel-versus-${tag}.png` });

  // Round 1: the band, the clock, then both guess (Blue far off, so Red deals damage).
  await Promise.all([shotLoaded(red), shotLoaded(blue)]);
  await red.getByTestId("geo-duel-band").waitFor();
  if ((await red.getByTestId("geo-hp-0").count()) !== 1 || (await red.getByTestId("geo-hp-1").count()) !== 1) errors.push("the band shows no HP bars");
  if (!/round 1/i.test(await red.getByTestId("geo-duel-round").innerText())) errors.push("the band doesn't say Round 1");
  if (!/1× damage/i.test(await red.getByTestId("geo-duel-multiplier").innerText())) errors.push(`round 1 multiplier reads ${await red.getByTestId("geo-duel-multiplier").innerText()}`);
  await red.getByTestId("geo-duel-clock").waitFor();
  await red.waitForTimeout(400);
  await red.screenshot({ path: `${OUT}/duel-round-${tag}.png` });
  // An emote from Red pops by Red's avatar on Blue's screen.
  await red.getByTestId("geo-emote-button").click();
  await red.getByTestId("geo-emote-pika").waitFor();
  await red.waitForTimeout(300);
  await red.screenshot({ path: `${OUT}/duel-emotes-${tag}.png` });
  await red.getByTestId("geo-emote-pika").click();
  await blue.getByTestId("geo-emote-pop-0").waitFor({ timeout: 8_000 }).catch(() => errors.push("Blue never saw Red's emote"));
  await pinAndGuess(red, phone, 0.5);
  // Blue sees the opponent-guessed bar (Turbo: at most 10 s).
  const bar = blue.getByTestId("geo-opponent-guessed");
  await bar.waitFor({ timeout: 8_000 });
  const barText = await bar.innerText();
  const secs = Number(barText.match(/(\d+) s to guess/i)?.[1] ?? NaN);
  if (!(secs > 0 && secs <= (turbo ? 10 : 15))) errors.push(`the opponent-guessed bar reads "${barText}" (turbo: ${turbo})`);
  if (phone) await blue.screenshot({ path: `${OUT}/duel-opponent-guessed-${tag}.png` });
  await pinAndGuess(blue, phone, 0.22);

  // The reveal and its damage sequence.
  await red.getByTestId("geo-duel-reveal").waitFor({ timeout: 30_000 });
  await red.getByTestId("geo-duel-distance").waitFor({ timeout: 5_000 });
  const damaged = await red.locator("[data-testid^=geo-damage-]").first().waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (!damaged) errors.push("no damage number floated up in the reveal");
  await red.waitForTimeout(700);
  await red.screenshot({ path: `${OUT}/duel-result-${tag}.png` });
  const hurt = await red.locator("[data-testid^=geo-damage-]").first().getAttribute("data-testid");
  await red.waitForTimeout(1400);
  const seat = hurt?.slice(-1);
  if (seat !== undefined) {
    const hp = Number((await red.getByTestId(`geo-hp-value-${seat}`).innerText()).replace(/,/g, ""));
    if (!(hp < 6000)) errors.push(`the loser's HP didn't drain (${hp})`);
    const color = await red.getByTestId(`geo-fighter-${seat}`).getAttribute("data-hp-color");
    if (!color) errors.push("the fighter carries no HP colour");
  }

  // Play on to the end.
  const next = (p) => p.getByRole("button", { name: /Next round|See results/ });
  for (let i = 0; i < 12; i++) {
    await Promise.all([next(red).waitFor({ timeout: 30_000 }), next(blue).waitFor({ timeout: 30_000 })]);
    const label = await next(red).innerText();
    await Promise.all([next(red).click(), next(blue).click()]);
    if (/results/i.test(label)) break;
    await Promise.all([shotLoaded(red), shotLoaded(blue)]);
    await pinAndGuess(red, phone, 0.5);
    await pinAndGuess(blue, phone, 0.22);
  }
  await red.getByTestId("geo-duel-end").waitFor({ timeout: 15_000 });
  await red.getByTestId("geo-duel-result").filter({ hasText: /Victory!|Defeat|Draw/ }).waitFor();
  if ((await red.getByTestId("geo-duel-table").count()) !== 1) errors.push("the end screen has no damage table");
  if ((await red.getByTestId("geo-hp-timeline").count()) !== 1) errors.push("the end screen has no HP timeline");
  if (!(await red.getByRole("button", { name: /^Rematch$/ }).isVisible())) errors.push("the end screen has no Rematch button");
  await red.waitForTimeout(900);
  await red.screenshot({ path: `${OUT}/duel-end-${tag}.png`, fullPage: true });
  await blue.getByTestId("geo-duel-end").waitFor({ timeout: 15_000 });
  // Post-game taunts: Red dances, and Blue sees it on Red's trainer.
  await red.getByTestId("taunt-stage").waitFor();
  if ((await red.locator("[data-testid=taunt-stage] [data-testid=versus-character]").count()) !== 2) errors.push("the end screen doesn't show both trainers");
  if ((await red.getByTestId("avatar-3d-partner").count()) !== 0) errors.push("the end screen shows a partner sprite");
  await red.getByTestId("taunt-dab").click();
  await blue
    .locator('[data-testid="taunt-trainer-them"][data-playing="dab"]')
    .waitFor({ timeout: 15_000 })
    .catch(() => errors.push("Blue never saw Red's dance"));
  if (!(await red.getByTestId("taunt-heeltap").isDisabled())) errors.push("a locked dance is usable by a guest");
  await red.screenshot({ path: `${OUT}/duel-taunt-${tag}.png` });
  await red.context().close();
  await blue.context().close();
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

/** Joins a party's lobby by its link as `name`. */
async function joinParty(p, url, name) {
  await p.goto(url, { waitUntil: "networkidle" });
  await p.getByTestId("party-lobby").waitFor().catch(async (e) => { await p.screenshot({ path: `${OUT}/fail-lobby-${name}.png` }); console.log(await p.evaluate(() => document.body.innerText.slice(0, 400))); throw e; });
  await p.getByLabel("Your trainer name").fill(name, { timeout: 20_000 }).catch(async (e) => { await p.screenshot({ path: `${OUT}/fail-join-${name}.png`, fullPage: true }); throw e; });
  await p.getByTestId("party-join").click();
  await p.getByTestId("party-leave").waitFor({ timeout: 15_000 });
}

/** Presses Next on every page whose trainer is still in. */
async function pressNext(pages) {
  await Promise.all(
    pages.map(async (p) => {
      const next = p.getByTestId("party-next");
      if (!(await next.isVisible().catch(() => false))) return;
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
    })
  );
}

/** What a page shows now: a round, a reveal or the standings (waits through intros). */
async function phaseOf(p) {
  for (let i = 0; i < 120; i++) {
    if (await p.getByTestId("party-end").isVisible().catch(() => false)) return "end";
    if (await p.getByTestId("party-reveal").isVisible().catch(() => false)) return "reveal";
    if (await p.getByTestId("party-band").isVisible().catch(() => false)) return "round";
    await p.waitForTimeout(500);
  }
  throw new Error("the party never moved on");
}

async function royale(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  const [red, blue, green] = await Promise.all([0, 1, 2].map((i) => newPage({ width, height }, i ? { reducedMotion: "reduce" } : {})));
  step(`party: Battle Royale at ${tag}`);
  await red.goto(`${BASE}/guessr?region=kanto`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  const card = red.getByTestId("geo-party-card");
  await card.waitFor();
  if (await card.getAttribute("aria-disabled")) errors.push("the hub's Party card is still disabled");
  await red.getByTestId("geo-open-party").click();
  await red.getByTestId("geo-party-new").waitFor();
  await red.waitForTimeout(800);
  await red.screenshot({ path: `${OUT}/party-hub-${tag}.png` });
  await red.getByTestId("geo-party-name").fill("Red");
  await red.getByTestId("geo-party-create").click();
  await red.waitForURL(/\/guessr\/party\/[a-z2-9]{6}$/, { timeout: 20_000 });
  const url = red.url();
  await red.getByTestId("party-lobby").waitFor();
  // The host sets up a quick game: one life, a 30 s round, 10 s after the first pin.
  for (const id of ["party-set-lives-1", "party-set-timer-30", "party-set-countdown-10"]) {
    await red.getByTestId(id).click();
    await red.locator(`[data-testid=${id}][aria-checked=true]`).waitFor({ timeout: 8_000 });
  }
  await joinParty(blue, url, "Blue");
  await joinParty(green, url, "Green");
  await red.getByTestId("party-seat-2").waitFor({ timeout: 15_000 });
  if (await blue.getByTestId("party-start").count()) errors.push("a guest sees the host's Start button");
  // A trainer who reloads keeps their seat.
  await green.reload({ waitUntil: "networkidle" });
  await green.getByTestId("party-leave").waitFor({ timeout: 30_000 }).catch(async () => { await green.screenshot({ path: `${OUT}/fail-reload.png`, fullPage: true }); throw new Error("Green lost the seat on reload"); });
  await red.waitForTimeout(1500);
  await red.screenshot({ path: `${OUT}/party-lobby-${tag}.png`, fullPage: true });
  await blue.screenshot({ path: `${OUT}/party-lobby-guest-${tag}.png`, fullPage: true });
  await red.getByTestId("party-start").click();

  await red.getByTestId("party-lineup").waitFor({ timeout: 15_000 });
  await red.waitForTimeout(1500);
  await red.screenshot({ path: `${OUT}/party-lineup-${tag}.png` });

  // Round 1: Red and Blue guess, Green doesn't (and, on one life, goes out unless everyone ties).
  await Promise.all([shotLoaded(red), shotLoaded(blue), shotLoaded(green)]);
  await red.getByTestId("party-band").waitFor();
  await red.waitForTimeout(400);
  await red.screenshot({ path: `${OUT}/party-round-${tag}.png` });
  await red.getByTestId("geo-emote-button").click();
  await red.getByTestId("geo-emote-pika").click();
  await blue.getByTestId("party-emote-0").waitFor({ timeout: 8_000 }).catch(() => errors.push("Blue never saw Red's emote"));
  await pinAndGuess(red, phone, 0.5);
  await pinAndGuess(blue, phone, 0.35);
  await red.locator("[data-testid=party-roster-1][data-guessed=true]").waitFor({ timeout: 8_000 }).catch(() => errors.push("the roster doesn't tick off Blue's guess"));
  await red.getByTestId("party-reveal").waitFor({ timeout: 30_000 });
  await red.waitForTimeout(2200);
  await red.screenshot({ path: `${OUT}/party-reveal-${tag}.png` });
  const headline = await red.getByTestId("party-headline").innerText();
  if (!/out|life|Even/i.test(headline)) errors.push(`the reveal's headline reads "${headline}"`);

  // On to the end: Red always guesses, Blue in odd rounds; whoever is out watches.
  let sawSpectator = false;
  for (let i = 0; i < 12; i++) {
    const phase = await phaseOf(red);
    if (phase === "end") break;
    if (phase === "reveal") {
      if (/See standings/.test(await red.getByTestId("party-next").innerText())) {
        await red.getByTestId("party-next").click();
        break;
      }
      await pressNext([red, blue, green]);
      await red.getByTestId("party-reveal").waitFor({ state: "hidden", timeout: 30_000 });
      continue;
    }
    await shotLoaded(red);
    if (!sawSpectator && (await green.getByTestId("party-spectating").isVisible().catch(() => false))) {
      sawSpectator = true;
      await green.waitForTimeout(400);
      await green.screenshot({ path: `${OUT}/party-spectating-${tag}.png` });
    }
    await pinAndGuess(red, phone, 0.5);
    if (i % 2 === 1 && (await blue.getByTestId("geo-dock").isVisible().catch(() => false))) await pinAndGuess(blue, phone, 0.4).catch(() => {});
    await red.getByTestId("party-reveal").waitFor({ timeout: 40_000 });
  }
  await red.getByTestId("party-end").waitFor({ timeout: 30_000 });
  if (!sawSpectator) errors.push("the trainer who went out never watched a round");
  await red.getByTestId("party-result").waitFor();
  if ((await red.locator("[data-testid^=party-standing-]").count()) !== 3) errors.push("the standings don't list all three trainers");
  await blue.getByTestId("party-next").click().catch(() => {});
  await blue.getByTestId("party-end").waitFor({ timeout: 20_000 });
  // Post-game taunts reach the others.
  await red.getByTestId("party-taunt-dab").click();
  await blue
    .locator('[data-testid="party-trainer-0"][data-playing="dab"]')
    .waitFor({ timeout: 15_000 })
    .catch(() => errors.push("Blue never saw Red's dance"));
  await red.waitForTimeout(800);
  await red.screenshot({ path: `${OUT}/party-end-${tag}.png`, fullPage: true });
  // Play again: back to the lobby for everyone.
  await red.getByTestId("party-again").click();
  await blue.getByTestId("party-lobby").waitFor({ timeout: 20_000 }).catch(() => errors.push("Play again didn't bring Blue back to the lobby"));
  for (const p of [red, blue, green]) await p.context().close();
}

async function teamDuel(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  // Four pages of 3D trainers drawn in software are a lot for one test machine: they hold still (reduced motion).
  const pages = await Promise.all([0, 1, 2, 3].map((i) => newPage({ width, height }, i ? { reducedMotion: "reduce" } : {})));
  const [red, blue, green, gold] = pages;
  step(`party: team duel 2v2 at ${tag}`);
  await red.goto(`${BASE}/guessr?region=kanto`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  await red.getByTestId("geo-open-duels").click();
  await red.getByTestId("geo-duel-mode-team").click();
  await red.getByLabel("Your trainer name").first().fill("Red");
  await red.getByRole("button", { name: /Create duel/ }).click();
  await red.waitForURL(/\/guessr\/party\/[a-z2-9]{6}$/, { timeout: 20_000 });
  const url = red.url();
  await red.locator("[data-testid=party-set-mode-team][aria-checked=true]").waitFor();
  for (const id of ["party-set-rounds-5", "party-set-timer-30", "party-set-countdown-10"]) {
    await red.getByTestId(id).click();
    await red.locator(`[data-testid=${id}][aria-checked=true]`).waitFor({ timeout: 8_000 });
  }
  await joinParty(blue, url, "Blue");
  await joinParty(green, url, "Green");
  await joinParty(gold, url, "Gold");
  // Seats alternate teams: Red and Green on red, Blue and Gold on blue.
  await red.locator("[data-testid=party-team-1] [data-testid=party-seat-3]").waitFor({ timeout: 15_000 });
  if ((await red.locator("[data-testid=party-team-0] [data-testid^=party-seat-]").count()) !== 2) errors.push("the red team doesn't have two trainers");
  await red.waitForTimeout(1500);
  await red.screenshot({ path: `${OUT}/party-team-lobby-${tag}.png`, fullPage: true });
  await red.getByTestId("party-start").click();
  await red.getByTestId("party-lineup").waitFor({ timeout: 15_000 });
  await red.waitForTimeout(1500);
  await red.screenshot({ path: `${OUT}/party-team-lineup-${tag}.png` });

  for (let i = 0; i < 12; i++) {
    const phase = await phaseOf(red);
    if (phase === "end") break;
    if (phase === "reveal") {
      if (i === 1) {
        await red.waitForTimeout(2000);
        await red.screenshot({ path: `${OUT}/party-team-reveal-${tag}.png` });
      }
      if (/See standings/.test(await red.getByTestId("party-next").innerText())) {
        await red.getByTestId("party-next").click();
        break;
      }
      await pressNext(pages);
      await red.getByTestId("party-reveal").waitFor({ state: "hidden", timeout: 30_000 });
      continue;
    }
    await Promise.all(pages.map((p) => shotLoaded(p)));
    if (i === 0) {
      // Green drops a pin: teammate Red sees it before anyone locks in; Blue (the other team) doesn't.
      if (phone) {
        await green.getByTestId("geo-map-pill").click();
        await green.locator("[data-testid=geo-dock][data-open=true]").waitFor();
        await green.waitForTimeout(350);
      } else {
        const dock = await green.getByTestId("geo-dock").boundingBox();
        await green.mouse.move(dock.x + dock.width / 2, dock.y + dock.height / 2, { steps: 4 });
        await green.waitForTimeout(700);
      }
      const map = green.locator("[role=application]");
      const box = await map.boundingBox();
      await map.click({ position: { x: box.width * 0.45, y: box.height * 0.5 } });
      await red.locator("[data-testid=geo-other-pin]").first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => errors.push("Red never saw teammate Green's pin"));
      if ((await blue.locator("[data-testid=geo-other-pin]").count()) > 0) errors.push("Blue sees the other team's pin before the reveal");
      if (!phone) {
        const dock = await red.getByTestId("geo-dock").boundingBox();
        await red.mouse.move(dock.x + dock.width / 2, dock.y + dock.height / 2, { steps: 4 });
        await red.waitForTimeout(900);
      }
      await red.screenshot({ path: `${OUT}/party-team-round-${tag}.png` });
      await green.getByTestId("geo-guess").click();
    } else {
      await pinAndGuess(green, phone, 0.45);
    }
    await pinAndGuess(red, phone, 0.5);
    await pinAndGuess(blue, phone, 0.1);
    await pinAndGuess(gold, phone, 0.15);
    await red.getByTestId("party-reveal").waitFor({ timeout: 40_000 });
  }
  await red.getByTestId("party-end").waitFor({ timeout: 30_000 });
  await red.getByTestId("party-result").filter({ hasText: /Victory!|Defeat|Draw/ }).waitFor();
  if ((await red.locator("[data-testid^=party-standing-]").count()) !== 4) errors.push("the team standings don't list all four trainers");
  await red.waitForTimeout(900);
  await red.screenshot({ path: `${OUT}/party-team-end-${tag}.png`, fullPage: true });
  for (const p of pages) await p.context().close();
}

/** E2E_ONLY=solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390 runs a subset. */
const only = (process.env.E2E_ONLY ?? "solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390").split(",");
try {
  if (only.includes("solo1440")) await solo(1440, 900);
  if (only.includes("weekly1440")) await weekly(1440, 900);
  if (only.includes("weekly390")) await weekly(390, 844);
  if (only.includes("duel1440")) await duel(1440, 900, { turbo: false });
  if (only.includes("solo390")) await solo(390, 844);
  if (only.includes("duel390")) await duel(390, 844, { turbo: true });
  if (only.includes("royale1440")) await royale(1440, 900);
  if (only.includes("team1440")) await teamDuel(1440, 900);
  if (only.includes("royale390")) await royale(390, 844);
  if (only.includes("team390")) await teamDuel(390, 844);
} catch (err) {
  errors.push(`FAILED: ${err?.stack ?? err}`);
} finally {
  await browser.close();
  if (errors.length > 0) {
    console.error(`✗ ${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✓ PokéGuessr UI OK. Screenshots in ${OUT}/`);
  process.exit(0);
}
