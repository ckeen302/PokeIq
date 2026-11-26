/**
 * PokéGuessr's in-game UI, end to end against a running build: a solo round
 * (map docked and hovered), its result and the end screen (GeoGuessr's: the
 * score over the dimmed map, the bar, BREAKDOWN and NEXT), then a duel (versus intro,
 * round, the reveal with its damage sequence, Turbo, an emote, the end screen
 * and its post-game dances), and the background music (only while a game is
 * on: silent on the hub and in lobbies, carrying on between rounds, fading out
 * when a game ends; gesture, mute, Music off),
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
import { guessMapReady, spotIn, tapGuessMap } from "./e2e-geo-map.mjs";

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
  // The hub's 3D trainer starts in software WebGL here and holds the main thread for a while: the first visit's how-to can open late.
  if (await sheet.waitFor({ state: "visible", timeout: 9000 }).then(() => true, () => false)) {
    await p.getByTestId("howto-never").click();
    await sheet.waitFor({ state: "hidden" });
  }
}

/** The solo setup (maps, games, rounds, difficulty) is folded under "Set up a game": opens it, trying again if a click lands before hydration. */
/** On a phone the landing folds its modes into dropdowns: opens any that are shut, so their cards can be pressed. */
async function openDrops(p) {
  for (const bar of await p.locator('[data-testid^="hub-drop-"][aria-expanded="false"]').all()) if (await bar.isVisible().catch(() => false)) await bar.click().catch(() => undefined);
}

