/**
 * PokéGuessr's in-game UI, end to end against a running build: a solo round
 * (map docked and hovered), its result and summary, then a duel (versus intro,
 * round, the reveal with its damage sequence, Turbo, an emote, the end screen
 * and its post-game dances), and the background music (gesture, mute, Music
 * off, carrying on between rounds),
 * at a desktop and a phone size, with a screenshot of each screen. Fails on
 * any console or page error.
 *
 *   npm run build && npm start      # in another terminal
 *   node scripts/e2e-guessr.mjs [baseUrl] [outDir]
 *
 * Set CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { chromium, request } from "playwright";
import fs from "fs";
import { tapGuessMap } from "./e2e-geo-map.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/**
 * `noWebGL`: a browser without WebGL (its 3D trainers show their flat look).
 * Party guests use it: this machine draws WebGL in software, and four pages of
 * 3D trainers starting at once hold every page's main thread for longer than a
 * party waits for a silent trainer (30 s), so the server rightly drops them.
 */
async function newPage(viewport, { noWebGL = false, ...extra } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768, ...extra });
  await context.addInitScript(() => sessionStorage.setItem("pokeiq-splash", "1"));
  if (noWebGL) {
    await context.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(type) ? null : get.call(this, type, ...rest);
      };
    });
  }
  const page = await context.newPage();
  page.on("console", (msg) => {
    // Without WebGL, three.js reports each 3D trainer it couldn't start (they show their flat look instead).
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text()) && !(noWebGL && /Error creating WebGL context/.test(msg.text()))) errors.push(`[${page.url()}] ${msg.text()}`);
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