async function openGeoSetup(p) {
  for (let i = 0; i < 5; i++) {
    await openDrops(p);
    if (await p.getByTestId("geo-solo").isVisible().catch(() => false)) return;
    // The first visit's how-to can open late (the page's 3D trainer is still loading): out of the way first.
    if (await p.locator(HOWTO).first().isVisible().catch(() => false)) await closeHowTo(p);
    await p.getByTestId("geo-solo-setup").click({ timeout: 10_000 }).catch(() => undefined);
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
    // Where the page sits under the round as it starts (it mustn't move while the round is played).
    await p.evaluate(() => (window.__roundScrollY = window.scrollY));
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
    if (shots) {
      // Up from the map to its size buttons, across the gap between them: it stays open.
      const grow = await p.getByTestId("geo-map-grow").boundingBox();
      await p.mouse.move(grow.x + grow.width / 2, grow.y + grow.height / 2, { steps: 8 });
      if ((await dock.getAttribute("data-open")) !== "true") errors.push("the map dock closed on the way to its size buttons");
      // Off the dock: it shrinks back at once, as quickly as it grew.
      await p.mouse.move(120, 320, { steps: 4 });
      const closed = await p.waitForFunction(() => !document.querySelector("[data-testid=geo-dock]")?.getAttribute("data-open"), null, { timeout: 150 }).then(() => true, () => false);
      if (!closed) errors.push("the map dock didn't shrink back as soon as the pointer left it");
      const back = await dock.boundingBox();
      await p.mouse.move(back.x + back.width / 2, back.y + back.height / 2, { steps: 4 });
      await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
      await p.waitForTimeout(350);
    }
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
  // The hub stays where it was under the game (nothing shifts when a game starts), and doesn't move during the round.
  if (page.y !== (await p.evaluate(() => window.__roundScrollY ?? window.scrollY))) errors.push(`phone: the page scrolled behind the game (${page.y})`);
  if (page.header !== "none" || page.tabbar !== "none") errors.push(`phone: the site header or tab bar is still up in a round (${page.header}, ${page.tabbar})`);
  await p.screenshot({ path: `${OUT}/guessr-round-pinned-${vp.width}.png` });
  // The map opens again with the pin kept, and the check guesses.
  await p.getByTestId("geo-map-pill").click();
  await p.locator("[data-testid=geo-dock][data-open=true]").waitFor();
  await p.waitForTimeout(300);
  if (await p.locator("[data-testid=geo-guess][disabled]").count()) errors.push("phone: the pin was lost when the map closed");
}

// ---------------------------------------------------------------------------
// The end screen
// ---------------------------------------------------------------------------

/** Whether a box sits inside the window (a pixel's slack). */
const inView = (b, vp) => !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;

/**
 * GeoGuessr's end screen, after a game of `rounds` rounds: no side panel; the whole map behind, dimmed and
 * blurred, with every round's line and numbered flag; the score counted up to the rounds' sum over "of N
 * points"; the bar filled to it with its marker; the rows; BREAKDOWN and NEXT bottom centre. BREAKDOWN takes the
 * dim and the panel away to the map, with the tracker (each round's score and the total) top right; B brings the
 * end screen back. Returns the score. `once`: the Daily or the Weekly (no Play again; the Daily says when the next comes).
 */
async function checkEndScreen(p, { tag, rounds, phone, once, daily }) {
  const vp = p.viewportSize();
  const end = p.getByTestId("geo-results");
  await end.waitFor({ timeout: 15_000 });
  if (await p.getByTestId("geo-results-panel").count()) errors.push(`${tag}: the results still have a side panel`);
  if ((await end.getAttribute("data-view")) !== "summary") errors.push(`${tag}: the end screen doesn't open on the score`);
  // Mid count-up: the number and the bar are on their way.
  await p.waitForTimeout(350);
  const early = Number((await p.getByTestId("geo-results-total").innerText()).replace(/\D/g, ""));
  await p.waitForTimeout(1900);
  const score = Number(await p.getByTestId("geo-results-total").getAttribute("data-value"));
  const shown = Number((await p.getByTestId("geo-results-total").innerText()).replace(/\D/g, ""));
  if (shown !== score) errors.push(`${tag}: the score counted up to ${shown}, the game scored ${score}`);
  if (score > 2000 && !(early < score)) errors.push(`${tag}: the score didn't count up (${early} at first, ${score} at the end)`);
  const max = rounds * 5000;
  const of = await p.getByTestId("geo-end-score").innerText();
  if (!of.includes(max.toLocaleString("en-US"))) errors.push(`${tag}: the end screen doesn't say "of ${max.toLocaleString("en-US")} points" (${of.replace(/\n/g, " / ")})`);
  // The bar: filled to the score, the marker at its end, a segment per round.
  const bar = await p.getByTestId("geo-end-bar").evaluate((el) => {
    const track = el.querySelector("[role=meter]").getBoundingClientRect();
    const fill = el.querySelector("[data-testid=geo-end-fill]").getBoundingClientRect();
    const marker = el.querySelector("[data-testid=geo-end-marker]").getBoundingClientRect();
    return { track: [track.x, track.width], fill: fill.width, marker: marker.x + marker.width / 2, segments: el.querySelectorAll("[role=meter] > span[aria-hidden]").length + 1 };
  });
  const share = Math.max(0, bar.fill + 6) / bar.track[1];
  if (Math.abs(share - score / max) > 0.03 && score / max > 0.02) errors.push(`${tag}: the bar is ${Math.round(share * 100)}% full for ${Math.round((score / max) * 100)}%`);
  if (Math.abs((bar.marker - bar.track[0]) / bar.track[1] - score / max) > 0.02) errors.push(`${tag}: the bar's marker isn't at the score`);
  if (bar.segments !== rounds) errors.push(`${tag}: the bar has ${bar.segments} segments for ${rounds} rounds`);
  // The map is behind it all, dimmed, with every round drawn.
  if ((await p.getByTestId("geo-end-dim").evaluate((el) => getComputedStyle(el).opacity)) !== "1") errors.push(`${tag}: the map behind the end screen isn't dimmed`);
  if ((await p.getByTestId("geo-flag-number").count()) !== rounds) errors.push(`${tag}: the map has ${await p.getByTestId("geo-flag-number").count()} numbered flags for ${rounds} rounds`);
  // The rows and the buttons.
  await p.getByTestId("geo-share-card").waitFor();
  const next = p.getByTestId("geo-results-again");
  const toggle = p.getByTestId("geo-breakdown-toggle");
  for (const [name, el] of [["NEXT", next], ["BREAKDOWN", toggle], ["the share card", p.getByTestId("geo-share-card")], ["the score", p.getByTestId("geo-end-score")]]) {
    if (!inView(await el.boundingBox(), vp)) errors.push(`${tag}: ${name} isn't on screen (${JSON.stringify(await el.boundingBox())})`);
  }
  const nb = await next.boundingBox();
  const tb = await toggle.boundingBox();
  if (Math.abs(nb.y + nb.height / 2 - (tb.y + tb.height / 2)) > 4) errors.push(`${tag}: BREAKDOWN and NEXT aren't side by side`);
  if (vp.height - (nb.y + nb.height) > vp.height * 0.2) errors.push(`${tag}: NEXT isn't at the bottom`);
  if (Math.abs(nb.x + nb.width / 2 + tb.x + tb.width / 2 - vp.width) > vp.width * 0.25) errors.push(`${tag}: BREAKDOWN and NEXT aren't centred`);
  if (!/next/i.test(await next.innerText())) errors.push(`${tag}: the big button doesn't say Next ("${await next.innerText()}")`);
  if (once && /again/i.test(await end.innerText())) errors.push(`${tag}: a game played once offers to play again`);
  if (daily && !/Next Daily in\s+\d\d:\d\d:\d\d/.test(await end.innerText())) errors.push(`${tag}: the Daily's end screen doesn't say when the next one comes`);
  const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sideways > 0) errors.push(`${tag}: the end screen scrolls sideways by ${sideways}px`);
  await p.screenshot({ path: `${OUT}/guessr-end-${tag}.png` });

  // BREAKDOWN: the map itself, every round's line, the tracker with each score and the total.
  await toggle.click();
  await p.getByTestId("geo-breakdown").waitFor();
  await p.waitForTimeout(700);
  if ((await end.getAttribute("data-view")) !== "breakdown" || (await toggle.getAttribute("aria-pressed")) !== "true") errors.push(`${tag}: BREAKDOWN didn't switch to the breakdown`);
  if ((await p.getByTestId("geo-end-dim").evaluate((el) => getComputedStyle(el).opacity)) !== "0") errors.push(`${tag}: the breakdown's map is still dimmed`);
  if ((await p.getByTestId("geo-end-panel").evaluate((el) => getComputedStyle(el).opacity)) !== "0") errors.push(`${tag}: the score panel stays over the breakdown`);
  const lines = await p.getByTestId("geo-reveal-line").count();
  if (lines < 1 || lines > rounds) errors.push(`${tag}: the breakdown draws ${lines} lines for ${rounds} rounds`);
  const cells = await p.locator("[data-testid^=geo-end-round-]").count();
  if (cells !== rounds) errors.push(`${tag}: the tracker has ${cells} rounds, the game ${rounds}`);
  const total = Number((await p.getByTestId("geo-end-tracker-total").innerText()).replace(/\D/g, ""));
  if (total !== score) errors.push(`${tag}: the tracker's total is ${total}, the score ${score}`);
  const tracker = await p.getByTestId("geo-end-tracker").boundingBox();
  if (!inView(tracker, vp) || tracker.y > vp.height * 0.25 || (!phone && tracker.x + tracker.width < vp.width * 0.6)) errors.push(`${tag}: the tracker isn't top right (${JSON.stringify(tracker)})`);
  if (!inView(await next.boundingBox(), vp)) errors.push(`${tag}: NEXT goes from the breakdown`);
  await p.screenshot({ path: `${OUT}/guessr-breakdown-${tag}.png` });
  // A round picked in the tracker: its place.
  await p.getByTestId("geo-end-round-2").click();
  const place = await p.getByTestId("geo-end-place").innerText().catch(() => "");
  if (!place.trim()) errors.push(`${tag}: picking a round in the tracker doesn't name its place`);
  await p.getByTestId("geo-end-round-2").click();
  // B: back to the end screen.
  await p.mouse.click(5, vp.height / 2).catch(() => {});
  await p.keyboard.press("b");
  await p.waitForTimeout(700);
  if ((await end.getAttribute("data-view")) !== "summary") errors.push(`${tag}: B didn't bring the end screen back`);
  if ((await p.getByTestId("geo-end-dim").evaluate((el) => getComputedStyle(el).opacity)) !== "1") errors.push(`${tag}: back from the breakdown, the map isn't dimmed again`);
  return score;
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
  await checkWholeWorld(p, tag);
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

/**
 * Hovered, the dock shows the whole world filling GeoGuessr's box: the land
 * (x 138–5662, y 144–2470 on the 5850×2565 world map) with a few px of sea on
 * every side, drawn taller than it is so no empty sea sits above and below it.
 * Only the drawing is taller: a tap still puts the pin right under the pointer.
 */
async function checkWholeWorld(p, tag) {
  const map = p.locator("[data-testid=geo-dock] [role=application][data-ready]");
  const got = await map.evaluate((el) => ({ area: el.dataset.pickArea, w: el.clientWidth, h: el.clientHeight }));
  // The pin area is the world map's box as drawn now.
  const [l, t, r, b] = (got.area ?? "").split(",").map(Number);
  const x = (wx) => l + ((r - l) * wx) / 5850;
  const y = (wy) => t + ((b - t) * wy) / 2565;
  const sea = [x(138), y(144), got.w - x(5662), got.h - y(2470)].map(Math.round);
  if (sea.some((m) => !(m >= 2 && m <= 24))) errors.push(`whole world ${tag}: the land doesn't fill the open map with a little sea round it (sea left, top, right, bottom: ${sea.join(", ")} px; map ${got.w}×${got.h})`);
  const taller = (b - t) / 2565 / ((r - l) / 5850);
  if (!(taller > 1.2 && taller <= 1.9)) errors.push(`whole world ${tag}: the open map isn't drawn taller to fill the box (×${taller.toFixed(2)})`);
  const at = { x: Math.round(got.w * 0.42), y: Math.round(got.h * 0.47) };
  await map.click({ position: at });
  await p.waitForTimeout(200);
  const pin = await p.locator("[data-testid=geo-dock] svg > g[transform]").last().getAttribute("transform").catch(() => null);
  const [, px, py] = (pin ?? "").match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/) ?? [];
  if (!(Math.abs(Number(px) - at.x) <= 1 && Math.abs(Number(py) - at.y) <= 1)) errors.push(`whole world ${tag}: a tap at ${at.x},${at.y} puts the pin at ${pin}`);
  await p.screenshot({ path: `${OUT}/guessr-whole-world-${tag}.png` });
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
    const slot = Number((await page.getByTestId("geo-reveal").getByTestId("geo-score-slot-1").innerText()).split("\n").pop().replace(/\D/g, ""));
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
  await checkEndScreen(page, { tag: `solo-${tag}`, rounds: 5, phone });
  // Space is NEXT: back to the hub, where Play again is.
  await page.keyboard.press("Space");
  await page.getByTestId("geo-results").waitFor({ state: "detached", timeout: 5_000 }).catch(() => errors.push("solo: Space didn't go on from the end screen"));
  await page.getByTestId("geo-hub").waitFor({ timeout: 5_000 }).catch(() => errors.push("solo: NEXT didn't go back to the hub"));
  await page.context().close();
}

// ---------------------------------------------------------------------------
// Smooth and sturdy: nothing moves when a game starts, memory stays flat, and a
// game survives a reload, Back, a failed picture and a network blip
// ---------------------------------------------------------------------------

/** Live canvases and images (detached ones included) after a garbage collection, and the page's DOM node count. */
async function liveObjects(p, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const out = {};
  for (const ctor of ["HTMLCanvasElement", "HTMLImageElement"]) {
    const { result: proto } = await cdp.send("Runtime.evaluate", { expression: `${ctor}.prototype`, objectGroup: "probe" });
    const { objects } = await cdp.send("Runtime.queryObjects", { prototypeObjectId: proto.objectId, objectGroup: "probe" });
    const { result } = await cdp.send("Runtime.callFunctionOn", { objectId: objects.objectId, functionDeclaration: "function(){return this.length}", returnByValue: true });
    out[ctor] = result.value;
    // Let the found objects go again (a held result would keep every one of them alive).
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "probe" });
  }
  out.nodes = (await cdp.send("Memory.getDOMCounters")).nodes;
  return out;
}

async function sturdy(width, height) {
  const tag = `${width}`;
  const page = await newPage({ width, height });
  await page.addInitScript(() => {
    window.__shifts = [];
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && window.__shifts.push([e.startTime, e.value]))).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
  });
  const cdp = await page.context().newCDPSession(page);
  step(`sturdy game at ${tag}: no shift on start, flat memory, reload, Back, Exit, a failed picture, a lost guess`);
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  await openGeoSetup(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: /5-round game/ }).click();
  // The frame is up at once, over the hub (which stays where it was).
  await page.getByTestId("geo-shell").waitFor({ timeout: 1_000 }).catch(() => errors.push("sturdy: the game's frame didn't show at once"));
  await shotLoaded(page);
  await page.waitForTimeout(500);
  const shift = await page.evaluate((t0) => window.__shifts.filter(([t]) => t >= t0).reduce((s, [, v]) => s + v, 0), t0);
  if (shift > 0.02) errors.push(`sturdy: starting a game shifts the page (CLS ${shift.toFixed(3)})`);
  if ((await page.getByTestId("geo-hub").getAttribute("inert")) === null) errors.push("sturdy: the hub under the game can still be reached");

  // Round 1: a pin, then a reload: the same round comes back, its pin and its clock (still running, never reset).
  const { area } = await tapGuessMap(page, 0.45, 0.5);
  void area;
  const before = await page.getByTestId("geo-time-left").innerText();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("geo-shell").waitFor({ timeout: 15_000 }).catch(() => errors.push("sturdy: a reload didn't pick the game up again"));
  await shotLoaded(page);
  if (!/round\s*1/i.test(await page.getByTestId("geo-round").innerText())) errors.push("sturdy: the reload came back on another round");
  const after = await page.getByTestId("geo-time-left").innerText();
  const secs = (c) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));
  if (!(secs(after) < secs(before))) errors.push(`sturdy: the clock started again on reload (${before} → ${after})`);
  if (await page.locator("[data-testid=geo-guess][disabled]").count()) errors.push("sturdy: the pin was lost on reload");

  // Back: still in the game, asked first; "Keep playing" stays.
  await page.goBack();
  await page.getByTestId("geo-confirm-exit").waitFor({ timeout: 5_000 }).catch(() => errors.push("sturdy: Back left the game without asking"));
  await page.screenshot({ path: `${OUT}/guessr-leave-${tag}.png` });
  await page.getByTestId("geo-stay").click().catch(() => {});
  if (!(await page.getByTestId("geo-shell").isVisible())) errors.push("sturdy: Keep playing didn't keep the game");

  // Round 2's picture won't load (from here on, until let through below).
  await page.route("**/api/geo/shot/**", (route) => route.abort("failed"));
  // A lost answer: the guess is sent again and graded once.
  let dropped = 0;
  await page.route("**/api/geo/guess", (route) => (route.request().method() === "POST" && dropped++ === 0 ? route.abort("connectionreset") : route.continue()));
  await page.getByTestId("geo-guess").click();
  await page.getByTestId("geo-next").waitFor({ timeout: 20_000 }).catch(() => errors.push("sturdy: a dropped guess wasn't sent again"));
  await page.unroute("**/api/geo/guess");
  if (dropped < 2) errors.push("sturdy: the dropped guess was never retried");
  // The fact came with the answer: no learn request.
  let learnAsked = false;
  page.on("request", (r) => r.url().includes("/api/geo/learn") && (learnAsked = true));

  // Round 2's picture fails to load: the clock waits, the round says so, and a retry brings it in.
  const objects = [];
  objects.push(await liveObjects(page, cdp));
  await page.getByTestId("geo-next").click();
  await page.getByTestId("geo-shot-failed").waitFor({ timeout: 15_000 }).catch(async () => {
    errors.push(`sturdy: a picture that won't load doesn't say so (${await page.evaluate(() => [document.querySelector("img[data-testid='geo-shot']")?.getAttribute("src"), document.querySelectorAll("[data-testid=geo-shot-failed]").length, document.querySelectorAll("[data-testid=geo-shell]").length].join(" "))})`);
    await page.screenshot({ path: `${OUT}/fail-shot-${tag}.png` });
  });
  if (await page.getByTestId("geo-time-left").count()) errors.push("sturdy: the clock runs while the picture is missing");
  await page.unroute("**/api/geo/shot/**");
  await page.getByTestId("geo-shot-retry").click().catch(() => {});
  await shotLoaded(page);
  await page.getByTestId("geo-time-left").waitFor({ timeout: 5_000 }).catch(() => errors.push("sturdy: the clock didn't start once the picture came in"));

  // Rounds 2 to 5, with the next picture painted straight after Next, and memory flat.
  const nexts = [];
  for (let i = 2; i <= 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, false, 0.3 + i * 0.08);
    await page.getByTestId("geo-next").waitFor();
    await page.waitForTimeout(2600);
    if (i === 5) break;
    objects.push(await liveObjects(page, cdp));
    nexts.push(
      await page.evaluate(
        () =>
          new Promise((done) => {
            const t = performance.now();
            document.querySelector("[data-testid=geo-next]").click();
            const look = () => {
              const img = document.querySelector("img[data-testid='geo-shot']");
              if (img?.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === "1" && !img.closest("[aria-hidden=true]")) requestAnimationFrame(() => done(Math.round(performance.now() - t)));
              else requestAnimationFrame(look);
            };
            requestAnimationFrame(look);
          })
      )
    );
  }
  if (learnAsked) errors.push("sturdy: the round result asked for its fact separately");
  const [first, last] = [objects[1], objects[objects.length - 1]];
  console.log(`  memory per round: ${objects.map((o) => `${o.HTMLCanvasElement}c/${o.HTMLImageElement}i/${o.nodes}n`).join(" → ")}; Next → picture: ${nexts.join(", ")} ms`);
  if (last.HTMLCanvasElement > first.HTMLCanvasElement + 1) errors.push(`sturdy: canvases pile up round after round (${first.HTMLCanvasElement} → ${last.HTMLCanvasElement})`);
  if (last.nodes > first.nodes + 150) errors.push(`sturdy: DOM nodes pile up round after round (${first.nodes} → ${last.nodes})`);
  // Generous for a shared CI machine (the target on a desktop is 150 ms).
  if (Math.max(...nexts) > 600) errors.push(`sturdy: the next picture took ${Math.max(...nexts)} ms to show after Next`);
  const long = await page.evaluate((t0) => window.__long.filter(([t]) => t > t0), t0);
  console.log(`  long tasks during the game: ${long.length ? long.map(([, d]) => `${d} ms`).join(", ") : "none"}`);

  // Exit asks first; Leave goes back to the hub.
  await page.getByTestId("geo-next").waitFor();
  await page.locator("[data-testid=geo-exit]:visible").first().click();
  await page.getByTestId("geo-confirm-exit").waitFor({ timeout: 5_000 }).catch(() => errors.push("sturdy: Exit didn't ask first"));
  await page.getByTestId("geo-leave").click().catch(() => {});
  await page.getByTestId("geo-shell").waitFor({ state: "detached", timeout: 5_000 }).catch(() => errors.push("sturdy: Leave didn't leave"));
  await page.context().close();
}