/** The solo setup (maps, games, rounds, difficulty) is folded under "Set up a game": opens it, trying again if a click lands before hydration. */
async function openGeoSetup(p) {
  for (let i = 0; i < 5; i++) {
    if (await p.getByTestId("geo-solo").isVisible().catch(() => false)) return;
    await p.getByTestId("geo-solo-setup").click();
    if (await p.getByTestId("geo-solo").waitFor({ timeout: 3_000 }).then(() => true, () => false)) return;
  }
  throw new Error("Set up a game didn't open the solo setup");
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

/** Drops a pin `at` of the way across the map's own area (along its middle) and presses Guess: through the dock, or the phone's sheet. */
async function pinAndGuess(p, phone, at, shots) {
  if (phone) {
    // The big map button in the bottom bar opens the map card; its check stays dim until a pin is down.
    await p.getByTestId("geo-map-pill").click({ timeout: 15_000 }).catch(async (e) => {
      await p.screenshot({ path: `${OUT}/fail-minimap.png` });
      throw e;
    });
    await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
    await p.waitForTimeout(350);
    if (shots) {
      await p.screenshot({ path: `${OUT}/${shots}-map.png` });
      if (!(await p.locator("[data-testid=geo-guess][disabled]").count())) errors.push("phone: the guess check is live before a pin is down");
    }
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
  // Along the map's middle: on a phone the world sits in a band across the sheet. The tap waits for the map to take taps.
  const { area, at: spot } = await tapGuessMap(p, at, 0.5);
  // The phone's pill also reads "Guess": the button under the map is the one.
  const guess = p.getByTestId("geo-guess");
  await guess.waitFor();
  const enabled = await p.locator("[data-testid=geo-guess]:not([disabled])").waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (!enabled) {
    await p.screenshot({ path: `${OUT}/fail-pin.png` });
    throw new Error(`Guess stays disabled after a pin (${await p.getByTestId("geo-round").innerText().catch(() => "?")}, at ${JSON.stringify(spot)} in ${JSON.stringify(area)})`);
  }
  if (phone && shots) await phoneMapGuess(p);
  await guess.click();
}

/**
 * A phone round, the GeoGuessr way: a solid bottom bar with the round's tools
 * and one big map button; the map opens as a large card over the picture under
 * a "Tap the map" label, and the map button becomes a round check that guesses.
 * Closing the card keeps the pin; the map button shows a pin is down.
 */
async function phoneMapGuess(p) {
  const vp = p.viewportSize();
  const card = await p.getByTestId("geo-dock").boundingBox();
  if (card.width < vp.width * 0.85 || card.width >= vp.width || card.height < vp.height * 0.5) errors.push(`phone: the map card isn't a large card with the picture around it (${JSON.stringify(card)})`);
  if (!(await p.getByTestId("geo-map-hint").isVisible())) errors.push("phone: no 'Tap the map' label over the map card");
  if (!(await p.getByTestId("geo-round").isVisible())) errors.push("phone: the round badge hides behind the map card");
  if (!(await p.getByTestId("geo-bar").isVisible())) errors.push("phone: the bottom bar goes away when the map opens");
  await p.getByTestId("geo-map-collapse").click();
  await p.locator("[data-testid=geo-dock]:not([data-open])").waitFor();
  await p.getByTestId("geo-map-pill").waitFor();
  if (!(await p.getByTestId("geo-map-pinned").isVisible())) errors.push("phone: the map button doesn't show the pin is down");
  // Nothing else on the page moves: no scroll behind the game, no header or tab bar showing.
  const page = await p.evaluate(() => ({
    y: window.scrollY,
    header: getComputedStyle(document.querySelector("body > header") ?? document.body).display,
    tabbar: document.querySelector('[data-testid="tabbar"]') ? getComputedStyle(document.querySelector('[data-testid="tabbar"]')).display : "none",
  }));
  if (page.y !== 0) errors.push(`phone: the page scrolled behind the game (${page.y})`);
  if (page.header !== "none" || page.tabbar !== "none") errors.push(`phone: the site header or tab bar is still up in a round (${page.header}, ${page.tabbar})`);
  await p.screenshot({ path: `${OUT}/guessr-round-pinned-${vp.width}.png` });
  // The map opens again with the pin kept, and the check guesses.
  await p.getByTestId("geo-map-pill").click();
  await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
  await p.waitForTimeout(300);
  if (await p.locator("[data-testid=geo-guess][disabled]").count()) errors.push("phone: the pin was lost when the map closed");
}

// ---------------------------------------------------------------------------
// Solo
// ---------------------------------------------------------------------------

/**
 * The round's HUD, GeoGuessr's: a 01:30 countdown pill centred under the notch
 * (a dial in the phone's top-left capsule), and the score tracker top right
 * (round slots, the current one lit, and the total), or on a phone the
 * compact "Round 2/5 · 3,412" readout, clear of the round badge and the bar.
 */
async function checkRoundHud(p, phone, round, total) {
  const clock = await p.getByTestId("geo-time-left").innerText().catch(() => "");
  const [, m, s] = clock.match(/^(\d\d):(\d\d)$/) ?? [];
  const left = Number(m) * 60 + Number(s);
  if (!(left > 75 && left <= 90)) errors.push(`round ${round}: the timer reads "${clock}", not about 01:30`);
  const box = (id) => p.getByTestId(id).first().boundingBox();
  const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const timer = await p.locator("[role=timer]").first().boundingBox();
  const vp = p.viewportSize();
  if (phone) {
    const readout = await p.getByTestId("geo-score-chip").innerText();
    if (!new RegExp(`Round ${round}/5\\s*·\\s*${total.toLocaleString("en-US")}`).test(readout.replace(/\n/g, " "))) errors.push(`phone: the readout says "${readout}"`);
    const [chip, badge, bar] = await Promise.all([box("geo-score-chip"), box("geo-round"), box("geo-bar")]);
    if (overlap(chip, badge) || overlap(chip, bar) || chip.x + chip.width > vp.width) errors.push(`phone: the readout runs into the round badge or the bar (${JSON.stringify({ chip, badge })})`);
  } else {
    const notch = await box("geo-notch");
    if (!timer || Math.abs(timer.x + timer.width / 2 - (notch.x + notch.width / 2)) > 2 || timer.y < notch.y + notch.height - 1) errors.push(`the timer pill isn't centred under the notch (${JSON.stringify({ timer, notch })})`);
    const tracker = await box("geo-score-chip");
    if (overlap(tracker, notch) || tracker.x + tracker.width > vp.width - 8) errors.push(`the score tracker runs into the notch or off screen (${JSON.stringify({ tracker, notch })})`);
    if ((await p.locator("[data-testid^=geo-score-slot-]").count()) !== 5) errors.push("the score tracker has no slot for each of 5 rounds");
    if ((await p.getByTestId(`geo-score-slot-${round}`).getAttribute("data-current")) !== "true") errors.push(`the tracker doesn't light round ${round}`);
    const shown = Number((await p.getByTestId("geo-score-chip").getByTestId("geo-score-total").innerText()).replace(/\D/g, ""));
    if (shown !== total) errors.push(`the tracker's total reads ${shown}, not ${total}`);
  }
}

/**
 * The guess map's location dots: none on the whole world (the resting corner
 * map, or hovered), then fading in as it's zoomed, once there's room for them
 * (the engine counts the dots it draws on the canvas's data-dots).
 */
async function checkDots(p, tag) {
  const dots = () => p.locator("[data-testid=geo-dock] canvas").evaluate((c) => Number(c.dataset.dots ?? -1));
  await p.locator("[data-testid=geo-dock] [role=application][data-ready]").waitFor({ timeout: 30_000 });
  await p.waitForTimeout(300);
  if ((await dots()) !== 0) errors.push(`dots: the resting world map shows ${await dots()} dots`);
  const dock = await p.getByTestId("geo-dock").boundingBox();
  await p.mouse.move(dock.x + dock.width / 2, dock.y + dock.height / 2, { steps: 4 });
  await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
  await p.waitForTimeout(500);
  if ((await dots()) !== 0) errors.push(`dots: the whole world, hovered, shows ${await dots()} dots`);
  const zoomIn = p.getByTestId("geo-dock").getByRole("button", { name: "Zoom in" });
  const counts = [];
  for (let i = 0; i < 4; i++) {
    await zoomIn.click();
    await p.waitForTimeout(450);
    counts.push(await dots());
  }
  if (!(counts[3] > 0 && counts[3] >= counts[1])) errors.push(`dots: zooming in doesn't bring dots in (${counts.join(", ")})`);
  await p.screenshot({ path: `${OUT}/guessr-dots-${tag}.png` });
  // Back to the whole map, and the dots go again.
  await p.getByTestId("geo-dock").getByRole("button", { name: "Show the whole map" }).click().catch(() => {});
  await p.waitForTimeout(900);
  if ((await dots()) !== 0) errors.push(`dots: back on the whole world, ${await dots()} dots stay`);
  await p.mouse.move(120, 320);
  await p.waitForTimeout(800);
}

async function solo(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  const page = await newPage({ width, height });
  step(`solo at ${tag}`);
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  await openGeoSetup(page);
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
  await page.getByTestId(phone ? "geo-round" : "geo-notch").waitFor();
  if (!/round\s*1/i.test(await page.getByTestId("geo-round").innerText())) errors.push("the round badge doesn't say Round 1");
  await checkRoundHud(page, phone, 1, 0);
  // (A phone has no Guess button until its map is open.)
  if (!phone && !(await page.getByRole("button", { name: /Place your pin/ }).isDisabled().catch(() => true))) errors.push("Guess is enabled before a pin");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/guessr-round-${tag}.png` });
  if (!phone) await checkDots(page, tag);
  await pinAndGuess(page, phone, 0.5, `guessr-round-${tag}`);
  await page.getByTestId("geo-reveal").waitFor();
  await page.getByTestId("geo-next").waitFor();
  // The result map draws once it has its size (a frame or two after it mounts).
  await page.getByTestId("geo-reveal-line").first().waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
  if ((await page.getByTestId("geo-reveal-line").count()) !== 1) errors.push("the result map draws no line");
  // The line draws, the camera fits, the score counts up.
  await page.waitForTimeout(2700);
  if (!(await page.getByTestId("geo-answer-place").innerText()).trim()) errors.push("the reveal names no place");
  if (!/Pokémon /.test(await page.getByTestId("geo-answer-game").innerText())) errors.push("the reveal names no game");
  await page.screenshot({ path: `${OUT}/guessr-result-${tag}.png` });
  // The tracker's first slot holds the round's score (desktop: it fills during the reveal).
  const first = Number((await page.getByTestId("geo-round-score").innerText()).replace(/\D/g, ""));
  if (!phone) {
    const slot = Number((await page.getByTestId("geo-score-slot-1").innerText()).split("\n").pop().replace(/\D/g, ""));
    if (slot !== first) errors.push(`the score tracker's first slot reads ${slot}, the round scored ${first}`);
  }
  // Space goes on.
  await page.keyboard.press("Space");
  await shotLoaded(page);
  await checkRoundHud(page, phone, 2, first);
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
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  for (const id of ["play", "multiplayer", "maps", "you"]) await page.getByTestId(`geo-hub-${id}`).waitFor();
  for (const id of ["geo-solo-card", "geo-daily-card", "geo-weekly-card", "region-streak-card", "geo-duels-card", "geo-ranked-tile", "geo-party-card", "globe-card", "geo-history-link"]) {
    if ((await page.getByTestId(id).count()) !== 1) errors.push(`the hub has no ${id}`);
  }
  if ((await page.getByTestId("geo-history-link").getAttribute("href")) !== "/pokeguessr/history") errors.push("the duel history link doesn't go to /pokeguessr/history");
  await page.getByTestId("geo-achievements").waitFor({ timeout: 15_000 });
  await page.getByTestId("geo-mastery").waitFor();
  // The hub has no second map picker: maps are chosen in the solo setup.
  if (await page.locator('[data-testid^="geo-map-tile-"]').count()) errors.push("the hub still shows a map grid");
  // The solo setup is folded away under "Set up a game" until asked for.
  if (await page.getByTestId("geo-solo").count()) errors.push("the solo setup shows before Set up a game is pressed");
  if ((await page.getByTestId("geo-solo-setup").getAttribute("aria-expanded")) !== "false") errors.push("Set up a game doesn't say it's folded");
  await openGeoSetup(page);
  if ((await page.getByTestId("geo-solo-setup").getAttribute("aria-expanded")) !== "true") errors.push("Set up a game doesn't say it's open");
  await page.getByRole("radio", { name: "Johto" }).first().click();
  await page.getByRole("radio", { name: "Johto", checked: true }).waitFor();
  // The Ranked tile opens the duel panel on the ranked queue.
  await page.getByTestId("geo-open-ranked").click();
  await page.getByTestId("geo-ranked-card").waitFor();
  await page.getByTestId("geo-duel-queue-casual").click();
  const label = await page.getByTestId("geo-weekly-card").innerText();
  if (!/Weekly #\d+/i.test(label)) errors.push(`the weekly card has no number: ${label}`);
  await page.getByTestId("geo-weekly-play").click();
  await shotLoaded(page);
  if (!/Weekly #\d+/i.test(await page.getByTestId(phone ? "geo-round-mode" : "geo-notch").innerText())) errors.push("the weekly game's round header doesn't say Weekly");
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
  await red.goto(`${BASE}/pokeguessr?region=kanto`, { waitUntil: "networkidle" });
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
    if (await red.waitForURL(/\/pokeguessr\/duel\/[a-z2-9]{8}$/, { timeout: 10_000 }).then(() => true, () => false)) break;
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
    if (/results/i.test(label)) {
      await Promise.all([next(red).click(), next(blue).click()]);
      break;
    }
    // A round also starts by itself when Next's countdown runs out (or once both have pressed): then there's no button left to press.
    await Promise.all([next(red).click({ timeout: 5_000 }).catch(() => {}), next(blue).click({ timeout: 5_000 }).catch(() => {})]);
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
  const [red, blue, green] = await Promise.all([0, 1, 2].map((i) => newPage({ width, height }, i ? { reducedMotion: "reduce", noWebGL: true } : {})));
  step(`party: Battle Royale at ${tag}`);
  await red.goto(`${BASE}/pokeguessr?region=kanto`, { waitUntil: "networkidle" });
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
  await red.waitForURL(/\/pokeguessr\/party\/[a-z2-9]{6}$/, { timeout: 20_000 });
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
  // Four pages of 3D trainers drawn in software are a lot for one test machine: the host's are 3D, the guests' flat (see newPage).
  const pages = await Promise.all([0, 1, 2, 3].map((i) => newPage({ width, height }, i ? { reducedMotion: "reduce", noWebGL: true } : {})));
  const [red, blue, green, gold] = pages;
  step(`party: team duel 2v2 at ${tag}`);
  await red.goto(`${BASE}/pokeguessr?region=kanto`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  await red.getByTestId("geo-open-duels").click();
  await red.getByTestId("geo-duel-mode-team").click();
  await red.getByLabel("Your trainer name").first().fill("Red");
  await red.getByRole("button", { name: /Create duel/ }).click();
  await red.waitForURL(/\/pokeguessr\/party\/[a-z2-9]{6}$/, { timeout: 20_000 });
  const url = red.url();
  await red.locator("[data-testid=party-set-mode-team][aria-checked=true]").waitFor();
  for (const id of ["party-set-rounds-5", "party-set-timer-30", "party-set-countdown-10"]) {
    await red.getByTestId(id).click();
    await red.locator(`[data-testid=${id}][aria-checked=true]`).waitFor({ timeout: 8_000 });
  }
  await joinParty(blue, url, "Blue");
  await joinParty(green, url, "Green");
  await joinParty(gold, url, "Gold");
  // A browser without WebGL never leaves a trainer's spot empty: each gives way to its flat look.
  await blue
    .waitForFunction(() => {
      const all = [...document.querySelectorAll("[data-testid=party-lobby] [data-testid=versus-character]")];
      return all.length >= 3 && all.every((e) => e.dataset.kind !== "trainer");
    }, null, { timeout: 15_000 })
    .catch(() => errors.push("without WebGL a party trainer stays empty instead of showing their flat look"));
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
      await tapGuessMap(green, 0.45, 0.5);
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
  if (!(await red.getByTestId("party-share").isVisible().catch(() => false))) errors.push("the team duel's end has no way to share the result");
  await red.waitForTimeout(900);
  await red.screenshot({ path: `${OUT}/party-team-end-${tag}.png`, fullPage: true });
  for (const p of pages) await p.context().close();
}

// ---------------------------------------------------------------------------
// The Daily's crowd map: a few other trainers' runs seeded through the API,
// then today's Daily played to the end, where the map shows where they pinned
// ---------------------------------------------------------------------------

/** One trainer's whole Daily through the API (their own cookies, so their own device key), pins near (cx, cy). */
async function seedDaily(date, cx, cy) {
  const api = await request.newContext({ baseURL: BASE });
  const started = await api.post("/api/geo", { data: { daily: date } });
  if (!started.ok()) throw new Error(`seeding: the Daily didn't start (${started.status()})`);
  let { token } = await started.json();
  for (let i = 0; i < 5 && token; i++) {
    const x = Math.min(1, Math.max(0, cx + (Math.random() - 0.5) * 0.04));
    const y = Math.min(1, Math.max(0, cy + (Math.random() - 0.5) * 0.04));
    const res = await api.post("/api/geo/guess", { data: { token, x, y } });
    if (!res.ok()) throw new Error(`seeding: a guess failed (${res.status()})`);
    const body = await res.json();
    token = body.done ? null : body.token;
  }
  await api.dispose();
}

async function crowd(width, height) {
  const phone = width < 768;
  const tag = `${width}`;
  const page = await newPage({ width, height });
  step(`daily crowd map at ${tag}`);
  // Nobody may read today's map without a finished Daily.
  const date = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const early = await page.request.get(`${BASE}/api/geo/crowd?date=${date}`);
  if (early.status() !== 403) errors.push(`crowd map: today's map answered without a finished Daily (${early.status()})`);
  for (const [cx, cy] of [[0.42, 0.45], [0.44, 0.47], [0.6, 0.4]]) await seedDaily(date, cx, cy);
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  await page.getByTestId("geo-daily-card").getByRole("button").first().click();
  for (let i = 0; i < 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, phone, 0.4 + i * 0.05);
    const next = page.getByTestId("geo-next");
    await next.waitFor();
    const text = await next.innerText();
    await next.click();
    if (/summary|results/i.test(text)) break;
  }
  const card = page.getByTestId("geo-crowd");
  await card.waitFor({ timeout: 15_000 });
  await card.getByTestId("geo-crowd-layer").waitFor({ timeout: 15_000 });
  if (!/\d+ trainers pinned round 1/.test(await page.getByTestId("geo-crowd-count").innerText())) errors.push("crowd map: no pin count for round 1");
  const tabs = await page.locator("[data-testid^=geo-crowd-round-]").count();
  if (tabs !== 5) errors.push(`crowd map: ${tabs} round tabs, expected 5`);
  await page.getByTestId("geo-crowd-round-3").click();
  if (!/round 3/.test(await page.getByTestId("geo-crowd-count").innerText())) errors.push("crowd map: picking round 3 didn't switch the map");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) errors.push(`crowd map: the page scrolls sideways by ${overflow}px`);
  const png = await page.request.get(`${BASE}/api/geo/crowd/card?date=${date}&round=3`);
  if (png.status() !== 403) errors.push(`crowd map: the share card answered without a finished Daily (${png.status()})`);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await card.screenshot({ path: `${OUT}/guessr-crowd-${tag}.png` });
  await page.screenshot({ path: `${OUT}/guessr-crowd-summary-${tag}.png`, fullPage: true });
  await page.context().close();
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

/** Records the page's media elements and audio contexts, so the test can see what is really playing. */
async function watchAudio(context) {
  await context.addInitScript(() => {
    window.__media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!window.__media.includes(this)) window.__media.push(this);
      return play.apply(this, args);
    };
    const Ctor = window.AudioContext;
    if (Ctor) {
      window.__contexts = [];
      window.AudioContext = class extends Ctor {
        constructor(...args) {
          super(...args);
          window.__contexts.push(this);
        }
      };
    }
  });
}

/** What the music is doing: the player's state, and each guessr track element's file, time and whether it's paused. */
const musicNow = (p) =>
  p.evaluate(() => ({
    state: document.documentElement.dataset.guessrMusic ?? "none",
    track: document.documentElement.dataset.guessrTrack ?? null,
    playing: (window.__media ?? []).filter((el) => /\/audio\/guessr\//.test(el.currentSrc || el.src) && !el.paused).map((el) => ({ src: (el.currentSrc || el.src).replace(/^.*\/audio\/guessr\//, ""), at: el.currentTime })),
    context: (window.__contexts ?? []).map((c) => c.state),
  }));

/**
 * Background music: nothing is fetched or played before a gesture; the first
 * tap starts a track (the element plays, the context runs); it carries on into
 * a game without restarting; it pauses while the tab is hidden; Music off in
 * the settings stops it and on brings it back. With the site muted, no music
 * is ever requested.
 */
async function music(width, height) {
  const phone = width < 768;
  step(`music at ${width}`);
  const page = await newPage({ width, height });
  await watchAudio(page.context());
  const requests = [];
  page.on("request", (r) => {
    if (/\/audio\/guessr\//.test(r.url())) requests.push(r.url());
  });
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // the player loads once the page is idle
  if (requests.length) errors.push(`music: a track was requested before any gesture (${requests[0]})`);
  if ((await musicNow(page)).playing.length) errors.push("music: playing before any gesture");
  await closeHowTo(page);
  await openGeoSetup(page);
  const started = await page.waitForFunction(() => document.documentElement.dataset.guessrMusic === "playing", null, { timeout: 20_000 }).then(() => true, () => false);
  if (!started) throw new Error(`music: didn't start after the first tap (${JSON.stringify(await musicNow(page))})`);
  if (!requests.some((u) => /\/audio\/guessr\/[a-z-]+\.(ogg|mp3)$/.test(u))) errors.push("music: playing, but no track was requested");
  await page.waitForTimeout(1500);
  const first = await musicNow(page);
  if (first.playing.length !== 1 || first.playing[0].at < 0.5) errors.push(`music: no track element is playing (${JSON.stringify(first)})`);
  if (!first.context.includes("running")) errors.push(`music: the audio context isn't running (${first.context})`);

  // The settings: Music is on at a low volume.
  await page.getByTestId("geo-settings").click();
  await page.getByTestId("geo-music").waitFor();
  if ((await page.getByTestId("geo-music").getAttribute("aria-checked")) !== "true") errors.push("music: the Music switch isn't on by default");
  const volume = Number(await page.getByTestId("geo-music-volume").inputValue());
  if (volume !== 35) errors.push(`music: the default volume is ${volume}, not 35`);
  await page.screenshot({ path: `${OUT}/guessr-music-settings-${width}.png` });
  // Off: it stops (a short fade) and stays off.
  await page.getByTestId("geo-music").click();
  await page.waitForTimeout(1500);
  const off = await musicNow(page);
  if (off.state !== "off" || off.playing.length) errors.push(`music: Music off didn't stop it (${JSON.stringify(off)})`);
  if ((await page.evaluate(() => localStorage.getItem("pokeiq-guessr-music"))) !== JSON.stringify({ on: false, volume: 0.35 })) errors.push("music: Music off isn't remembered");
  // On again: the same track carries on from where it paused.
  await page.getByTestId("geo-music").click();
  await page.waitForFunction(() => document.documentElement.dataset.guessrMusic === "playing", null, { timeout: 10_000 }).catch(() => errors.push("music: Music on didn't bring it back"));
  await page.keyboard.press("Escape");

  // Into a game: the music carries on, not restarted.
  await page.waitForTimeout(500);
  const before = await musicNow(page);
  await page.getByRole("button", { name: /5-round game/ }).click();
  await shotLoaded(page);
  await page.waitForTimeout(1000);
  const during = await musicNow(page);
  if (!during.playing.length || during.playing[0].src !== before.playing[0]?.src || during.playing[0].at < before.playing[0].at) errors.push(`music: the track restarted when the game began (${JSON.stringify(before.playing)} → ${JSON.stringify(during.playing)})`);
  // A round and the next: still the same track, still going.
  await pinAndGuess(page, phone, 0.5, null);
  await page.getByTestId("geo-next").waitFor();
  await page.waitForTimeout(1200);
  await page.getByTestId("geo-next").click();
  await shotLoaded(page);
  const round2 = await musicNow(page);
  if (!round2.playing.length || round2.playing[0].src !== during.playing[0]?.src || round2.playing[0].at < during.playing[0].at) errors.push(`music: the track restarted on the next round (${JSON.stringify(during.playing)} → ${JSON.stringify(round2.playing)})`);

  // A hidden tab: paused at once; visible again: back.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  const hidden = await musicNow(page);
  if (hidden.playing.length) errors.push(`music: still playing in a hidden tab (${JSON.stringify(hidden)})`);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => document.documentElement.dataset.guessrMusic === "playing", null, { timeout: 10_000 }).catch(() => errors.push("music: didn't come back when the tab did"));
  await page.context().close();

  // Muted: no music is ever requested, whatever the player taps.
  step(`music muted at ${width}`);
  const muted = await newPage({ width, height });
  await watchAudio(muted.context());
  await muted.context().addInitScript(() => localStorage.setItem("pokeiq-muted", "1"));
  const mutedRequests = [];
  muted.on("request", (r) => {
    if (/\/audio\/guessr\//.test(r.url())) mutedRequests.push(r.url());
  });
  await muted.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(muted);
  await openGeoSetup(muted);
  await muted.getByRole("button", { name: /5-round game/ }).click();
  await shotLoaded(muted);
  await muted.waitForTimeout(3000);
  const quiet = await musicNow(muted);
  if (mutedRequests.length) errors.push(`music: requested while muted (${mutedRequests[0]})`);
  if (quiet.playing.length || quiet.state === "playing") errors.push(`music: playing while muted (${JSON.stringify(quiet)})`);
  await muted.context().close();
}

/** E2E_ONLY=music1440,music390,solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390,crowd390,crowd1440 runs a subset. */
const only = (process.env.E2E_ONLY ?? "music1440,music390,solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390,crowd390").split(",");
try {
  if (only.includes("music1440")) await music(1440, 900);
  if (only.includes("music390")) await music(390, 844);
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
  if (only.includes("crowd390")) await crowd(390, 844);
  if (only.includes("crowd1440")) await crowd(1440, 900);
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