/**
 * Today's Daily is played once. A second start is refused by the server. Left
 * mid-round (a reload, another page, Exit), it comes back on the same round
 * with the time it had (its clock waits while the player is away), from its
 * card in a new tab too. Finished, its card and the home page's Play show
 * today's result and when the next one comes, never a new game.
 */
async function dailyResume(width, height) {
  step(`the Daily, once a day, at ${width}`);
  const phone = width < 768;
  const page = await newPage({ width, height });
  // The crowd map is the crowd check's: answered here, so this early finish leaves the server no empty map of today cached for it.
  await page.route("**/api/geo/crowd**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ date: "", rounds: [] }) }));
  // Every game the page starts.
  const starts = [];
  page.on("request", (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/geo" && starts.push(r.url()));
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  const date = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.getByTestId("geo-daily-play").click();
  await shotLoaded(page);
  await pinAndGuess(page, phone, 0.5);
  await page.getByTestId("geo-next").click();
  await shotLoaded(page);
  const clock = page.getByTestId("geo-time-left").first();
  await clock.waitFor();
  await page.waitForTimeout(2500);
  /** The round's clock in seconds, and that it's round 2. */
  const onRound2 = async (when) => {
    await shotLoaded(page);
    await clock.waitFor({ timeout: 10_000 });
    // The clock goes on once the server has started it again.
    await page.waitForTimeout(400);
    if (!/round\s*2/i.test(await page.getByTestId("geo-round").first().innerText())) errors.push(`daily: ${when} didn't come back on round 2`);
    const text = await clock.innerText();
    return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  };
  const sameTime = (when, before, after) => {
    console.log(`  ${when}: ${before}s left before, ${after}s after`);
    if (after > before || before - after > 4) errors.push(`daily: ${when} didn't keep the round's time (${before}s left before, ${after}s after)`);
  };

  // The server won't start it again for this browser, as a new game or as practice.
  const again = await page.request.post(`${BASE}/api/geo`, { data: { daily: date } });
  const refused = await again.json().catch(() => ({}));
  if (again.status() !== 409 || refused.code !== "daily-started" || refused.token) errors.push(`daily: a second start the same day wasn't refused (${again.status()} ${JSON.stringify(refused).slice(0, 120)})`);

  // A reload: the same round, the same time.
  let before = await onRound2("the round");
  await page.reload({ waitUntil: "load" });
  let after = await onRound2("a reload");
  sameTime("a reload", before, after);

  // Another page for a while, then back from its card (a new visit: only the Daily's own copy is left): the clock waited.
  before = after;
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  const play = page.getByTestId("geo-daily-play");
  await play.filter({ hasText: /Resume Daily #\d+/ }).waitFor({ timeout: 10_000 }).catch(async () => errors.push(`daily: the card doesn't offer to resume it ("${await play.innerText().catch(() => "?")}")`));
  await play.click();
  after = await onRound2("going to another page and back");
  sameTime("going to another page and back", before, after);

  // Exit: the dialog says it's saved; Leave, a while on the hub, Resume: the same round and time again.
  before = after;
  await page.locator("[data-testid=geo-exit]:visible").first().click();
  const dialog = page.getByTestId("geo-confirm-exit");
  await dialog.waitFor({ timeout: 5_000 });
  const said = await dialog.innerText();
  if (!/saved/i.test(said) || !/today/i.test(said)) errors.push(`daily: the Leave dialog doesn't say the Daily is saved for today ("${said}")`);
  await page.screenshot({ path: `${OUT}/guessr-daily-leave-${width}.png` });
  await page.getByTestId("geo-leave").click();
  await page.getByTestId("geo-shell").waitFor({ state: "detached", timeout: 5_000 });
  await page.waitForTimeout(4000);
  await play.filter({ hasText: /Resume Daily #\d+/ }).click();
  after = await onRound2("Exit and Resume");
  sameTime("Exit and Resume", before, after);

  // Rounds 2 to 5, then the result: no Play again.
  for (let i = 2; i <= 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, phone, 0.3 + i * 0.08);
    const next = page.getByTestId("geo-next");
    await next.waitFor();
    await next.click();
  }
  await checkEndScreen(page, { tag: `daily-${width}`, rounds: 5, phone, once: true, daily: true });
  const total = await page.getByTestId("geo-results-total").innerText();
  const back = await page.getByTestId("geo-results-again").innerText();
  if (/again/i.test(back)) errors.push(`daily: a finished Daily offers to play again ("${back}")`);

  // Back on the hub: the card shows today's result and when the next one comes, with no Play.
  await page.getByTestId("geo-results-again").click();
  const card = page.getByTestId("geo-daily-card");
  await card.getByTestId("geo-daily-result").waitFor({ timeout: 5_000 }).catch(() => errors.push("daily: the finished Daily's card has no result to show"));
  if (await card.getByTestId("geo-daily-play").count()) errors.push("daily: the finished Daily's card still has a Play button");
  if (!/Next Daily in/i.test(await card.innerText())) errors.push("daily: the finished Daily's card doesn't say when the next one comes");
  await card.screenshot({ path: `${OUT}/guessr-daily-card-done-${width}.png` });
  await card.getByTestId("geo-daily-result").click();
  await page.getByTestId("geo-results").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  if ((await page.getByTestId("geo-results-total").innerText()) !== total) errors.push("daily: the card's result isn't the game just played");

  // The home page's Play (?play=daily) on a new visit: today's result again, no new game.
  const started = starts.length;
  await page.goto(`${BASE}/pokeguessr?play=daily`, { waitUntil: "networkidle" });
  await page.getByTestId("geo-results").waitFor({ timeout: 10_000 }).catch(() => errors.push("daily: Play on a finished Daily didn't show today's result"));
  await page.waitForTimeout(1500);
  if ((await page.getByTestId("geo-results-total").innerText().catch(() => "")) !== total) errors.push("daily: Play on a finished Daily shows another result");
  if (starts.length !== started) errors.push("daily: Play on a finished Daily started a new game");
  await page.screenshot({ path: `${OUT}/guessr-daily-done-${width}.png` });
  if ((await page.request.post(`${BASE}/api/geo`, { data: { daily: date } })).status() !== 409) errors.push("daily: a finished Daily could be started again");
  await page.context().close();
}

// ---------------------------------------------------------------------------
// The hub's sections (the Weekly Challenge is retired)
// ---------------------------------------------------------------------------

async function weekly(width, height) {
  const tag = `${width}`;
  const page = await newPage({ width, height });
  step(`hub at ${tag}`);
  // No start or guess response may name a place before it's guessed.
  page.on("response", async (res) => {
    if (!res.url().endsWith("/api/geo") || res.request().method() !== "POST" || !res.ok()) return;
    const body = await res.json().catch(() => null);
    if (body && /"(name|pin|mask|location)"/.test(JSON.stringify(body.round ?? {}))) errors.push(`weekly round leaked its place: ${JSON.stringify(body.round)}`);
  });
  await page.goto(`${BASE}/pokeguessr`, { waitUntil: "networkidle" });
  await closeHowTo(page);
  for (const id of ["maps", "you"]) await page.getByTestId(`geo-hub-${id}`).waitFor();
  for (const id of ["geo-solo-card", "geo-daily-card", "region-streak-card", "geo-home-duels", "geo-home-ranked", "geo-home-party", "globe-card", "geo-history-link"]) {
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
  await openDrops(page);
  await page.getByTestId("geo-home-ranked").click();
  await page.getByTestId("geo-ranked-card").waitFor();
  await page.getByTestId("geo-duel-queue-casual").click();
  // The Weekly Challenge is retired: no card for it on the hub, no tab for it on the board.
  if (await page.locator('[data-testid^="geo-weekly-"]').count()) errors.push("the hub still offers the Weekly Challenge");
  await page.goto(`${BASE}/leaderboard?board=geo`, { waitUntil: "networkidle" });
  if (await page.getByTestId("geo-board-weekly").count()) errors.push("the leaderboard still has a Weekly tab");
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
  await red.goto(`${BASE}/pokeguessr?region=kanto#duels`, { waitUntil: "networkidle" });
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
  await red.getByTestId("geo-home-party").waitFor();
  await openDrops(red);
  await red.getByTestId("geo-home-party").click();
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
  await openDrops(red);
  await red.getByTestId("geo-home-duels").click();
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
  // What the end screen's crowd request got, to say why if no crowd map shows.
  const answers = [];
  page.on("response", async (res) => {
    if (!new URL(res.url()).pathname.endsWith("/api/geo/crowd")) return;
    const body = await res.json().catch(() => null);
    answers.push(`${res.status()} ${body?.rounds ? `${body.rounds.length} rounds, ${body.rounds.map((r) => r.pins).join("/")} pins` : JSON.stringify(body).slice(0, 80)}`);
  });
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
  // The crowd map is in the breakdown: its switch lays everyone's pins over the round picked in the tracker.
  await page.getByTestId("geo-results").waitFor({ timeout: 15_000 });
  await page.getByTestId("geo-breakdown-toggle").click();
  const card = page.getByTestId("geo-crowd");
  await card.waitFor({ timeout: 15_000 }).catch(async (e) => {
    await page.screenshot({ path: `${OUT}/fail-crowd-${tag}.png` });
    throw new Error(`crowd map: none in the breakdown (the crowd requests got: ${answers.join("; ") || "nothing"}): ${e.message.split("\n")[0]}`);
  });
  await page.getByTestId("geo-crowd-toggle").click();
  await page.getByTestId("geo-crowd-layer").waitFor({ timeout: 15_000 });
  if (!/\d+ trainers pinned round 1/.test(await page.getByTestId("geo-crowd-count").innerText())) errors.push("crowd map: no pin count for round 1");
  const tabs = await page.locator("[data-testid^=geo-end-round-]").count();
  if (tabs !== 5) errors.push(`crowd map: ${tabs} rounds in the tracker, expected 5`);
  await page.getByTestId("geo-end-round-3").click();
  if (!/round 3/.test(await page.getByTestId("geo-crowd-count").innerText())) errors.push("crowd map: picking round 3 didn't switch the map");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) errors.push(`crowd map: the page scrolls sideways by ${overflow}px`);
  const png = await page.request.get(`${BASE}/api/geo/crowd/card?date=${date}&round=3`);
  if (png.status() !== 403) errors.push(`crowd map: the share card answered without a finished Daily (${png.status()})`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/guessr-crowd-${tag}.png` });
  await page.context().close();
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

/**
 * Records the page's media elements and audio contexts, so the test can see
 * what is really playing, and logs (in the page's own clock) each change of
 * the player's state and each music track pausing.
 */
async function watchAudio(context) {
  await context.addInitScript(() => {
    window.__media = [];
    window.__musicLog = [];
    const isTrack = (el) => /\/audio\/guessr\//.test(el.currentSrc || el.src);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!window.__media.includes(this)) {
        window.__media.push(this);
        this.addEventListener("pause", () => {
          if (isTrack(this)) window.__musicLog.push({ pause: true, t: performance.now() });
        });
      }
      return play.apply(this, args);
    };
    new MutationObserver(() => {
      const state = document.documentElement?.dataset.guessrMusic;
      const log = window.__musicLog;
      if (state && log.filter((e) => e.state).at(-1)?.state !== state) log.push({ state, t: performance.now() });
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-guessr-music"] });
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

/** The page's clock now (ms), to read the music log against. */
const pageNow = (p) => p.evaluate(() => performance.now());

/** Waits for the music to sound; false if it didn't within `timeout`. */
const musicPlays = (p, timeout = 20_000) =>
  p.waitForFunction(() => document.documentElement.dataset.guessrMusic === "playing", null, { timeout }).then(() => true, () => false);

/** Waits for the music to be off with no track left playing (a fade ends in a pause); false if it isn't within `timeout`. */
const musicStops = (p, timeout = 6_000) =>
  p
    .waitForFunction(
      () => (document.documentElement.dataset.guessrMusic ?? "none") !== "playing" && !(window.__media ?? []).some((el) => /\/audio\/guessr\//.test(el.currentSrc || el.src) && !el.paused),
      null,
      { timeout }
    )
    .then(() => true, () => false);

/** Nothing playing, nothing about to: a screen with no game on (the hub, a setup, a lobby). */
async function expectSilent(p, what) {
  const now = await musicNow(p);
  if (now.playing.length || now.state === "playing" || now.state === "loading") errors.push(`music: ${what} isn't silent (${JSON.stringify(now)})`);
}

/**
 * After a game ended at `endedAt` (the page's clock): the music faded out,
 * then paused. Checks it stopped, and that it was a fade (the pause comes
 * well after the player went off), not a cut.
 */
async function expectFadedOut(p, endedAt, what) {
  if (!(await musicStops(p))) {
    errors.push(`music: still playing on ${what} (${JSON.stringify(await musicNow(p))})`);
    return;
  }
  const log = await p.evaluate(() => window.__musicLog);
  const off = log.find((e) => e.state === "off" && e.t >= endedAt);
  const paused = log.find((e) => e.pause && e.t >= endedAt);
  if (!off || !paused) errors.push(`music: ${what} didn't fade it out (${JSON.stringify(log.filter((e) => e.t >= endedAt))})`);
  else if (paused.t - off.t < 500) errors.push(`music: ${what} cut the music (paused ${Math.round(paused.t - off.t)} ms after it went off) instead of fading it`);
  else console.log(`  ${what}: off ${Math.round(off.t - endedAt)} ms after the game ended, faded and paused ${Math.round(paused.t - off.t)} ms later`);
}

/** Exit (asks first while a round is on), then Leave: back on the hub. */
async function exitGame(p) {
  await p.locator("[data-testid=geo-exit]:visible").first().click();
  await p.getByTestId("geo-confirm-exit").waitFor({ timeout: 5_000 }).catch(() => {});
  await p.getByTestId("geo-leave").click().catch(() => {});
  await p.getByTestId("geo-shell").waitFor({ state: "detached", timeout: 5_000 });
}

/**
 * Background music, only while a game is on. The hub is silent, taps and all,
 * and fetches no track; Music off in the settings keeps a game silent too.
 * Starting a game starts a track (the element plays, the context runs); it
 * carries on between rounds without restarting; it pauses while the tab is
 * hidden or the site is muted (M), and comes back after; the final summary
 * fades it out, and the next game starts it again. A Region Streak's game
 * over fades it out; so do Pokémon Hunt's results (its menu is silent, Play
 * again starts it again); a duel's lobby is silent, the match plays it, and
 * leaving mid-match fades it out for both trainers. With the site muted from
 * the start, no music is ever requested.
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

  // The hub: silent, whatever the player taps.
  await closeHowTo(page);
  await openGeoSetup(page);
  await page.waitForTimeout(3000);
  await expectSilent(page, "the hub");
  if (requests.length) errors.push(`music: the hub requested a track (${requests[0]})`);

  // The settings: Music is on at a low volume. Off: a game stays silent.
  await page.getByTestId("geo-settings").click();
  await page.getByTestId("geo-music").waitFor();
  if ((await page.getByTestId("geo-music").getAttribute("aria-checked")) !== "true") errors.push("music: the Music switch isn't on by default");
  const volume = Number(await page.getByTestId("geo-music-volume").inputValue());
  if (volume !== 35) errors.push(`music: the default volume is ${volume}, not 35`);
  await page.screenshot({ path: `${OUT}/guessr-music-settings-${width}.png` });
  await page.getByTestId("geo-music").click();
  if ((await page.evaluate(() => localStorage.getItem("pokeiq-guessr-music"))) !== JSON.stringify({ on: false, volume: 0.35 })) errors.push("music: Music off isn't remembered");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /5-round game/ }).click();
  await shotLoaded(page);
  await page.waitForTimeout(2500);
  await expectSilent(page, "a game with Music off");
  if (requests.length) errors.push(`music: Music off, yet a track was requested (${requests[0]})`);
  await exitGame(page);
  // On again: still silent on the hub.
  await page.getByTestId("geo-settings").click();
  await page.getByTestId("geo-music").click();
  if ((await page.getByTestId("geo-music").getAttribute("aria-checked")) !== "true") errors.push("music: the Music switch didn't go back on");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  await expectSilent(page, "the hub with Music on");

  // A game: the music starts with it.
  await page.getByRole("button", { name: /5-round game/ }).click();
  if (!(await musicPlays(page))) throw new Error(`music: starting a game didn't start it (${JSON.stringify(await musicNow(page))})`);
  if (!requests.some((u) => /\/audio\/guessr\/[a-z-]+\.(ogg|mp3)$/.test(u))) errors.push("music: playing, but no track was requested");
  await shotLoaded(page);
  await page.waitForTimeout(1500);
  const during = await musicNow(page);
  if (during.playing.length !== 1 || during.playing[0].at < 0.5) errors.push(`music: no track element is playing (${JSON.stringify(during)})`);
  if (!during.context.includes("running")) errors.push(`music: the audio context isn't running (${during.context})`);
  // A round's result, and the next round: still the same track, still going.
  await pinAndGuess(page, phone, 0.5, null);
  await page.getByTestId("geo-next").waitFor();
  await page.waitForTimeout(1200);
  const result = await musicNow(page);
  if (result.state !== "playing" || !result.playing.length || result.playing[0].src !== during.playing[0]?.src || result.playing[0].at < during.playing[0].at) errors.push(`music: the round's result stopped or restarted the track (${JSON.stringify(during.playing)} → ${JSON.stringify(result)})`);
  await page.getByTestId("geo-next").click();
  await shotLoaded(page);
  const round2 = await musicNow(page);
  if (!round2.playing.length || round2.playing[0].src !== result.playing[0]?.src || round2.playing[0].at < result.playing[0].at) errors.push(`music: the track restarted on the next round (${JSON.stringify(result.playing)} → ${JSON.stringify(round2.playing)})`);

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
  if (!(await musicPlays(page, 10_000))) errors.push("music: didn't come back when the tab did");

  // The site muted mid-game (M): it stops; unmuted: back.
  await page.keyboard.press("m");
  if (!(await musicStops(page))) errors.push(`music: muting the site didn't stop it (${JSON.stringify(await musicNow(page))})`);
  if ((await page.evaluate(() => localStorage.getItem("pokeiq-muted"))) !== "1") errors.push("music: M didn't mute the site");
  await page.keyboard.press("m");
  if (!(await musicPlays(page, 10_000))) errors.push("music: unmuting the site didn't bring it back");

  // The rest of the game: playing through each round's result; the summary fades it out.
  let endedAt = 0;
  for (let i = 1; i < 5; i++) {
    await shotLoaded(page);
    await pinAndGuess(page, phone, 0.3 + i * 0.1);
    const next = page.getByTestId("geo-next");
    await next.waitFor();
    const label = await next.innerText();
    const last = /summary/i.test(label);
    if (last && (await musicNow(page)).state !== "playing") errors.push("music: not playing on the last round's result");
    if (last) endedAt = await pageNow(page);
    await next.click();
    if (last) break;
  }
  await page.getByTestId("geo-share-card").waitFor();
  await expectFadedOut(page, endedAt, "the game's summary");
  // Play again: the hub (silent), then the next game starts it again.
  await page.getByTestId("geo-results-again").click();
  await page.getByTestId("geo-hub").waitFor();
  await page.waitForTimeout(1500);
  await expectSilent(page, "the hub after a game");
  await openGeoSetup(page);
  await page.getByRole("button", { name: /5-round game/ }).click();
  if (!(await musicPlays(page))) errors.push(`music: the next game didn't start it again (${JSON.stringify(await musicNow(page))})`);
  // Exit: back on the hub, it fades out.
  await shotLoaded(page);
  endedAt = await pageNow(page);
  await exitGame(page);
  await expectFadedOut(page, endedAt, "leaving a game for the hub");

  // A Region Streak: silent on its setup, playing through the run, fading out at its game over.
  step(`music: streak at ${width}`);
  await page.goto(`${BASE}/pokeguessr/streak`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await expectSilent(page, "the streak's setup");
  await page.getByTestId("streak-start").click();
  if (!(await musicPlays(page))) errors.push(`music: starting a streak didn't start it (${JSON.stringify(await musicNow(page))})`);
  for (let i = 0; i < 30; i++) {
    await page.getByTestId("streak-picker").waitFor({ timeout: 15_000 });
    await page.locator("[data-testid^=streak-region-]").first().click();
    await page.getByTestId("streak-picker").getByTestId("geo-guess").click();
    const next = page.getByTestId("streak-next");
    await next.waitFor({ timeout: 15_000 });
    const over = /results/i.test(await next.innerText());
    if ((await musicNow(page)).state !== "playing") errors.push(`music: not playing on the streak's result ${i + 1}`);
    if (over) endedAt = await pageNow(page);
    await next.click();
    if (over) break;
  }
  await page.getByTestId("streak-summary").waitFor();
  await expectFadedOut(page, endedAt, "the streak's game over");

  // Pokémon Hunt: silent in its menu, playing through a hunt's rounds and reveals, fading out on its results.
  step(`music: hunt at ${width}`);
  await page.goto(`${BASE}/pokeguessr/hunt`, { waitUntil: "networkidle" });
  await page.locator('[data-testid=hunt-map-picker] [data-map="galar"]').click();
  await page.waitForTimeout(2500);
  await expectSilent(page, "Pokémon Hunt's menu");
  await page.getByTestId("hunt-play").click();
  if (!(await musicPlays(page))) errors.push(`music: starting a hunt didn't start it (${JSON.stringify(await musicNow(page))})`);
  for (let r = 0; r < 10; r++) {
    await page.getByTestId("hunt-card").waitFor();
    if (phone) await page.getByTestId("geo-map-pill").click();
    const { map, area } = await guessMapReady(page);
    await map.click({ position: spotIn(area, 0.5, 0.5) });
    await page.getByTestId("geo-guess").click();
    await page.getByTestId("hunt-reveal").waitFor();
    await page.getByTestId("hunt-skip").click({ timeout: 2_000 }).catch(() => {});
    if ((await musicNow(page)).state !== "playing") errors.push(`music: not playing on the hunt's reveal ${r + 1}`);
    endedAt = await pageNow(page);
    await page.locator('[data-testid="hunt-next"]:visible').first().click();
    if (await page.getByTestId("hunt-results").waitFor({ timeout: 3_000 }).then(() => true, () => false)) break;
  }
  await page.getByTestId("hunt-results").waitFor();
  await expectFadedOut(page, endedAt, "the hunt's results");
  // Play again: the next hunt starts it again.
  await page.getByTestId("hunt-again").click();
  if (!(await musicPlays(page))) errors.push(`music: Play again didn't start the hunt's music again (${JSON.stringify(await musicNow(page))})`);

  // A duel: silent in the lobby; the match plays it; Red leaving mid-match fades it out for both.
  step(`music: duel at ${width}`);
  const red = page;
  // Blue without WebGL (as party guests): the end screen's 3D trainers, drawn in software here, would hold up its timers.
  const blue = await newPage({ width, height }, { noWebGL: true });
  await watchAudio(blue.context());
  await red.goto(`${BASE}/pokeguessr?region=kanto#duels`, { waitUntil: "networkidle" });
  await closeHowTo(red);
  for (let i = 0; i < 4; i++) {
    const name = red.getByLabel("Your trainer name").first();
    if (!(await name.inputValue())) await name.fill("Red");
    await red.getByRole("button", { name: /Create duel/ }).click({ timeout: 10_000 }).catch(() => {});
    if (await red.waitForURL(/\/pokeguessr\/duel\/[a-z2-9]{8}$/, { timeout: 10_000 }).then(() => true, () => false)) break;
  }
  const url = red.url();
  await red.getByText("Waiting for a challenger").waitFor();
  await blue.goto(url, { waitUntil: "networkidle" });
  await blue.getByLabel("Your trainer name").fill("Blue");
  await blue.getByRole("button", { name: /Join duel/ }).click();
  await red.getByText("Blue").first().waitFor();
  await red.waitForTimeout(2500);
  await expectSilent(red, "the duel's lobby (Red)");
  await expectSilent(blue, "the duel's lobby (Blue)");
  await Promise.all([red, blue].map((p) => p.getByRole("button", { name: /^Ready$/ }).click()));
  await red.getByTestId("geo-versus").waitFor({ timeout: 15_000 });
  for (const [p, who] of [[red, "Red"], [blue, "Blue"]]) if (!(await musicPlays(p))) errors.push(`music: the duel didn't start it for ${who} (${JSON.stringify(await musicNow(p))})`);
  await Promise.all([shotLoaded(red), shotLoaded(blue)]);
  const [redLeft, blueEnded] = [await pageNow(red), await pageNow(blue)];
  await red.getByRole("button", { name: "Leave duel" }).click();
  await red.getByRole("button", { name: "Forfeit" }).click();
  await red.waitForURL(/\/pokeguessr$/, { timeout: 15_000 });
  await expectFadedOut(red, redLeft, "leaving a duel mid-match");
  await blue.getByTestId("geo-duel-end").waitFor({ timeout: 20_000 });
  await expectFadedOut(blue, blueEnded, "the duel's end");
  await red.context().close();
  await blue.context().close();

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

/** E2E_ONLY=sturdy1440,daily1440,music1440,music390,solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390,crowd390,crowd1440 runs a subset. */
const only = (process.env.E2E_ONLY ?? "sturdy1440,daily1440,music1440,music390,solo1440,weekly1440,duel1440,solo390,weekly390,duel390,royale1440,team1440,royale390,team390,crowd390").split(",");
try {
  if (only.includes("sturdy1440")) await sturdy(1440, 900);
  if (only.includes("daily1440")) await dailyResume(1440, 900);
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
